import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker.js';
import { CaseRepository } from '../support-cases.js';
import { setup, accessHeaders, adminConfig } from './helpers.js';

const token = 'ab'.repeat(32);
function guest(fixture, path = '/session', method = 'POST', body = {}, session = token, headers = {}) {
  return worker.fetch(new Request('https://example.com/api/app-support' + path, {
    method, headers: { Authorization: `Bearer ${session}`, 'Content-Type': 'application/json', ...headers },
    ...(method === 'GET' ? {} : { body: JSON.stringify(body) }),
  }), fixture.env);
}
const send = (fixture, text, action = 'chat', request_id = crypto.randomUUID()) => guest(fixture, '/messages', 'POST', { text, action, request_id });
async function owner(fixture, fn) {
  const auth = await accessHeaders();
  Object.assign(fixture.env, adminConfig);
  const original = globalThis.fetch;
  globalThis.fetch = async url => { assert.equal(String(url), 'https://team.example.com/cdn-cgi/access/certs'); return Response.json({ keys: [auth.publicJwk] }); };
  const call = (suffix = '', method = 'GET', body, headers = {}) => worker.fetch(new Request('https://example.com/api/admin/app-support' + suffix, {
    method, headers: { ...auth.headers, 'Content-Type': 'application/json', ...headers },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }), fixture.env);
  try { return await fn(call); } finally { globalThis.fetch = original; }
}

test('app channel is opt-in and admin routes retain Access protection', async () => {
  assert.equal((await guest(setup())).status, 503);
  const fixture = setup({ APP_SUPPORT_ENABLED: 'true' });
  assert.equal((await guest(fixture, '/session', 'POST', {}, 'bad')).status, 401);
  assert.equal((await worker.fetch(new Request('https://example.com/api/admin/app-support'), fixture.env)).status, 401);
  assert.equal((await guest(fixture, '/session', 'POST', {}, token, { Origin: 'https://evil.invalid' })).status, 403);
  assert.equal((await guest(fixture, '/session', 'POST', {}, token, { 'Content-Type': 'text/plain' })).status, 415);
});

test('private guest conversations resume and cannot select another thread by ID', async () => {
  const fixture = setup({ APP_SUPPORT_ENABLED: 'true' });
  const first = await (await guest(fixture)).json();
  assert.equal(first.mode, 'AI'); assert.equal(first.human_available, false);
  assert.deepEqual(await (await guest(fixture)).json(), first);
  const secondToken = 'cd'.repeat(32);
  const second = await (await guest(fixture, '/session', 'POST', {}, secondToken)).json();
  assert.notEqual(second.id, first.id);
  const attempt = await guest(fixture, '/session?id=' + first.id, 'GET', {}, secondToken);
  assert.equal((await attempt.json()).id, second.id);
  assert.equal((await guest(fixture, '/messages/' + first.id, 'GET', {}, secondToken)).status, 404);
  assert.equal(JSON.stringify([...fixture.storage.values]).includes(token), false);
});

test('reports create one PS case, sanitize secrets and retry atomically', async () => {
  const fixture = setup({ APP_SUPPORT_ENABLED: 'true' });
  await guest(fixture);
  const id = crypto.randomUUID();
  const text = 'Ticket closes when I press Play. password=synthetic-secret';
  const responses = await Promise.all([send(fixture, text, 'report', id), send(fixture, text, 'report', id)]);
  for (const response of responses) assert.equal(response.status, 200);
  const data = await responses[0].json();
  assert.match(data.case.case_id, /^PS-\d{6}$/);
  assert.equal(data.case.status, 'NEW');
  assert.equal(data.messages.length, 3);
  assert.ok(!JSON.stringify(data).includes('synthetic-secret'));
  const cases = await new CaseRepository(fixture.store()).list();
  assert.equal(cases.length, 1); assert.equal(cases[0].conversation_reference.channel, 'app');
  assert.equal(cases[0].conversation_reference.conversationId, data.id);
  assert.equal((await send(fixture, 'Different message', 'report', id)).status, 409);
  assert.equal((await send(fixture, 'More details', 'report')).status, 200);
  assert.equal((await new CaseRepository(fixture.store()).list()).length, 1);
  assert.deepEqual(Object.keys(data.case).sort(), ['case_id', 'status']);
});

test('how-to uses existing guides; a reported issue creates a case without claiming a fix', async () => {
  const fixture = setup({ APP_SUPPORT_ENABLED: 'true' });
  await guest(fixture);
  const answer = await (await send(fixture, 'How do I change spelling speed?')).json();
  assert.equal(answer.case, null); assert.equal(answer.messages.at(-1).role, 'assistant');
  assert.ok(answer.messages.at(-1).text.length > 20);
  const report = await (await send(fixture, 'PlaySmart crashes when I open a lesson')).json();
  assert.match(report.case.case_id, /^PS-/); assert.equal(report.case.status, 'NEW');
});

