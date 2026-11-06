import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { build } from 'esbuild';
import assert from 'node:assert/strict';
const built = await build({ entryPoints: ['worker.js'], bundle: true, format: 'esm', write: false, platform: 'browser', target: 'es2022' });
const runtime = new Miniflare(convertV4MiniflareOptions({ modules: true, script: built.outputFiles[0].text, compatibilityDate: '2026-09-21', kvNamespaces: ['NOTES_KV'], durableObjects: { SUPPORT_COORDINATOR: { className: 'SupportCoordinator', useSQLite: true } }, bindings: { ENVIRONMENT: 'development', VALIDATE_TWILIO_SIGNATURE: 'false', COORDINATOR_BOOTSTRAP_APPROVED: 'true', APP_SUPPORT_ENABLED: 'true' } }));
const token = 'ab'.repeat(32);
const call = (path, body) => runtime.dispatchFetch('https://example.com/api/app-support/' + path, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
try {
  assert.equal((await call('session', { platform: 'synthetic-runtime' })).status, 200);
  const guide = await (await call('messages', { text: 'How do I change spelling speed?', action: 'chat', request_id: crypto.randomUUID() })).json();
  assert.equal(guide.messages.at(-1).role, 'assistant'); assert.equal(guide.case, null);
  const payload = { text: 'Synthetic runtime: Ticket closes', action: 'report', request_id: crypto.randomUUID() };
  const replies = await Promise.all([call('messages', payload), call('messages', payload)]);
  const first = await replies[0].json(), second = await replies[1].json();
  assert.deepEqual(first, second); assert.equal(first.case.case_id, 'PS-000001');
  const kv = await runtime.getKVNamespace('NOTES_KV');
  await new Promise(resolve => setTimeout(resolve, 2000));
  const record = await kv.get('support-case:PS-000001', 'json'); assert.equal(record.conversation_reference.channel, 'app');
  const human = await (await call('messages', { text: 'Synthetic human handoff', action: 'human', request_id: crypto.randomUUID() })).json();
  assert.equal(human.mode, 'WAITING');
  assert.equal((await runtime.dispatchFetch('https://example.com/api/admin/app-support')).status, 401);
  console.log('Actual workerd + SQLite passed: guest session, guide fallback, concurrent idempotent report, case mirror, human handoff and protected admin. No external provider calls.');
} finally { await runtime.dispose(); }
