import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { SupportCoordinator } from '../worker.js';
import { setup, adminConfig, accessHeaders } from './helpers.js';
import { CaseRepository } from '../support-cases.js';
import { digest } from '../privacy.js';
import { deliverNotification } from '../notifications.js';
const control = (f, action = '', method = 'POST', body) => f.coordinator.fetch(new Request(`https://example.com/api/admin/maintenance${action ? '/' + action : ''}`, { method, ...(method === 'POST' ? { body: JSON.stringify(body || {}), headers: { 'Content-Type': 'application/json' } } : {}) }));
const held = async f => [...(await f.storage.list({ prefix: 'held:' })).values()];

test('production activation requires a matching backup, saves a checkpoint and resumes idempotently', async () => {
  const initial = { 'support-case:sequence': '2', 'support-case:PS-000002': JSON.stringify({ caseId: 'PS-000002', status: 'NEW' }) };
  const expected = await digest(JSON.stringify(Object.entries(initial).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)));
  const f = setup({ ENVIRONMENT: 'production', CUTOVER_MODE: 'hold', MIGRATION_EXPECTED_SHA256: '0'.repeat(64) }, initial);
  assert.equal((await control(f, 'prepare-production')).status, 409);
  assert.equal((await control(f, 'resume')).status, 409);
  assert.equal((await control(f, '', 'GET').then(r => r.json())).mode, 'hold');
  f.env.MIGRATION_EXPECTED_SHA256 = expected;
  const report = await (await control(f, 'prepare-production')).json();
  assert.equal(report.cases, 1); assert.equal(report.nextCaseNumber, 3);
  const checkpoint = JSON.parse(await f.env.NOTES_KV.get('production-activation:checkpoint'));
  assert.equal(checkpoint.sha256, await digest(JSON.stringify(checkpoint.payload)));
  assert.deepEqual(await (await control(f, 'prepare-production')).json(), report);
  assert.equal((await control(f, 'resume')).status, 200);
  assert.equal(JSON.parse(await f.env.NOTES_KV.get('production-activation:latest')).mode, 'live');
  assert.equal(await f.store().get('support-case:PS-000002'), initial['support-case:PS-000002']);
});

test('hold captures once without bootstrap/KV writes, freezes admin writes and alarms', async () => {
  const f = setup({ CUTOVER_MODE: 'hold', COORDINATOR_BOOTSTRAP_APPROVED: 'false' });
  assert.equal((await f.send('ReadSmart reading crashes', undefined, 'SMheld000001')).status, 200);
  await f.send('ReadSmart reading crashes', undefined, 'SMheld000001');
  assert.equal((await held(f)).length, 1);
  assert.equal(await f.storage.get('initialized'), undefined);
  assert.equal(f.env.NOTES_KV.values.size, 0);
  assert.equal((await f.coordinator.fetch(new Request('https://example.com/api/admin/cases/PS-000001', { method: 'PATCH', body: '{}' }))).status, 503);
  await f.storage.put('mirror:support-case:sequence', { value: '99' });
  await f.coordinator.alarm(); assert.equal(f.env.NOTES_KV.values.size, 0);
  assert.equal((await control(f, 'resume')).status, 409);
  assert.equal((await control(f, 'replay')).status, 409);
});

