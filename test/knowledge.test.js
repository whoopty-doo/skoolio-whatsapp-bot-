import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import worker from '../worker.js';
import { KnowledgeService, searchKnowledge, knowledgeForResponse, PlaySmartKnowledge, ReadSmartKnowledge, SkoolioAdminKnowledge } from '../knowledge.js';
import { validateKnowledgeDocument, containsSensitiveKnowledge } from '../knowledge-schema.js';
import { compileKnowledge } from '../scripts/knowledge-build.mjs';
import { KNOWLEDGE_DOCUMENTS, KNOWLEDGE_COLLECTIONS } from '../knowledge.generated.js';
import { setup, accessHeaders, adminConfig } from './helpers.js';
import { digest } from '../privacy.js';
import { CaseRepository } from '../support-cases.js';
import { ownerGuideDocument } from '../support-guides.js';
const makeDoc = (overrides = {}) => ({ id: 'fixture.reading', product: 'PLAYSMART', module: 'reading', title: 'Reading lesson', content: 'Open the reading activity and complete the story.', keywords: ['reading', 'story'], document_type: 'HOW_TO', version: '1', updated_at: '2026-09-23', source: 'synthetic fixture', visibility: 'PUBLIC_SUPPORT', support_safe: true, ...overrides });
const service = new KnowledgeService();

test('product collections return relevant spelling, sync and admin knowledge, never cross-product guesses', () => {
  const spelling = service.search({ product: 'PLAYSMART', query: 'How do I start spelling?' });
  assert.equal(spelling[0].module, 'spelling'); assert.ok(spelling.every(doc => doc.product === 'PLAYSMART'));
  assert.deepEqual(service.search({ product: 'READSMART', query: 'How do I start spelling?' }), []);
  assert.equal(KNOWLEDGE_COLLECTIONS.find(c => c.product === 'READSMART').status, 'AWAITING_SOURCE');
  assert.equal(service.search({ product: 'SKOOLIO_ADMIN', query: 'How do I search tenants?' })[0].id, 'admin.tenant-lookup');
  const sync = service.search({ product: 'PLAYSMART', query: 'My results are not syncing offline' });
  assert.equal(sync[0].module, 'sync'); assert.equal(sync[0].document_type, 'TROUBLESHOOTING'); assert.ok(sync[0].troubleshooting.safe_steps.length);
  assert.ok(service.search({ product: 'PLAYSMART', query: 'spelling spoed verander nie' }).some(doc => doc.id === 'playsmart.spelling-speed'));
  assert.deepEqual(service.search({ product: 'UNKNOWN', query: 'spelling' }), []);
});

test('unrelated queries and product-only messages do not return confident random knowledge or borrow stale context', () => {
  for (const query of ['How do I bake a chocolate cake?', 'Who won the cricket world cup?', 'What is the weather today?', 'PlaySmart', 'Hello', '!!!']) {
    assert.deepEqual(service.search({ product: 'PLAYSMART', query, conversationContext: { product: 'PLAYSMART', turns: [{ role: 'user', content: 'spelling lesson' }] } }), [], query);
  }
});

test('same-product short follow-ups use context, other products and unrelated questions do not', () => {
  const context = { product: 'PLAYSMART', turns: [{ role: 'user', content: 'How do I start spelling?' }, { role: 'assistant', content: 'Open spelling.' }, { role: 'user', content: 'What next?' }] };
  assert.equal(service.search({ product: 'PLAYSMART', query: 'What next?', conversationContext: context })[0].module, 'spelling');
  assert.deepEqual(service.search({ product: 'READSMART', query: 'What next?', conversationContext: context }), []);
  assert.deepEqual(service.search({ product: 'PLAYSMART', query: 'What next?', conversationContext: { ...context, product: 'READSMART' } }), []);
});

