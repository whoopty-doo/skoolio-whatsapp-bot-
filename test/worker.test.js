import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import worker, { ConversationStore, validateTwilioSignature } from '../worker.js';
import { CaseRepository, normalizeCase, validateTransition, sanitize } from '../support-cases.js';
import { ProductRouter, CodingAgentRouter } from '../products.js';
import { KnowledgeService } from '../knowledge.js';
import { renderAdmin, adminResponse } from '../admin.js';
import { StagedStore, bootstrap } from '../persistence.js';
import { deliverNotification } from '../notifications.js';
import { setup, memoryKV, MemoryStorage, accessHeaders, adminConfig } from './helpers.js';

const cases = fixture => new CaseRepository(fixture.store()).list();

test('health and fail-closed persistence', async () => {
  const health = await worker.fetch(new Request('https://example.com/health'), {}); assert.equal(health.status, 200);
  const fixture = setup(); delete fixture.env.SUPPORT_COORDINATOR;
  assert.equal((await fixture.send('PlaySmart')).status, 503);
  const production = setup({ ENVIRONMENT: 'production' }); assert.equal((await production.send('hello')).status, 503);
});
test('generated dashboard parses, uses DOM text, and has nonce CSP', () => {
  const html = renderAdmin('test'); new vm.Script(html.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1]);
  assert.doesNotMatch(html, /innerHTML|onclick=/); assert.match(html, /Skoolio/); assert.match(html, /ReadSmart/);
  const response = adminResponse(); assert.match(response.headers.get('Content-Security-Policy'), /frame-ancestors 'none'/); assert.match(response.headers.get('Cache-Control'), /no-store/);
});
test('product router refuses weak guesses and handles switching/ambiguity', () => {
  const router = new ProductRouter(); assert.equal(router.resolve('Spelling lesson crashes').product, 'UNKNOWN');
  assert.equal(router.resolve('ReadSmart lesson crashes', { product: 'PLAYSMART' }).product, 'READSMART');
  assert.equal(router.resolve('It crashes', { product: 'READSMART' }).product, 'READSMART');
  assert.equal(router.resolve('PlaySmart and ReadSmart').needsClarification, true);
  assert.equal(router.resolve('Skoolio backoffice API').product, 'SKOOLIO_ADMIN');
});
test('detailed natural reports clarify product then create exactly one case', async () => {
  const f = setup(); assert.match(await (await f.send('My spelling lesson crashes when I press Start')).text(), /PlaySmart, ReadSmart/);
  assert.equal((await cases(f)).length, 0);
  assert.match(await (await f.send('ReadSmart')).text(), /RS-000001/);
  const [item] = await cases(f); assert.equal(item.product, 'READSMART'); assert.equal(item.category, 'CRASH'); assert.equal(item.feature_module, 'spelling');
});
test('explicit product and actionable natural report create without command prefixes', async () => {
  const f = setup(); await f.send('PlaySmart spelling crashes when I press Start on Windows');
  const [item] = await cases(f); assert.equal(item.platform, 'Windows'); assert.equal(item.status, 'NEW'); assert.equal(item.product, 'PLAYSMART');
});
test('a natural report is saved before follow-up details and thanks creates no duplicate', async () => {
  const f = setup(); await f.send('My PlaySmart lesson is not working'); await f.send('thanks'); assert.equal((await cases(f)).length, 1);
  await f.send('It closes when I press Start on Windows'); assert.equal((await cases(f)).length, 1);
});
test('human assistance is persisted and acknowledgement is truthful', async () => {
  const f = setup(); const text = await (await f.send('I need a human')).text(); assert.match(text, /recorded/); assert.doesNotMatch(text, /submitted.*investigation/);
  assert.equal((await cases(f))[0].category, 'HUMAN_ASSISTANCE');
});
test('repeated webhook SID is idempotent and concurrency preserves global numbering', async () => {
  const f = setup(); const replies = await Promise.all(Array.from({ length: 10 }, (_, i) => f.send('PlaySmart spelling crashes', `whatsapp:+1555000${String(i).padStart(4, '0')}`, `SMrepeat${i}000000`)));
  assert.ok(replies.every(response => response.ok)); const items = await cases(f); assert.equal(items.length, 10); assert.equal(new Set(items.map(item => item.case_id)).size, 10);
  const original = await (await f.send('ReadSmart reading crashes', 'whatsapp:+15550009999', 'SMsame000000')).text();
  const repeat = await (await f.send('different message', 'whatsapp:+15550009999', 'SMsame000000')).text(); assert.equal(repeat, original); assert.equal((await cases(f)).length, 11);
});
test('follow-ups append to original case and another sender cannot read it', async () => {
  const f = setup(); await f.send('PlaySmart spelling crashes'); await f.send('It still crashes on Windows');
  const items = await cases(f); assert.equal(items.length, 1); assert.match(items[0].user_description, /Follow-up/);
  assert.match(await (await f.send('status PS-000001', 'whatsapp:+15550002222')).text(), /could not find/);
});
test('switching products opens a separate correctly routed case', async () => {
  const f = setup(); await f.send('PlaySmart spelling crashes'); await f.send('ReadSmart reading crashes'); assert.equal((await cases(f)).length, 2); assert.deepEqual(new Set((await cases(f)).map(item => item.product)), new Set(['PLAYSMART', 'READSMART']));
});
test('reset clears context but retains cases', async () => {
  const f = setup(); await f.send('PlaySmart spelling crashes'); await f.send('start over'); assert.equal((await cases(f)).length, 1); assert.match(await (await f.send('Spelling crashes')).text(), /PlaySmart, ReadSmart/);
});
test('legacy records normalize safely; malformed JSON, dates, arrays and metadata cannot crash list/detail', async () => {
  const kv = memoryKV({ 'support-case:sequence': '3', 'support-case:PS-000001': JSON.stringify({ case_id: 'PS-000001', severity: null, reproduction_steps: 'wrong type' }), 'support-case:PS-000002': '{bad', 'support-case:PS-000003': JSON.stringify({ case_id: 'PS-000003', created_at: '2026-09-01' }), 'support-case:PS-metadata': '{}' });
  const repository = new CaseRepository(kv); const items = await repository.list(); assert.equal(items.length, 2); assert.equal(items[1].product, 'UNKNOWN'); assert.deepEqual(items[1].reproduction_steps, []); assert.equal(await repository.get('PS-000002'), null); assert.equal(await repository.get('sequence'), null);
  assert.equal(normalizeCase({ case_id: 'PS-000001' }, 'PS-000002'), null);
});
test('bootstrap uses high-water mark and does not alter legacy KV', async () => {
  const initial = { 'support-case:sequence': '1', 'support-case:PS-000042': JSON.stringify({ case_id: 'PS-000042' }) }; const f = setup({}, initial); await f.send('PlaySmart spelling crashes'); assert.ok((await cases(f)).some(item => item.case_id === 'PS-000043')); assert.equal(f.env.NOTES_KV.values.get('support-case:sequence'), '1');
  const store = new MemoryStorage(); await assert.rejects(bootstrap(store, memoryKV(), false), /approved/);
});
test('staged failure rolls back all case and sequence writes', async () => {
  const storage = new MemoryStorage(); const staged = new StagedStore(storage); await new CaseRepository(staged).create({ product: 'PLAYSMART' }); assert.equal(await new StagedStore(storage).get('support-case:sequence'), null);
  const put = storage.put.bind(storage); storage.put = async (key, value) => { if (key.includes('PS-')) throw new Error('simulated storage error'); return put(key, value); };
  await assert.rejects(staged.commit()); assert.equal(await new StagedStore(storage).get('support-case:sequence'), null);
});
test('non-coordinated repository cannot allocate unsafe IDs', async () => { await assert.rejects(new CaseRepository(memoryKV()).create({}), /Coordinated/); });
test('redaction preserves module language and masks common credentials', () => {
  const text = sanitize('Student management is broken. password is EXAMPLE_ONLY. api_key="example secret" Bearer abc.def.ghi jane@example.com +27821234567');
  assert.match(text, /Student management is broken/); assert.doesNotMatch(text, /EXAMPLE_ONLY|example secret|abc.def.ghi|jane@example|27821234567|\$1/);
});
test('sensitive text is minimized before drafts, model calls and model output', async () => {
  const f = setup({ OPENAI_API_KEY: 'fake' }); const original = globalThis.fetch; const sent = [];
  globalThis.fetch = async (url, options) => { sent.push(options.body); return Response.json(String(url).endsWith('/conversations') ? { id: 'conv_test' } : { output_text: 'password=EXAMPLE_RESPONSE' }); };
  try { await f.send('PlaySmart password is EXAMPLE_SECRET'); assert.doesNotMatch(sent.join(' '), /EXAMPLE_SECRET/); for (const value of f.storage.values.values()) assert.doesNotMatch(JSON.stringify(value), /EXAMPLE_SECRET|EXAMPLE_RESPONSE/); } finally { globalThis.fetch = original; }
});
test('knowledge never crosses products or exposes unauthorized documents', () => {
  const service = new KnowledgeService(); assert.ok(service.retrieve('spelling', { product: 'PLAYSMART' }).length); assert.deepEqual(service.retrieve('spelling', { product: 'READSMART' }), []);
  const privateDocs = new KnowledgeService([{ id: 'private', product: 'READSMART', title: 'Reading', content: 'Private reading guide', module: 'reading', document_type: 'HOW_TO', version: '1', updated_at: '2026-09-23', source: 'test fixture', support_safe: true, keywords: ['reading'], visibility: 'AUTHENTICATED_CUSTOMER', customer_reference: 'a', centre_reference: 'c' }]);
  assert.equal(privateDocs.retrieve('reading', { product: 'READSMART' }).length, 0);
  assert.equal(privateDocs.retrieve('reading', { product: 'READSMART', scope: { verified: true, product: 'READSMART', allowedDocumentIds: ['private'], customer_reference: 'b', centre_reference: 'c' } }).length, 0);
  assert.equal(privateDocs.retrieve('reading', { product: 'READSMART', scope: { verified: true, product: 'READSMART', allowedDocumentIds: ['private'], customer_reference: 'a', centre_reference: 'c' } }).length, 1);
});
test('OpenAI outage does not cache a fake conversation; next attempt recovers', async () => {
  const kv = memoryKV(); const store = new ConversationStore({ NOTES_KV: kv, OPENAI_API_KEY: 'fake' }); const original = globalThis.fetch; let attempts = 0;
  globalThis.fetch = async () => ++attempts === 1 ? new Response('{}', { status: 503 }) : Response.json({ id: 'conv_recovered' });
  try { assert.equal((await store.getOrCreate('sender')).id, null); assert.equal(kv.values.size, 0); assert.equal((await store.getOrCreate('sender')).id, 'conv_recovered'); assert.equal((await store.getOrCreate('sender')).id, 'conv_recovered'); assert.equal(attempts, 2); } finally { globalThis.fetch = original; }
});
test('evidence and actor permissions gate bug confirmation, PR readiness and approvals', () => {
  const base = { status: 'INVESTIGATING' }; assert.match(validateTransition(base, { status: 'CONFIRMED_BUG' }), /evidence/);
  assert.equal(validateTransition(base, { status: 'CONFIRMED_BUG', technical_investigation: { result: 'CONFIRMED_BUG', evidence: ['Reproduction test fails'] } }), null);
  assert.match(validateTransition({ status: 'FIX_READY' }, { status: 'APPROVED' }, false), /Human/);
  assert.equal(validateTransition({ status: 'FIX_READY', pull_request: 'https://example.test/pr/1', technical_investigation: { result: 'CONFIRMED_BUG', evidence: ['Failing test'], tests: ['All tests pass'] } }, { status: 'APPROVED' }, true), null);
  assert.match(validateTransition({ status: 'FIX_IN_PROGRESS', technical_investigation: { result: 'CONFIRMED_BUG', evidence: ['Failing test'] } }, { status: 'FIX_READY' }), /pull request/);
});
test('repository revision conflicts prevent stale overwrites', async () => {
  const f = setup(); await f.send('PlaySmart spelling crashes'); const repo = new CaseRepository(f.store()); await assert.rejects(repo.update('PS-000001', { owner_notes: 'stale' }, { revision: 0 }), /changed/);
});
test('internal endpoint denies unauthenticated updates and direct approval', async () => {
  const f = setup({ CASE_STATUS_UPDATE_SECRET: 'test-secret' }); await f.send('PlaySmart spelling crashes');
  const request = headers => new Request('https://example.com/internal/support-cases/PS-000001', { method: 'POST', headers, body: JSON.stringify({ revision: 1, status: 'APPROVED' }) });
  assert.equal((await worker.fetch(request({}), f.env)).status, 401); assert.equal((await worker.fetch(request({ Authorization: 'Bearer test-secret' }), f.env)).status, 400);
});
test('pending question is stored and reporter reply updates original case', async () => {
  const f = setup({ CASE_STATUS_UPDATE_SECRET: 'secret' }); await f.send('PlaySmart spelling crashes');
  const response = await worker.fetch(new Request('https://example.com/internal/support-cases/PS-000001', { method: 'POST', headers: { Authorization: 'Bearer secret' }, body: JSON.stringify({ revision: 1, status: 'NEEDS_INFORMATION', question: 'Which Windows version?' }) }), f.env);
  assert.equal(response.status, 200); assert.equal((await cases(f))[0].pending_question, 'Which Windows version?');
  await f.send('Windows 11'); const items = await cases(f); assert.equal(items.length, 1); assert.equal(items[0].status, 'INVESTIGATING'); assert.equal(items[0].pending_question, '');
});
test('notifications are durably queued, not sent during webhook', async () => {
  const f = setup({ OWNER_WHATSAPP_NUMBER: 'whatsapp:+15559999999' }); const original = globalThis.fetch; globalThis.fetch = async () => { throw new Error('No synchronous network send expected'); };
  try { await f.send('PlaySmart spelling crashes'); const list = await f.store().list({ prefix: 'outbox:' }); assert.equal(list.keys.length, 1); assert.match(await f.store().get(list.keys[0].name), /PENDING/); } finally { globalThis.fetch = original; }
});
test('outbound messages require templates outside window and uncertain sends are not retried automatically', async () => {
  const env = { TWILIO_ACCOUNT_SID: 'fake', TWILIO_AUTH_TOKEN: 'fake', TWILIO_WHATSAPP_FROM: 'whatsapp:+15550000000' }; const item = { to: 'whatsapp:+15550000001', body: 'Update', case_id: 'PS-000001' };
  assert.equal((await deliverNotification(env, item, null)).reason, 'APPROVED_TEMPLATE_REQUIRED');
  const original = globalThis.fetch; globalThis.fetch = async () => { throw new Error('Timeout'); };
  try { assert.equal((await deliverNotification(env, item, Date.now())).status, 'UNCERTAIN'); } finally { globalThis.fetch = original; }
});
test('Twilio signature validates exact body and rejects tampering', async () => {
  const body = new URLSearchParams({ Body: 'hello', From: 'whatsapp:+15550000001' }).toString(); const url = 'https://example.com/webhook/whatsapp'; const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('secret'), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']); const sig = Buffer.from(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(url + 'BodyhelloFromwhatsapp:+15550000001'))).toString('base64');
  assert.equal(await validateTwilioSignature('secret', sig, url, body), true); assert.equal(await validateTwilioSignature('secret', sig, url, body.replace('hello', 'changed')), false);
});
test('Access protects HTML/API and permits authenticated case management', async () => {
  const f = setup(adminConfig); await f.send('PlaySmart spelling crashes'); const auth = await accessHeaders(); const original = globalThis.fetch;
  globalThis.fetch = async url => { assert.equal(url, 'https://team.example.com/cdn-cgi/access/certs'); return Response.json({ keys: [auth.publicJwk] }); };
  try {
    assert.equal((await worker.fetch(new Request('https://example.com/admin'), f.env)).status, 401);
    const html = await worker.fetch(new Request('https://example.com/admin', auth), f.env); assert.equal(html.status, 200);
    const listing = await worker.fetch(new Request('https://example.com/api/admin/cases?product=PLAYSMART', auth), f.env); const data = await listing.json(); assert.equal(data.total, 1); assert.equal(data.stats.products.PLAYSMART, 1);
    const patch = await worker.fetch(new Request('https://example.com/api/admin/cases/PS-000001', { method: 'PATCH', headers: auth.headers, body: JSON.stringify({ revision: 1, status: 'CLOSED', owner_notes: 'Verified' }) }), f.env); assert.equal(patch.status, 200); assert.equal((await cases(f))[0].status, 'CLOSED');
    const open = await worker.fetch(new Request('https://example.com/api/admin/cases?status=OPEN', auth), f.env); assert.equal((await open.json()).total, 0);
    const resolved = await worker.fetch(new Request('https://example.com/api/admin/cases?status=RESOLVED_GROUP', auth), f.env); assert.equal((await resolved.json()).total, 1);
  } finally { globalThis.fetch = original; }
});
test('Access rejects expired tokens and wrong audience without logging assertions', async () => {
  const f = setup(adminConfig); const expired = await accessHeaders({ exp: 1 }); assert.equal((await worker.fetch(new Request('https://example.com/admin', expired), f.env)).status, 401);
  const wrong = await accessHeaders({ aud: ['wrong'] }); assert.equal((await worker.fetch(new Request('https://example.com/admin', wrong), f.env)).status, 401);
});
test('agent router cannot infer repository or grant execution capabilities', () => {
  const router = new CodingAgentRouter({ PLAYSMART: { repository: 'playsmart', worker: 'ps' } }); assert.throws(() => router.plan({ product: 'UNKNOWN' })); assert.throws(() => router.plan({ product: 'READSMART' })); const plan = router.plan({ product: 'PLAYSMART', case_id: 'PS-000001' }); assert.equal(plan.mode, 'INVESTIGATE_ONLY'); assert.equal(plan.may_merge, false);
});

