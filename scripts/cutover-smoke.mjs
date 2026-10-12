// Local synthetic-only rehearsal. No Cloudflare account or provider access.
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';
import { accessHeaders, adminConfig } from '../test/helpers.js';
const root = await mkdtemp(join(tmpdir(), 'skoolio-cutover-'));
const auth = await accessHeaders(); let providerCalls = 0;
const built = await build({ entryPoints: ['worker.js'], bundle: true, format: 'esm', write: false, platform: 'browser', target: 'es2022' });
const start = (name, approved = 'false') => new Miniflare(convertV4MiniflareOptions({ modules: true, script: built.outputFiles[0].text, compatibilityDate: '2026-09-21', kvNamespaces: ['NOTES_KV'], resourcePersistencePath: join(root, name, 'resources'), isolatedResourcePersistencePath: join(root, name, 'isolated'), durableObjects: { SUPPORT_COORDINATOR: { className: 'SupportCoordinator', useSQLite: true } }, bindings: { ...adminConfig, ENVIRONMENT: 'production', VALIDATE_TWILIO_SIGNATURE: 'true', TWILIO_AUTH_TOKEN: 'synthetic-cutover-token', COORDINATOR_BOOTSTRAP_APPROVED: approved, CUTOVER_MODE: 'hold' }, outboundService: async request => {
  if (request.url === 'https://team.example.com/cdn-cgi/access/certs') return Response.json({ keys: [auth.publicJwk] });
  providerCalls++; return new Response('Provider access prohibited in this rehearsal', { status: 403 });
} }));
const control = (runtime, action = '', method = 'POST', body = {}) => runtime.dispatchFetch(`https://local.example/api/admin/maintenance${action ? '/' + action : ''}`, { method, headers: { ...auth.headers, 'Content-Type': 'application/json' }, ...(method === 'POST' ? { body: JSON.stringify(body) } : {}) });
const send = (runtime, sid, body, from = 'whatsapp:+15550001001') => {
  const url = 'https://local.example/webhook/whatsapp';
  const form = new URLSearchParams({ From: from, MessageSid: sid, Body: body });
  const signed = url + [...form.keys()].sort().map(key => key + form.get(key)).join('');
  return runtime.dispatchFetch(url, { method: 'POST', headers: { 'X-Twilio-Signature': createHmac('sha1', 'synthetic-cutover-token').update(signed).digest('base64') }, body: form });
};
let primary; let recovery;
try {
  primary = start('primary');
  const kv = await primary.getKVNamespace('NOTES_KV');
  await kv.put('support-case:sequence', '41');
  await kv.put('support-case:PS-000041', JSON.stringify({ schemaVersion: 1, caseId: 'PS-000041', timestamp: '2026-09-20T10:00:00.000Z', userDescription: 'Synthetic legacy case', status: 'NEW' }));
  const arrivals = await Promise.all(Array.from({ length: 4 }, () => send(primary, 'SMcutover00001', 'PlaySmart spelling crashes when I press Start')));
  assert.ok(arrivals.every(response => response.status === 200));
  assert.deepEqual(await (await control(primary, '', 'GET')).json(), { mode: 'hold', pending: 1, initialized: false });
  assert.equal(await kv.get('support-case:sequence'), '41');
  assert.equal((await control(primary, 'replay')).status, 409);
  await primary.dispose(); primary = start('primary', 'true');
  assert.equal((await (await control(primary, '', 'GET')).json()).pending, 1, 'Capture survives complete runtime restart');
  assert.equal((await control(primary, 'bootstrap')).status, 200);
  assert.equal((await control(primary, 'replay')).status, 200);
  assert.deepEqual(await (await control(primary, 'replay')).json(), { replayed: 0, pending: 0 });
  let cases = await (await primary.dispatchFetch('https://local.example/api/admin/cases', auth)).json();
  assert.equal(cases.total, 2); assert.ok(cases.cases.some(item => item.case_id === 'PS-000042'));
  assert.equal(await (await primary.getKVNamespace('NOTES_KV')).get('support-case:sequence'), '41', 'Mirrors remain frozen during hold');
  await send(primary, 'SMcutover00002', 'ReadSmart reading crashes on Start', 'whatsapp:+15550001002');
  assert.equal((await control(primary, 'resume')).status, 409);
  const snapshot = await (await control(primary, 'export', 'GET')).json();
  recovery = start('recovery');
  const corrupt = structuredClone(snapshot); corrupt.sha256 = 'bad';
  assert.equal((await control(recovery, 'restore', 'POST', corrupt)).status, 409);
  assert.equal((await control(recovery, 'restore', 'POST', snapshot)).status, 200);
  assert.equal((await control(recovery, 'restore', 'POST', snapshot)).status, 409);
  assert.equal((await control(recovery, 'replay')).status, 200);
  assert.equal((await control(recovery, 'resume')).status, 200);
  await recovery.dispose(); recovery = start('recovery');
  assert.equal((await (await control(recovery, '', 'GET')).json()).mode, 'live', 'Explicit resume survives a restart with initial hold configuration');
  const duplicate = await send(recovery, 'SMcutover00002', 'ReadSmart reading crashes on Start', 'whatsapp:+15550001002');
  assert.match(await duplicate.text(), /RS-000043/);
  cases = await (await recovery.dispatchFetch('https://local.example/api/admin/cases', auth)).json();
  assert.equal(cases.total, 3);
  await new Promise(resolve => setTimeout(resolve, 2000));
  const restoredKV = await recovery.getKVNamespace('NOTES_KV');
  assert.equal(await restoredKV.get('support-case:sequence'), '43');
  assert.equal((await restoredKV.list({ prefix: 'support-case:' })).keys.filter(k => /^support-case:(?:PS|RS|SA|GS)-\d+$/.test(k.name)).length, 3, 'Recovery rebuilds all case mirrors, including the legacy baseline');
  assert.equal(providerCalls, 0);
  console.log('Local workerd cutover/recovery passed: signed durable capture, concurrent deduplication, restart, ordered replay, legacy numbering, frozen mirrors, snapshot integrity, isolated restore, resumed alarms. External provider calls: 0.');
} finally {
  await Promise.allSettled([primary?.dispose(), recovery?.dispose()]);
  await rm(root, { recursive: true, force: true });
}