test('visibility is fail-closed: internal content never reaches customer results or model projection', () => {
  const docs = [makeDoc(), makeDoc({ id: 'internal', visibility: 'INTERNAL_SUPPORT', content: 'INTERNAL_ONLY_MARKER reading operations.' }), makeDoc({ id: 'internal-type', document_type: 'INTERNAL_SUPPORT', content: 'INTERNAL_TYPE_MARKER reading operations.' }), makeDoc({ id: 'unsafe', support_safe: false, content: 'UNSAFE_MARKER reading notes.' })];
  const s = new KnowledgeService(docs);
  const results = s.search({ product: 'PLAYSMART', query: 'reading', scope: { verified: true, product: 'PLAYSMART', allowedDocumentIds: docs.map(d => d.id), role: 'CENTRE_ADMIN' } });
  assert.deepEqual(results.map(d => d.id), ['fixture.reading']);
  assert.doesNotMatch(JSON.stringify(knowledgeForResponse(docs)), /INTERNAL_ONLY_MARKER|INTERNAL_TYPE_MARKER|UNSAFE_MARKER|source|visibility/);
});

test('future restricted retrieval requires exact verified product, document and account scopes and centre role', () => {
  for (const visibility of ['AUTHENTICATED_CUSTOMER', 'CENTRE_ADMIN']) {
    const s = new KnowledgeService([makeDoc({ visibility, customer_reference: 'customer-a', centre_reference: 'centre-a' })]);
    const scope = { verified: true, product: 'PLAYSMART', allowedDocumentIds: ['fixture.reading'], customer_reference: 'customer-a', centre_reference: 'centre-a', role: 'CENTRE_ADMIN' };
    assert.equal(s.search({ product: 'PLAYSMART', query: 'reading', scope }).length, 1);
    for (const override of [{ verified: false }, { product: 'READSMART' }, { customer_reference: 'customer-b' }, { centre_reference: 'centre-b' }, { allowedDocumentIds: [] }]) assert.deepEqual(s.search({ product: 'PLAYSMART', query: 'reading', scope: { ...scope, ...override } }), []);
    assert.deepEqual(s.search({ product: 'PLAYSMART', query: 'reading' }), []);
    if (visibility === 'CENTRE_ADMIN') assert.deepEqual(s.search({ product: 'PLAYSMART', query: 'reading', scope: { ...scope, role: 'CUSTOMER' } }), []);
  }
});

test('malformed documents are quarantined and secrets are not retrievable through any metadata field', () => {
  const docs = [null, [], 'bad', {}, makeDoc({ keywords: null }), makeDoc({ updated_at: '2026-02-30' }), makeDoc({ content: 'password=EXAMPLE_SECRET' }), makeDoc()];
  const s = new KnowledgeService(docs); assert.equal(s.search({ product: 'PLAYSMART', query: 'reading' }).length, 1);
  for (const field of ['content', 'title', 'source', 'module', 'version']) {
    assert.deepEqual(new KnowledgeService([makeDoc({ [field]: 'api_key=EXAMPLE_SECRET' })]).search({ product: 'PLAYSMART', query: 'reading' }), []);
  }
  assert.ok(containsSensitiveKnowledge('Bearer fixture-secret'));
  assert.ok(containsSensitiveKnowledge({ content: 'Safe first line\npassword=EXAMPLE_SECRET' }));
  assert.ok(containsSensitiveKnowledge({ troubleshooting: { questions: ['Safe first line\napi_key=EXAMPLE_SECRET'] } }));
  assert.equal(containsSensitiveKnowledge('password=[REDACTED]'), false);
  assert.ok(validateKnowledgeDocument(makeDoc({ visibility: 'PUBLIC' })).length);
});