test('replay commits cases, response outbox and checkpoint together; survives restart and does not extend service window', async () => {
  const f = setup({ CUTOVER_MODE: 'hold' });
  await f.send('ReadSmart reading crashes', undefined, 'SMheld000002');
  const [key, message] = [...await f.storage.list({ prefix: 'held:' })][0];
  const originalTime = Date.now() - 25 * 3600000;
  await f.storage.put(key, { ...message, receivedAt: originalTime });
  assert.equal((await control(f, 'bootstrap')).status, 200);
  const originalTransaction = f.storage.transaction.bind(f.storage);
  f.storage.transaction = async fn => originalTransaction(async tx => { await fn(tx); throw new Error('Synthetic commit interruption'); });
  await assert.rejects(control(f, 'replay'), /interruption/);
  assert.equal((await new CaseRepository(f.store()).list()).length, 0);
  assert.equal((await held(f))[0].status, 'PENDING');
  f.storage.transaction = originalTransaction;
  f.coordinator = new SupportCoordinator({ storage: f.storage }, f.env);
  assert.equal((await control(f, 'replay')).status, 200);
  assert.equal((await new CaseRepository(f.store()).list()).length, 1);
  assert.deepEqual(await (await control(f, 'replay')).json(), { replayed: 0, pending: 0 });
  const completed = (await held(f))[0]; assert.equal(completed.status, 'PROCESSED'); assert.equal(completed.body, undefined); assert.equal(completed.from, undefined);
  const sender = await digest('whatsapp:+15550001111');
  assert.equal(Number(await f.store().get(`last-inbound:${sender}`)), originalTime);
  const jobs = (await f.store().list({ prefix: 'outbox:cutover:' })).keys;
  assert.equal(jobs.length, 1);
  const job = JSON.parse(await f.store().get(jobs[0].name));
  const outcome = await deliverNotification({ TWILIO_ACCOUNT_SID: 'synthetic', TWILIO_AUTH_TOKEN: 'synthetic', TWILIO_WHATSAPP_FROM: 'synthetic', TWILIO_UPDATE_CONTENT_SID: 'synthetic' }, job, originalTime);
  assert.equal(outcome.reason, 'REPLAY_SERVICE_WINDOW_EXPIRED');
  assert.equal((await control(f, 'resume')).status, 200);
  await f.send('ReadSmart reading crashes', undefined, 'SMheld000002');
  assert.equal((await new CaseRepository(f.store()).list()).length, 1);
});

test('held messages replay in arrival order and resume rejects new arrivals', async () => {
  const f = setup({ CUTOVER_MODE: 'hold' });
  await f.send('PlaySmart', undefined, 'SMordered00001');
  await f.send('Spelling crashes when I press Start', undefined, 'SMordered00002');
  await control(f, 'bootstrap'); await control(f, 'replay');
  assert.equal((await control(f, 'resume')).status, 409);
  await control(f, 'replay');
  const keys = (await new CaseRepository(f.store()).list()); assert.equal(keys.length, 1);
  assert.equal(keys[0].product, 'PLAYSMART');
});

test('snapshot recovery preserves state, refuses corruption/nonempty restore and quarantines interrupted sends', async () => {
  const f = setup(); await f.send('ReadSmart reading crashes');
  const store = f.store();
  await store.put('outbox:interrupted', JSON.stringify({ status: 'SENDING', to: 'whatsapp:+15550001111' })); await store.commit();
  assert.equal((await control(f, 'export', 'GET')).status, 409);
  await control(f, 'hold'); await f.send('PlaySmart spelling crashes', 'whatsapp:+15550002222', 'SMrecovery0001');
  const snapshot = await (await control(f, 'export', 'GET')).json();
  const restored = setup({ CUTOVER_MODE: 'hold', COORDINATOR_BOOTSTRAP_APPROVED: 'false' });
  const corrupt = structuredClone(snapshot); corrupt.payload.entries.push(['initialized', 'fake']);
  assert.equal((await control(restored, 'restore', 'POST', corrupt)).status, 409);
  assert.deepEqual([...restored.storage.values.keys()], ['maintenance:mode']);
  assert.equal((await control(restored, 'restore', 'POST', snapshot)).status, 200);
  assert.equal((await control(restored, 'restore', 'POST', snapshot)).status, 409);
  assert.equal((await held(restored)).filter(item => item.status === 'PENDING').length, 1);
  assert.equal(JSON.parse(await restored.store().get('outbox:interrupted')).status, 'UNCERTAIN');
  assert.equal((await control(restored, '', 'GET')).status, 200);
  await control(restored, 'replay');
  assert.equal(await restored.store().get('support-case:sequence'), '2');
  assert.equal((await new CaseRepository(restored.store()).list()).length, 2);
});

test('maintenance controls require Access, same origin and JSON; invalid Twilio signatures cannot enter hold queue', async () => {
  const f = setup({ ...adminConfig, CUTOVER_MODE: 'hold', ENVIRONMENT: 'production', VALIDATE_TWILIO_SIGNATURE: 'true', TWILIO_AUTH_TOKEN: 'synthetic' });
  assert.equal((await worker.fetch(new Request('https://example.com/api/admin/maintenance/export'), f.env)).status, 401);
  assert.equal((await f.send('hello')).status, 403); assert.equal((await held(f)).length, 0);
  const auth = await accessHeaders(); const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ keys: [auth.publicJwk] });
  try {
    const req = headers => new Request('https://example.com/api/admin/maintenance/hold', { method: 'POST', headers: { ...auth.headers, ...headers }, body: '{}' });
    assert.equal((await worker.fetch(req({ Origin: 'https://attacker.invalid', 'Content-Type': 'application/json' }), f.env)).status, 403);
    assert.equal((await worker.fetch(req({ 'Content-Type': 'text/plain' }), f.env)).status, 415);
    assert.equal((await worker.fetch(req({ Origin: 'https://example.com', 'Content-Type': 'application/json' }), f.env)).status, 200);
  } finally { globalThis.fetch = originalFetch; }
});

