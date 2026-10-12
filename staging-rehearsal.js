// Owner-triggered, synthetic-only remote drill. Production never exposes this.
import { validateSnapshot } from './recovery.js';
const resultKey = 'staging-rehearsal:latest';
const base = 'https://skoolio-support-staging.cowleyjared.workers.dev';
const requireCheck = (condition, message) => { if (!condition) throw new Error(message); };
export function rehearsalPage() {
  const nonce = crypto.randomUUID();
  return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Staging rehearsal</title><style nonce="${nonce}">body{font:17px system-ui;max-width:760px;margin:60px auto;padding:24px;background:#10182b;color:#eef2ff}button{font:inherit;padding:14px 22px;border:0;border-radius:10px;background:#86efac;color:#102519;cursor:pointer}button:disabled{opacity:.5}pre{white-space:pre-wrap;background:#1b2841;padding:20px;border-radius:10px}a{color:#9ccaff}</style><h1>Staging cutover rehearsal</h1><p>This checks saved messages, replay and recovery using synthetic cases in staging. Production stays unchanged. No WhatsApp messages will be sent.</p><p>The staging bot pauses briefly, then resumes after the checks pass. The separate recovery copy stays paused for inspection.</p><button id="run">Run staging rehearsal</button><pre id="status" role="status">Ready. Keep this page open while the checks run.</pre><p><a href="/admin">Back to staging dashboard</a></p><script nonce="${nonce}">
const button=document.getElementById('run'),status=document.getElementById('status');
async function finalize(){for(let i=0;i<30;i++){const r=await fetch('/api/admin/staging-rehearsal?finalize=true',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});const data=await r.json();status.textContent=JSON.stringify(data,null,2);if(r.status!==202)return;await new Promise(resolve=>setTimeout(resolve,2000));}}
button.addEventListener('click',async()=>{button.disabled=true;status.textContent='Running the staging rehearsal…';try{const r=await fetch('/api/admin/staging-rehearsal',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});const data=await r.json();status.textContent=JSON.stringify(data,null,2);if(data.status==='PASSED')await finalize();}catch{status.textContent='The connection interrupted. Refresh this page to check the stored result before trying again.';}});
fetch('/api/admin/staging-rehearsal').then(r=>r.json()).then(async data=>{if(data.status!=='NOT_STARTED'){status.textContent=JSON.stringify(data,null,2);button.disabled=true;if(data.status==='PASSED'&&data.alarmVerification==='PENDING')await finalize();}}).catch(()=>{});
</script></html>`, { headers: { 'Content-Type': 'text/html;charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'`, 'X-Content-Type-Options': 'nosniff' } });
}
export async function stagingRehearsal(request, env, dispatch) {
  if (env.ENVIRONMENT !== 'staging' || !env.SUPPORT_RECOVERY || !env.RECOVERY_KV || env.OPENAI_API_KEY || env.TWILIO_ACCOUNT_SID || env.TWILIO_WHATSAPP_FROM || env.OWNER_WHATSAPP_NUMBER) return Response.json({ error: 'Not found' }, { status: 404 });
  const lock = env.SUPPORT_RECOVERY.get(env.SUPPORT_RECOVERY.idFromName('staging-rehearsal-lock-v1'));
  const getReport = () => lock.fetch(new Request('https://coordinator.invalid/_staging/rehearsal-report')).then(response => response.json());
  const saveReport = async report => {
    const saved = await lock.fetch(new Request('https://coordinator.invalid/_staging/rehearsal-report', { method: 'PUT', body: JSON.stringify(report) }));
    requireCheck(saved.ok, 'Rehearsal report saved');
    if (report.status !== 'RUNNING') await env.NOTES_KV.put(resultKey, JSON.stringify(report));
  };
  if (request.method === 'GET') return Response.json(await getReport(), { headers: { 'Cache-Control': 'no-store' } });
  if (request.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405 });
  if (new URL(request.url).searchParams.get('finalize') === 'true') {
    const report = await getReport();
    if (report.status !== 'PASSED') return Response.json({ error: 'Successful replay checks required' }, { status: 409 });
    const headers = { 'CF-Access-JWT-Assertion': request.headers.get('CF-Access-JWT-Assertion'), 'Content-Type': 'application/json' };
    const operations = [];
    for (const path of ['/api/admin/operations', '/api/admin/maintenance/recovery/operations']) {
      const response = await dispatch(new Request(base + path, { headers }), env);
      if (!response.ok) return Response.json({ error: 'Unable to verify alarm outcome' }, { status: 502 });
      operations.push(await response.json());
    }
    if (operations.some(item => item.notifications.PENDING || item.notifications.SENDING)) return Response.json({ status: 'WAITING_FOR_ALARMS', message: 'Replay passed. Waiting for notification checks…' }, { status: 202 });
    if (operations.some(item => item.notifications.ACCEPTED || item.notifications.UNCERTAIN)) return Response.json({ error: 'Unexpected provider outcome; inspect staging before proceeding' }, { status: 409 });
    const held = await dispatch(new Request(base + '/api/admin/maintenance/recovery/hold', { method: 'POST', headers, body: '{}' }), env);
    if (!held.ok) return Response.json({ error: 'Unable to hold recovered copy' }, { status: 502 });
    const final = { ...report, alarmVerification: 'PASSED', recoveryMode: 'hold', providerAcceptedMessages: 0, notifications: operations[0].notifications };
    await saveReport(final);
    return Response.json(final, { headers: { 'Cache-Control': 'no-store' } });
  }
  const claimed = await lock.fetch(new Request('https://coordinator.invalid/_staging/claim-rehearsal', { method: 'POST' }));
  if (!claimed.ok) return Response.json({ status: 'ALREADY_STARTED', message: 'Inspect the stored result; do not start a second concurrent rehearsal.' }, { status: 409 });
  const run = crypto.randomUUID().replaceAll('-', '').slice(0, 12);
  const headers = { 'CF-Access-JWT-Assertion': request.headers.get('CF-Access-JWT-Assertion'), 'Content-Type': 'application/json' };
  const api = async (path, method = 'GET', body, expected = 200) => {
    const response = await dispatch(new Request(base + path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), env);
    requireCheck(response.status === expected, `${method} ${path}: expected ${expected}, received ${response.status}`);
    return response.json();
  };
  const control = (action = '', method = 'POST', body = {}, recovery = false, expected = 200) => api(`/api/admin/maintenance${recovery ? '/recovery' : ''}${action ? '/' + action : ''}`, method, method === 'POST' ? body : undefined, expected);
  const send = async (suffix, body, other = false) => {
    const form = new URLSearchParams({ From: `whatsapp:+155${other ? '6' : '5'}${parseInt(run.slice(0,7),16).toString().padStart(8,'0')}`, MessageSid: `SMrehearsal${run}${suffix}`, Body: body });
    const url = base + '/webhook/whatsapp'; const text = url + [...form.keys()].sort().map(key => key + form.get(key)).join('');
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.TWILIO_AUTH_TOKEN), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
    const signature = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text)))));
    const response = await dispatch(new Request(url, { method: 'POST', headers: { 'X-Twilio-Signature': signature }, body: form }), env);
    requireCheck(response.status === 200, 'Signed synthetic message accepted'); return response.text();
  };
  const save = async (name, snapshot) => { await validateSnapshot(snapshot); await env.NOTES_KV.put(`staging-rehearsal:${run}:${name}`, JSON.stringify(snapshot)); };
  let held = false;
  let report = { status: 'RUNNING', run, startedAt: new Date().toISOString(), productionChanged: false };
  await saveReport(report);
  try {
    const initial = await control('', 'GET'); requireCheck(initial.mode === 'live' && initial.pending === 0 && initial.initialized, 'Primary staging must be live without backlog');
    const recovery = await control('', 'GET', {}, true); requireCheck(recovery.mode === 'hold' && recovery.pending === 0 && !recovery.initialized, 'Recovery target must be empty');
    const before = await api('/api/admin/cases');
    await control('hold'); held = true; await save('before', await control('export', 'GET'));
    requireCheck((await send('a', 'PlaySmart')).includes('saved for processing'), 'Hold acknowledges durable capture');
    await send('b', 'Spelling crashes when I press Start'); await send('b', 'Spelling crashes when I press Start');
    await send('c', 'ReadSmart reading crashes when I press Start', true);
    requireCheck((await control('', 'GET')).pending === 3, 'Duplicate capture ignored');
    await api('/api/admin/cases/PS-000001', 'PATCH', { owner_notes: 'Synthetic held-write check' }, 503);
    await control('resume', 'POST', {}, false, 409);
    const snapshot = await control('export', 'GET'); await save('held', snapshot);
    await control('restore', 'POST', { ...snapshot, sha256: 'invalid' }, true, 409);
    await control('restore', 'POST', snapshot, true);
    await control('restore', 'POST', snapshot, true, 409);
    for (let i=0;i<3;i++) requireCheck((await control('replay', 'POST', {}, true)).replayed === 1, 'Recovery replay processed one message');
    requireCheck((await control('replay', 'POST', {}, true)).replayed === 0, 'Recovery replay is idempotent');
    const restored = await api('/api/admin/maintenance/recovery/cases');
    requireCheck(restored.total === before.total + 2, 'Recovery preserves baseline and adds two cases');
    requireCheck((await api('/api/admin/cases')).total === before.total && (await control('', 'GET')).pending === 3, 'Recovery is isolated from primary');
    await control('resume', 'POST', {}, true);
    for (let i=0;i<3;i++) requireCheck((await control('replay')).replayed === 1, 'Primary replay processed one message');
    requireCheck((await control('replay')).replayed === 0, 'Primary replay is idempotent');
    const after = await api('/api/admin/cases'); requireCheck(after.total === before.total + 2, 'Primary gains exactly two cases');
    const ids = new Set(before.cases.map(item=>item.case_id)); const created = after.cases.filter(item=>!ids.has(item.case_id));
    requireCheck(JSON.stringify(created.map(item=>item.product).sort()) === '["PLAYSMART","READSMART"]', 'Conversation order preserves correct products');
    requireCheck(JSON.stringify(restored.cases.map(item=>item.case_id).sort()) === JSON.stringify(after.cases.map(item=>item.case_id).sort()), 'Primary and recovery preserve identical IDs');
    await save('after', await control('export','GET'));
    await control('resume'); held = false;
    requireCheck(/(?:PS|RS|SA|GS)-\d+/.test(await send('b', 'Spelling crashes when I press Start')), 'Committed replay response survives resume');
    requireCheck((await api('/api/admin/cases')).total === after.total, 'Post-resume duplicate cannot allocate another case');
    // Recovery remains live briefly for its alarm/mirror verification; the
    // separate finalization endpoint holds it after queues have drained.
    report = { ...report, status:'PASSED', passed:true, completedAt:new Date().toISOString(), baselineCases:before.total, finalCases:after.total, syntheticCaseIds:created.map(item=>item.case_id).sort(), capturedMessages:3, duplicateCaptureIgnored:true, replayAndRecoveryIsolation:'passed', snapshotCorruptionRejected:true, primaryMode:'live', recoveryMode:'live', providerCredentials:false, alarmVerification:'PENDING' };
  } catch (error) { report = { ...report, status:'FAILED', primaryHeld:held, error:error.message, completedAt:new Date().toISOString() }; }
  await saveReport(report);
  return Response.json(report, { status:report.status === 'PASSED' ? 200 : 500, headers:{'Cache-Control':'no-store'} });
}