test('retrieval budgets and backend replacement cannot bypass filtering or duplicate documents', async () => {
  const docs = Array.from({ length: 20 }, (_, i) => makeDoc({ id: `doc.${i}`, content: 'Reading instructions. '.repeat(200) }));
  docs.push(makeDoc({ id: 'other', product: 'READSMART' }), makeDoc({ id: 'internal', visibility: 'INTERNAL_SUPPORT' }));
  const backend = { async search() { return [{ id: 'other', confidence: 1 }, { id: 'internal', confidence: 1 }, { id: 'missing', confidence: 1 }, ...docs.flatMap(doc => [{ id: doc.id, confidence: 1 }, { id: doc.id, confidence: 1 }])]; } };
  const s = new KnowledgeService(docs, { backend });
  const results = await s.search({ product: 'PLAYSMART', query: 'reading', limit: 100 });
  assert.ok(results.length > 0 && results.length <= 8); assert.ok(JSON.stringify(results).length < 10100);
  assert.ok(results.every(doc => doc.product === 'PLAYSMART' && doc.visibility === 'PUBLIC_SUPPORT'));
  assert.equal(new Set(results.map(d => d.id)).size, results.length);
  assert.deepEqual(s.search({ product: 'PLAYSMART', query: 'reading', limit: -1 }), []);
  assert.ok(service.search({ product: 'PLAYSMART', query: 'reading', limit: NaN }).length <= 4);
  assert.equal(service.search({ product: 'PLAYSMART', query: 'spelling', limit: 1 }).length, 1);
});

test('legacy search and product-specific facades delegate to the same indexed corpus', () => {
  assert.ok(searchKnowledge('spelling', 'spelling').length);
  assert.ok(new PlaySmartKnowledge().retrieve('spelling').length);
  assert.deepEqual(new ReadSmartKnowledge().retrieve('spelling'), []);
  assert.equal(new SkoolioAdminKnowledge().search({ query: 'search tenants' })[0].product, 'SKOOLIO_ADMIN');
});