test('human handoff, owner replies, presence expiry and private case fields', async () => {
  const fixture = setup({ APP_SUPPORT_ENABLED: 'true' });
  await guest(fixture);
  let data = await (await send(fixture, 'I need a person', 'human')).json();
  const threadId = data.id;
  assert.equal(data.mode, 'WAITING');
  data = await (await send(fixture, 'Can you ask me a question?')).json();
  assert.equal(data.messages.at(-1).role, 'user');
  await owner(fixture, async admin => {
    assert.equal((await admin('/presence', 'POST', { available: true }, { Origin: 'https://evil.invalid' })).status, 403);
    assert.equal((await admin('/presence', 'POST', { available: true })).status, 200);
    assert.equal((await (await guest(fixture, '/session', 'GET')).json()).human_available, true);
    const listed = await (await admin()).json(); assert.equal(listed.threads.length, 1);
    const payload = { text: 'Which screen were you on?', request_id: crypto.randomUUID() };
    const reply = await (await admin('/' + threadId + '/messages', 'POST', payload)).json();
    const retry = await (await admin('/' + threadId + '/messages', 'POST', payload)).json();
    assert.deepEqual(reply, retry); assert.equal(reply.mode, 'HUMAN');
    assert.equal(reply.messages.at(-1).text, payload.text);
    const store = fixture.store(); const repo = new CaseRepository(store); const item = await repo.get(reply.case.case_id);
    await repo.update(item.case_id, { owner_notes: 'INTERNAL ONLY', pending_question: 'PRIVATE QUESTION' }, { revision: item.revision }); await store.commit();
    const customer = await (await guest(fixture, '/session', 'GET')).json();
    assert.ok(!JSON.stringify(customer).includes('INTERNAL ONLY')); assert.ok(!JSON.stringify(customer).includes('PRIVATE QUESTION'));
    const realNow = Date.now; Date.now = () => realNow() + 91000;
    try { assert.equal((await (await guest(fixture, '/session', 'GET')).json()).human_available, false); }
    finally { Date.now = realNow; }
  });
  const resumed = await (await send(fixture, 'How do I start reading?', 'ai')).json();
  assert.equal(resumed.mode, 'AI'); assert.equal(resumed.messages.at(-1).role, 'assistant');
});

test('rate limits, input bounds and persisted conversation expiry', async () => {
  const fixture = setup({ APP_SUPPORT_ENABLED: 'true' });
  await guest(fixture);
  assert.equal((await send(fixture, 'x'.repeat(4001))).status, 400);
  assert.equal((await send(fixture, 'hello', 'invalid')).status, 400);
  assert.equal((await send(fixture, 'hello', 'chat', 'short')).status, 400);
  for (let i = 0; i < 15; i++) assert.equal((await send(fixture, 'Waiting', 'human')).status, 200);
  assert.equal((await send(fixture, 'Waiting', 'human')).status, 429);
  const realNow = Date.now; Date.now = () => realNow() + 31 * 86400000;
  try { assert.equal((await guest(fixture, '/session', 'GET')).status, 404); }
  finally { Date.now = realNow; }
});

test('a failed commit leaves neither partial case nor duplicate message on retry', async () => {
  const fixture = setup({ APP_SUPPORT_ENABLED: 'true' });
  await guest(fixture);
  const transaction = fixture.storage.transaction.bind(fixture.storage);
  const id = crypto.randomUUID();
  fixture.storage.transaction = async () => { throw new Error('Synthetic persistence outage'); };
  assert.equal((await send(fixture, 'Ticket crashes', 'report', id)).status, 500);
  fixture.storage.transaction = transaction;
  assert.equal((await new CaseRepository(fixture.store()).list()).length, 0);
  const result = await (await send(fixture, 'Ticket crashes', 'report', id)).json();
  assert.equal(result.messages.length, 3);
  assert.equal((await new CaseRepository(fixture.store()).list()).length, 1);
});

test('app and WhatsApp reports share the coordinated case sequence', async () => {
  const fixture = setup({ APP_SUPPORT_ENABLED: 'true' });
  await guest(fixture);
  const replies = await Promise.all([send(fixture, 'Ticket crashes', 'report'), fixture.send('PlaySmart crashes when I start a reading lesson')]);
  for (const reply of replies) assert.equal(reply.status, 200);
  const cases = await new CaseRepository(fixture.store()).list();
  assert.equal(cases.length, 2);
  assert.equal(new Set(cases.map(item => item.case_id)).size, 2);
  assert.deepEqual(cases.map(item => item.conversation_reference.channel).sort(), ['app', 'whatsapp']);
});