test('internal services cannot reapprove an already approved case or remove bug evidence', () => {
  const approved = { status: 'APPROVED', pull_request: 'https://example.test/pr/1', technical_investigation: { result: 'CONFIRMED_BUG', evidence: ['Failing test'], tests: ['Tests pass'] } };
  assert.match(validateTransition(approved, { status: 'APPROVED' }, false), /Human/);
  assert.match(validateTransition(approved, { technical_investigation: { result: 'NOT_A_BUG', evidence: [] } }, true), /evidence/);
});
test('malformed JSON and oversized requests receive controlled errors', async () => {
  const f = setup({ CASE_STATUS_UPDATE_SECRET: 'secret' }); await f.send('PlaySmart spelling crashes');
  const response = await worker.fetch(new Request('https://example.com/internal/support-cases/PS-000001', { method: 'POST', headers: { Authorization: 'Bearer secret' }, body: 'null' }), f.env); assert.equal(response.status, 400);
  const large = await f.send('x'.repeat(40000)); assert.equal(large.status, 413);
});
test('separate immutable events survive later case changes', async () => {
  const f = setup(); await f.send('PlaySmart spelling crashes'); const first = await f.store().get('support-event:PS-000001:000000000001'); await f.send('It crashes on Linux too'); assert.equal(await f.store().get('support-event:PS-000001:000000000001'), first); assert.ok(await f.store().get('support-event:PS-000001:000000000002'));
});
test('alarm mirrors cases and does not silently send a template-less owner alert', async () => {
  const f = setup({ OWNER_WHATSAPP_NUMBER: 'whatsapp:+15559999999', TWILIO_ACCOUNT_SID: 'fake', TWILIO_AUTH_TOKEN: 'fake', TWILIO_WHATSAPP_FROM: 'whatsapp:+15550000000' });
  await f.send('PlaySmart spelling crashes'); await f.coordinator.alarm(); assert.ok(f.env.NOTES_KV.values.has('support-case:PS-000001'));
  const jobs = await f.store().list({ prefix: 'outbox:' }); const job = JSON.parse(await f.store().get(jobs.keys[0].name)); assert.equal(job.status, 'BLOCKED'); assert.equal(job.reason, 'APPROVED_TEMPLATE_REQUIRED');
});
test('notification worker processes pending jobs beyond the first page of accepted jobs', async () => {
  const f = setup(); await f.send('PlaySmart spelling crashes'); const store = f.store();
  for (let i = 0; i < 105; i++) await store.put(`outbox:a${String(i).padStart(4, '0')}`, JSON.stringify({ status: 'ACCEPTED' }));
  await store.put('outbox:z-pending', JSON.stringify({ status: 'PENDING', next_attempt: 0, attempts: 0, to: 'whatsapp:+15550000000' })); await store.commit(); await f.coordinator.alarm();
  assert.equal(JSON.parse(await f.store().get('outbox:z-pending')).status, 'BLOCKED');
});