test('remote recovery routing is owner-only, staging-only and isolated from the primary coordinator', async () => {
  const { StagingRecoveryCoordinator } = await import('../worker.js');
  const { MemoryStorage, memoryKV } = await import('./helpers.js');
  const storage = new MemoryStorage(); const recoveredKV = memoryKV();
  const f = setup({ ...adminConfig, ENVIRONMENT: 'staging', RECOVERY_KV: recoveredKV });
  const recovered = new StagingRecoveryCoordinator({ storage }, f.env);
  f.env.SUPPORT_RECOVERY = { idFromName: name => name, get: () => recovered };
  assert.throws(() => new StagingRecoveryCoordinator({ storage }, { ...f.env, ENVIRONMENT: 'production' }));
  assert.throws(() => new StagingRecoveryCoordinator({ storage }, { ...f.env, TWILIO_ACCOUNT_SID: 'live' }));
  const auth = await accessHeaders(); const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ keys: [auth.publicJwk] });
  try {
    const request = headers => new Request('https://example.com/api/admin/maintenance/recovery', { headers });
    assert.equal((await worker.fetch(request(), f.env)).status, 401);
    assert.equal((await worker.fetch(request(auth.headers), { ...f.env, ENVIRONMENT: 'production' })).status, 404);
    const response = await worker.fetch(request(auth.headers), f.env);
    assert.deepEqual(await response.json(), { mode: 'hold', pending: 0, initialized: false });
    assert.equal(f.storage.values.size, 0, 'Primary coordinator was never touched');
    assert.equal(recovered.env.NOTES_KV, recoveredKV);
  } finally { globalThis.fetch = originalFetch; }
});

test('owner-triggered staging page rehearses real handlers and refuses concurrent/repeated runs', async () => {
  const { StagingRecoveryCoordinator } = await import('../worker.js');
  const { MemoryStorage, memoryKV } = await import('./helpers.js');
  const f = setup({ ...adminConfig, ENVIRONMENT: 'staging', VALIDATE_TWILIO_SIGNATURE: 'true', TWILIO_AUTH_TOKEN: 'synthetic', RECOVERY_KV: memoryKV() });
  const targets = new Map();
  f.env.SUPPORT_RECOVERY = { idFromName: name => name, get: name => { if (!targets.has(name)) targets.set(name, new StagingRecoveryCoordinator({ storage: new MemoryStorage() }, f.env)); return targets.get(name); } };
  await f.coordinator.fetch(new Request('https://example.com/api/admin/cases'));
  const auth = await accessHeaders(); const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ keys: [auth.publicJwk] });
  const request = (suffix = '', headers = auth.headers) => new Request(`https://skoolio-support-staging.cowleyjared.workers.dev/api/admin/staging-rehearsal${suffix}`, { method:'POST', headers:{...headers, 'Content-Type':'application/json'},body:'{}' });
  try {
    assert.equal((await worker.fetch(request('', {}), f.env)).status, 401);
    assert.equal((await worker.fetch(request(), {...f.env, ENVIRONMENT:'production'})).status, 404);
    const response = await worker.fetch(request(), f.env); const report = await response.json();
    assert.equal(response.status, 200, JSON.stringify(report)); assert.equal(report.finalCases, 2); assert.equal(report.status, 'PASSED');
    assert.equal((await worker.fetch(request(), f.env)).status, 409);
    assert.equal((await worker.fetch(request('?finalize=true'), f.env)).status, 202);
    await f.coordinator.alarm(); await targets.get('skoolio-staging-recovery-v1').alarm();
    const final = await (await worker.fetch(request('?finalize=true'), f.env)).json();
    assert.equal(final.alarmVerification, 'PASSED'); assert.equal(final.recoveryMode, 'hold'); assert.equal(final.providerAcceptedMessages, 0);
    assert.equal(await f.storage.get('maintenance:mode'), 'live');
  } finally { globalThis.fetch = originalFetch; }
});
