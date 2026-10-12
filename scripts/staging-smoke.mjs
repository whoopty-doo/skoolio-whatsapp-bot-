import { readFileSync } from 'node:fs';
import { createHmac, randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
const base = 'https://skoolio-support-staging.cowleyjared.workers.dev';
const secrets = JSON.parse(readFileSync('.dev.vars.staging.json', 'utf8'));
const run = randomBytes(6).toString('hex');
let number = 0;
async function send(body, from = 'whatsapp:+15550001001', sid = `SMstage${run}${++number}`) {
  const params = new URLSearchParams({ From: from, MessageSid: sid, Body: body });
  const payload = base + '/webhook/whatsapp' + [...params.keys()].sort().map(key => key + params.get(key)).join('');
  const signature = createHmac('sha1', secrets.TWILIO_AUTH_TOKEN).update(payload).digest('base64');
  const response = await fetch(base + '/webhook/whatsapp', { method: 'POST', headers: { 'X-Twilio-Signature': signature }, body: params, signal: AbortSignal.timeout(30000) });
  assert.equal(response.status, 200, 'Signed staging webhook responds successfully');
  return response.text();
}
const config = JSON.parse(readFileSync('wrangler.staging.json', 'utf8'));
const accessReady = Boolean(config.vars.ADMIN_ACCESS_AUDIENCE);
const health = await (await fetch(base + '/health')).json();
assert.equal(health.writesConfigured, true); assert.equal(health.aiConfigured, false);
for (const path of ['/admin', '/api/admin/cases']) {
  const response = await fetch(base + path, { redirect: 'manual' });
  assert.ok([401, 302].includes(response.status), 'Anonymous admin requests are denied');
  if (accessReady) assert.equal(response.status, 302, 'Configured Access challenges anonymous requests');
  if (response.status === 302) assert.equal(new URL(response.headers.get('location')).hostname, 'falling-band-2215.cloudflareaccess.com');
}
const invalid = await fetch(base + '/webhook/whatsapp', { method: 'POST', body: new URLSearchParams({ From: 'whatsapp:+15550001001', MessageSid: `SMbad${run}`, Body: 'ReadSmart crash' }) }); assert.equal(invalid.status, 403);
await send('start over');
assert.match(await send('My spelling lesson crashes when I press Start'), /PlaySmart, ReadSmart/);
const sid = `SMdedup${run}`;
const first = await send('ReadSmart', undefined, sid); const id = first.match(/(?:PS|RS|SA|GS)-\d+/)?.[0]; assert.ok(id);
assert.equal(await send('ReadSmart', undefined, sid), first);
assert.match(await send('It still crashes on Windows 11'), new RegExp(id));
const update = await fetch(base + '/internal/support-cases/' + id, { method: 'POST', headers: { Authorization: `Bearer ${secrets.CASE_STATUS_UPDATE_SECRET}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: 2, status: 'NEEDS_INFORMATION', question: 'Which app version are you testing?' }) }); assert.equal(update.status, 200);
assert.match(await send('Version 1.2.1'), new RegExp(id));
assert.match(await send('What is the status of my case?'), /investigating/);
const forbidden = await fetch(base + '/internal/support-cases/' + id, { method: 'POST', headers: { Authorization: `Bearer ${secrets.CASE_STATUS_UPDATE_SECRET}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: 4, status: 'APPROVED' }) }); assert.equal(forbidden.status, 400);
const replies = await Promise.all(Array.from({ length: 4 }, async (_, i) => {
  const sender = `whatsapp:+1555000110${i}`; await send('start over', sender); return send('Skoolio Admin dashboard crashes when I open students', sender);
}));
const ids = replies.map(reply => reply.match(/(?:PS|RS|SA|GS)-\d+/)?.[0]); assert.equal(new Set(ids).size, 4); assert.ok(ids.every(Boolean));
console.log(JSON.stringify({ staging: base, passed: ['health', 'anonymous admin access denied', 'signature rejection', 'product clarification', 'case creation', 'duplicate replay', 'follow-up association', 'technical question and reply', 'status retrieval', 'approval rejection', 'concurrent unique IDs'], testCases: [id, ...ids], adminLoginConfigured: accessReady, realProviderCredentials: false }, null, 2));