test('early camelCase production cases remain visible without rewriting or guessing identity', async () => {
  const legacy = { schemaVersion: 1, caseId: 'PS-000001', timestamp: '2026-09-21T09:00:00.000Z', updatedAt: '2026-09-21T10:00:00.000Z', userDescription: 'Spelling closes at Start', aiSummary: 'Lesson closes', category: 'BUG', severity: 'HIGH', status: 'NEW', reproductionSteps: ['Open lesson', 'Press Start'], appVersion: '1.2.1', sanitizedLogs: ['Startup failed'], sanitizedErrors: ['Example error'], conversationReference: { conversationId: 'legacy-reference', messageCount: 2 } };
  const raw = JSON.stringify(legacy); const kv = memoryKV({ 'support-case:PS-000001': raw }); const repo = new CaseRepository(kv);
  const item = await repo.get('PS-000001'); assert.equal(item.case_id, legacy.caseId); assert.equal(item.created_at, legacy.timestamp); assert.equal(item.user_description, legacy.userDescription); assert.equal(item.updated_at, legacy.updatedAt); assert.deepEqual(item.reproduction_steps, legacy.reproductionSteps); assert.equal(item.error_message, 'Example error'); assert.equal(item.product, 'UNKNOWN'); assert.equal(item.reporter_whatsapp_identifier, '[REDACTED]'); assert.equal(item.conversation_reference.conversationId, 'legacy-reference'); assert.equal((await repo.list()).length, 1); assert.equal(kv.values.get('support-case:PS-000001'), raw);
  assert.equal(normalizeCase({ ...legacy, caseId: 'PS-000002' }, 'PS-000001'), null);
});
