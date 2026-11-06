import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker.js';
import { setup, accessHeaders, adminConfig } from './helpers.js';
import { CaseRepository } from '../support-cases.js';
import { saveSupportGuide } from '../support-guides.js';

const guide = { product: 'READSMART', title: 'Set the practice timer', keywords: 'timer, practice', content: '1. Open Practice.\n2. Choose Timer.\n3. Select the duration.', published: true };

test('how-to questions preserve the question through product clarification and work without AI', async () => {
  const f = setup();
  assert.match(await (await f.send('How do I start a spelling lesson?')).text(), /PlaySmart, ReadSmart/);
  const reply = await (await f.send('PlaySmart')).text();
  assert.match(reply, /1\. Use the spelling word list/);
  assert.match(reply, /4\. Complete the lesson/);
  assert.equal((await new CaseRepository(f.store()).list()).length, 0);
});

test('how-to and progress questions do not become follow-ups to an unrelated open case', async () => {
  const f = setup(); await f.send('PlaySmart has an issue');
  const before = (await new CaseRepository(f.store()).list())[0];
  assert.match(await (await f.send('How do I view reading progress?')).text(), /1\./);
  assert.match(await (await f.send('How do I redo wrong spelling words?')).text(), /word list/);
  assert.deepEqual((await new CaseRepository(f.store()).list())[0], before);
});

test('missing knowledge asks for a screen instead of inventing product steps or repeating welcome', async () => {
  const f = setup();
  const text = await (await f.send('ReadSmart: how do I configure the practice timer?')).text();
  assert.match(text, /What screen are you on/); assert.doesNotMatch(text, /Welcome|report-card/);
});

test('published owner guides are used only for their product, drafts and withdrawn guides are excluded', async () => {
  const f = setup(); const store = f.store();
  const saved = await saveSupportGuide(store, guide); await store.commit();
  assert.match(await (await f.send('ReadSmart: how do I set the practice timer?')).text(), /Choose Timer/);
  assert.doesNotMatch(await (await f.send('Skoolio Admin: how do I set the practice timer?')).text(), /Choose Timer/);
  const changed = f.store(); await saveSupportGuide(changed, { ...guide, id: saved.id, revision: saved.revision, published: false }); await changed.commit();
  assert.doesNotMatch(await (await f.send('ReadSmart: how do I set the practice timer?')).text(), /Choose Timer/);
});

test('guide API enforces owner auth, origin, JSON, revision and redaction', async () => {
  const f = setup(adminConfig), auth = await accessHeaders(), original = globalThis.fetch;
  const request = (body, headers = {}) => new Request('https://example.com/api/admin/guides', { method: 'POST', headers: { ...auth.headers, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  globalThis.fetch = async () => Response.json({ keys: [auth.publicJwk] });
  try {
    assert.equal((await worker.fetch(new Request('https://example.com/api/admin/guides'), f.env)).status, 401);
    assert.equal((await worker.fetch(request(guide, { Origin: 'https://attacker.invalid' }), f.env)).status, 403);
    assert.equal((await worker.fetch(request(guide, { 'Content-Type': 'text/plain' }), f.env)).status, 415);
    const response = await worker.fetch(request({ ...guide, content: guide.content + '\npassword=EXAMPLE_SECRET' }), f.env);
    assert.equal(response.status, 200); const { guide: saved } = await response.json(); assert.doesNotMatch(saved.content, /EXAMPLE_SECRET/);
    assert.equal((await worker.fetch(request({ ...guide, id: saved.id, revision: 0 }), f.env)).status, 409);
    assert.equal((await worker.fetch(request({ ...guide, product: 'UNKNOWN' }), f.env)).status, 400);
    const listed = await (await worker.fetch(new Request('https://example.com/api/admin/guides', auth), f.env)).json(); assert.equal(listed.guides.length, 1);
  } finally { globalThis.fetch = original; }
});

test('Afrikaans fallback stays in Afrikaans without inventing translated product controls', async () => {
  const { supportFallback } = await import('../support-guidance.js');
  const message = supportFallback('Ek kan nie aanmeld nie. Wat moet ek doen?', [], { product: 'PLAYSMART' });
  assert.match(message, /Moenie jou wagwoord/);
  assert.doesNotMatch(message, /Let’s|What screen/);
  const unknown = supportFallback('Waar is die lesinstellings?', [], { product: 'PLAYSMART' });
  assert.match(unknown, /bevestigde Afrikaanse stappe/);
});
