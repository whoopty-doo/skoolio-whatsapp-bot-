// Uses only the dedicated owner browser session. No existing browser profile or
// Access cookie is extracted. All network targets below are isolated staging.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHmac, randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { validateSnapshot } from '../recovery.js';
const base = 'https://skoolio-support-staging.cowleyjared.workers.dev';
const connection = JSON.parse(await readFile('.artifacts/staging-owner-browser/connection.private.json', 'utf8'));
if (!/^ws:\/\/127\.0\.0\.1:\d+\//.test(connection.endpoint)) throw new Error('Expected the dedicated local browser endpoint');
const secrets = JSON.parse(await readFile('.dev.vars.staging.json', 'utf8'));
const directory = `.artifacts/staging-cutover/${new Date().toISOString().replace(/[:.]/g, '-')}`;
await mkdir(directory, { recursive: true, mode: 0o700 });
const socket = new WebSocket(connection.endpoint); await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
let next = 0; const calls = new Map(); let primaryHeld = false;
socket.on('message', raw => { const message = JSON.parse(raw); if (!message.id) return; const call = calls.get(message.id); if (!call) return; calls.delete(message.id); clearTimeout(call.timeout); message.error ? call.reject(new Error('Browser command failed')) : call.resolve(message.result); });
const command = (method, params = {}, sessionId) => new Promise((resolve, reject) => { const id = ++next; const timeout = setTimeout(() => { calls.delete(id); reject(new Error('Browser command timed out')); }, 40000); calls.set(id, { resolve, reject, timeout }); socket.send(JSON.stringify({ id, method, params, sessionId })); });
let evaluate;
const api = async (path, method = 'GET', body, expected = 200) => {
  assert.ok(path.startsWith('/api/admin/'));
  const result = await evaluate(`(async () => { if (location.origin !== ${JSON.stringify(base)}) return {status:0}; const r = await fetch(${JSON.stringify(path)}, {method:${JSON.stringify(method)}, headers:{'Content-Type':'application/json'}, ${body !== undefined ? `body:JSON.stringify(${JSON.stringify(body)}),` : ''} redirect:'error', signal:AbortSignal.timeout(30000)}); return {status:r.status, data:r.headers.get('content-type')?.includes('application/json') ? await r.json() : null}; })()`);
  assert.equal(result.status, expected, `${method} ${path} returned expected status`); return result.data;
};
const control = (action = '', method = 'POST', body = {}, target = '', expected = 200) => api(`/api/admin/maintenance${target ? '/recovery' : ''}${action ? '/' + action : ''}`, method, method === 'POST' ? body : undefined, expected);
const run = randomBytes(6).toString('hex');
const senderA = `whatsapp:+1555${parseInt(run.slice(0, 7), 16).toString().padStart(8, '0')}`;
const senderB = `whatsapp:+1556${parseInt(run.slice(0, 7), 16).toString().padStart(8, '0')}`;
const send = async (suffix, body, from = senderA) => {
  const params = new URLSearchParams({ From: from, MessageSid: `SMcutover${run}${suffix}`, Body: body });
  const url = base + '/webhook/whatsapp'; const signature = createHmac('sha1', secrets.TWILIO_AUTH_TOKEN).update(url + [...params.keys()].sort().map(key => key + params.get(key)).join('')).digest('base64');
  const response = await fetch(url, { method: 'POST', headers: { 'X-Twilio-Signature': signature }, body: params, signal: AbortSignal.timeout(30000) });
  assert.equal(response.status, 200, 'Signed synthetic staging webhook accepted'); return response.text();
};
try {
  const { sessionId } = await command('Target.attachToTarget', { targetId: connection.target, flatten: true });
  evaluate = async expression => { const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId); if (result.exceptionDetails) throw new Error('Dedicated browser request failed; check owner login/session'); return result.result.value; };
  console.log('Waiting for the owner dashboard in the dedicated staging browser.');
  const deadline = Date.now() + 10 * 60 * 1000; let ready = false;
  while (Date.now() < deadline) {
    try { ready = await evaluate(`location.origin === ${JSON.stringify(base)} && location.pathname === '/admin' && Boolean(document.getElementById('cases'))`); } catch {}
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  assert.ok(ready, 'Owner login is required; no staging mutations have started');
  const status = await control('', 'GET');
  assert.deepEqual(status, { mode: 'live', pending: 0, initialized: true }, 'Primary staging must start live with no held backlog');
  assert.deepEqual(await control('', 'GET', {}, 'recovery'), { mode: 'hold', pending: 0, initialized: false }, 'Recovery target must be empty');
  const health = await (await fetch(base + '/health')).json(); assert.equal(health.aiConfigured, false);
  for (const path of ['/api/admin/maintenance', '/api/admin/maintenance/export', '/api/admin/maintenance/recovery']) {
    const response = await fetch(base + path, { redirect: 'manual' }); assert.equal(response.status, 302, 'Anonymous operator requests are challenged by Access');
    assert.equal(new URL(response.headers.get('location')).hostname, 'falling-band-2215.cloudflareaccess.com');
  }
  const before = await api('/api/admin/cases');
  await control('hold'); primaryHeld = true;
  const baseline = await control('export', 'GET'); await validateSnapshot(baseline);
  await writeFile(`${directory}/before.private.json`, JSON.stringify(baseline), { mode: 0o600 });
  assert.match(await send('a', 'PlaySmart'), /saved for processing/);
  const replies = await Promise.all([send('b', 'Spelling crashes when I press Start'), send('b', 'Spelling crashes when I press Start')]);
  assert.ok(replies.every(reply => reply.includes('saved for processing')));
  await send('c', 'ReadSmart reading crashes when I press Start', senderB);
  assert.equal((await control('', 'GET')).pending, 3);
  await api('/api/admin/cases/PS-000001', 'PATCH', { owner_notes: 'Synthetic paused-write check' }, 503);
  await control('resume', 'POST', {}, '', 409);
  const snapshot = await control('export', 'GET'); await validateSnapshot(snapshot);
  await writeFile(`${directory}/held.private.json`, JSON.stringify(snapshot), { mode: 0o600 });
  assert.equal((await api('/api/admin/cases')).total, before.total);
  const corrupt = structuredClone(snapshot); corrupt.sha256 = 'invalid';
  await control('restore', 'POST', corrupt, 'recovery', 409);
  await control('restore', 'POST', snapshot, 'recovery');
  await control('restore', 'POST', snapshot, 'recovery', 409);
  for (let i = 0; i < 3; i++) assert.equal((await control('replay', 'POST', {}, 'recovery')).replayed, 1);
  assert.equal((await control('replay', 'POST', {}, 'recovery')).replayed, 0);
  const restored = await api('/api/admin/maintenance/recovery/cases');
  assert.equal(restored.total, before.total + 2);
  assert.equal((await api('/api/admin/cases')).total, before.total, 'Recovery replay cannot mutate primary staging');
  assert.equal((await control('', 'GET')).pending, 3, 'Original captured backlog remains untouched by recovery');
  await control('resume', 'POST', {}, 'recovery');
  for (let i = 0; i < 3; i++) assert.equal((await control('replay')).replayed, 1);
  assert.equal((await control('replay')).replayed, 0);
  const after = await api('/api/admin/cases'); assert.equal(after.total, before.total + 2);
  const originalIDs = new Set(before.cases.map(item => item.case_id));
  const createdIDs = after.cases.filter(item => !originalIDs.has(item.case_id)).map(item => item.case_id).sort();
  assert.equal(createdIDs.length, 2);
  assert.deepEqual(restored.cases.map(item => item.case_id).sort(), after.cases.map(item => item.case_id).sort());
  const newCases = after.cases.filter(item => createdIDs.includes(item.case_id));
  assert.deepEqual(newCases.map(item => item.product).sort(), ['PLAYSMART', 'READSMART']);
  const finalSnapshot = await control('export', 'GET'); await validateSnapshot(finalSnapshot);
  await writeFile(`${directory}/after.private.json`, JSON.stringify(finalSnapshot), { mode: 0o600 });
  await control('resume'); primaryHeld = false;
  assert.match(await send('b', 'Spelling crashes when I press Start'), /(?:PS|RS|SA|GS)-\d+/);
  assert.equal((await api('/api/admin/cases')).total, before.total + 2);
  // Wait for real remote alarms, then leave the secondary coordinator held.
  let primaryOps; let recoveryOps;
  for (let attempt = 0; attempt < 15; attempt++) {
    primaryOps = await api('/api/admin/operations'); recoveryOps = await api('/api/admin/maintenance/recovery/operations');
    if (!(primaryOps.notifications.PENDING || primaryOps.notifications.SENDING || recoveryOps.notifications.PENDING || recoveryOps.notifications.SENDING)) break;
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  for (const operations of [primaryOps, recoveryOps]) {
    assert.equal(operations.notifications.ACCEPTED || 0, 0, 'No real provider acceptance');
    assert.equal(operations.notifications.PENDING || 0, 0, 'Alarm processed all pending synthetic jobs');
    assert.equal(operations.notifications.SENDING || 0, 0);
  }
  await control('hold', 'POST', {}, 'recovery');
  const report = { passed: true, staging: base, completedAt: new Date().toISOString(), baselineCases: before.total, finalCases: after.total, syntheticCaseIds: createdIDs, capturedMessages: 3, duplicateCaptureIgnored: true, replayAndRecoveryIsolation: 'passed', snapshotCorruptionRejected: true, primaryMode: (await control('', 'GET')).mode, recoveryMode: (await control('', 'GET', {}, 'recovery')).mode, providerAcceptedMessages: 0, notifications: primaryOps.notifications, productionChanged: false };
  await writeFile(`${directory}/report.json`, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 }); console.log(JSON.stringify({ ...report, artifacts: directory }, null, 2));
} catch (error) {
  console.error(`Rehearsal stopped: ${error.message}`);
  if (primaryHeld) console.error('Primary staging remains held; captured messages are retained. Inspect and finish replay before resuming. Production is unchanged.');
  process.exitCode = 1;
} finally { socket.close(); for (const call of calls.values()) clearTimeout(call.timeout); }