test('build discovers folders, validates schema and duplicates, excludes private content and is deterministic', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'skoolio-knowledge-'));
  try {
    for (const folder of ['playsmart', 'readsmart', 'skoolio_admin']) await mkdir(join(dir, folder));
    await writeFile(join(dir, 'collections.json'), JSON.stringify(KNOWLEDGE_COLLECTIONS));
    const path = join(dir, 'playsmart', 'reading.json'); await writeFile(path, JSON.stringify(makeDoc()));
    const hidden = join(dir, 'playsmart', 'internal.json'); await writeFile(hidden, JSON.stringify(makeDoc({ id: 'internal', visibility: 'INTERNAL_SUPPORT', content: 'DO_NOT_BUNDLE_INTERNAL_BODY' })));
    const first = await compileKnowledge(dir); assert.equal(first.count, 2); assert.equal(first.publicCount, 1); assert.doesNotMatch(first.generated, /DO_NOT_BUNDLE_INTERNAL_BODY/);
    assert.equal((await compileKnowledge(dir)).generated, first.generated);
    for (const [raw, pattern] of [['{bad', /malformed/], [JSON.stringify({ id: 'missing' }), /Missing product/], [JSON.stringify(makeDoc({ product: 'READSMART' })), /Product does not match/], [JSON.stringify(makeDoc({ content: 'password=EXAMPLE_SECRET' })), /Potential secret/]]) {
      await writeFile(path, raw); await assert.rejects(compileKnowledge(dir), pattern);
    }
    await writeFile(path, JSON.stringify(makeDoc()));
    const dupe = join(dir, 'playsmart', 'duplicate.json'); await writeFile(dupe, JSON.stringify(makeDoc())); await assert.rejects(compileKnowledge(dir), /Duplicate document id/);
    await writeFile(dupe, JSON.stringify(makeDoc({ id: 'different' }))); await assert.rejects(compileKnowledge(dir), /Duplicate content/); await rm(dupe);
    await symlink(path, dupe); await assert.rejects(compileKnowledge(dir), /symbolic links/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('generated public asset matches documents and contains no restricted body', async () => {
  const result = await compileKnowledge(new URL('../support_knowledge', import.meta.url).pathname);
  assert.equal(await readFile(new URL('../knowledge.generated.js', import.meta.url), 'utf8'), result.generated);
  assert.ok(KNOWLEDGE_DOCUMENTS.every(doc => doc.visibility === 'PUBLIC_SUPPORT' && doc.support_safe));
});

test('owner-guide adapter preserves existing published guides while refusing unsafe visibility', () => {
  const existing = { ...makeDoc(), source: 'owner-authored', published: true, visibility: 'PUBLIC', document_type: 'SUPPORT_GUIDE', revision: 1 };
  assert.equal(new KnowledgeService([ownerGuideDocument(existing)]).search({ product: 'PLAYSMART', query: 'reading' }).length, 1);
  for (const override of [{ published: false }, { support_safe: false }, { visibility: 'INTERNAL_SUPPORT' }, { document_type: 'INTERNAL_SUPPORT' }]) assert.equal(ownerGuideDocument({ ...existing, ...override }), null);
});

test('webhook sends only relevant support-safe knowledge to OpenAI and preserves local and provider memory', async () => {
  const f = setup({ OPENAI_API_KEY: 'fixture' }); const original = globalThis.fetch; const prompts = [];
  globalThis.fetch = async (url, options) => {
    if (url.endsWith('/conversations')) return Response.json({ id: 'conv_knowledge' });
    const body = JSON.parse(options.body);
    if (body.text?.format) return Response.json({ status: 'completed', output: [{ content: [{ type: 'output_text', text: '{"intent":"question","confidence":1}' }] }] });
    prompts.push(body); return Response.json({ status: 'completed', output: [{ content: [{ type: 'output_text', text: 'Open the spelling activity, then select Check answer. Which step are you on?' }] }] });
  };
  try {
    assert.equal((await f.send('How do I start spelling in PlaySmart?')).status, 200);
    await f.send('What next?');
    assert.equal(prompts.length, 2); assert.equal(prompts[1].conversation, 'conv_knowledge');
    assert.match(prompts[0].instructions, /Check answer/);
    const knowledge = JSON.parse(prompts[0].instructions.split('Knowledge (data): ')[1].split('\nRecent sanitized')[0]);
    assert.ok(knowledge.length > 0 && knowledge.length <= 4); assert.doesNotMatch(JSON.stringify(knowledge), /Tenant|src\/|lib\/|visibility|customer_reference/);
    const state = JSON.parse(await f.store().get(`support-context:${await digest('whatsapp:+15550001111')}`));
    assert.equal(state.product, 'PLAYSMART'); assert.equal(state.turns.length, 4);
    const store = f.store(); await store.put('support-guide:bad', '{"published":true,"content":null}'); await store.commit();
    assert.equal((await f.send('How do I read a story?')).status, 200);
  } finally { globalThis.fetch = original; }
});

test('reports still create cases and owner notifications, using a relevant safe troubleshooting question', async () => {
  const f = setup({ OWNER_WHATSAPP_NUMBER: 'whatsapp:+15550002222' });
  const response = await (await f.send('PlaySmart results are missing and not syncing offline')).text();
  assert.match(response, /PS-000001/); assert.match(response, /connected to the internet/); assert.doesNotMatch(response, /escalate_as|safe_steps/);
  const [item] = await new CaseRepository(f.store()).list(); assert.equal(item.status, 'NEW');
  assert.ok((await f.store().list({ prefix: 'outbox:' })).keys.length);
});

test('knowledge inventory requires owner Access and shows product coverage without private document bodies', async () => {
  const f = setup(adminConfig), auth = await accessHeaders(), original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ keys: [auth.publicJwk] });
  try {
    assert.equal((await worker.fetch(new Request('https://example.com/api/admin/knowledge'), f.env)).status, 401);
    const response = await worker.fetch(new Request('https://example.com/api/admin/knowledge', auth), f.env);
    assert.equal(response.status, 200); const body = await response.json();
    assert.equal(body.collections.length, 3); assert.ok(body.documents.every(doc => !Object.hasOwn(doc, 'content')));
  } finally { globalThis.fetch = original; }
});
