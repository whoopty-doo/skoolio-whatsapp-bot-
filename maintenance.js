// Called only behind the Worker's Access/signature checks and coordinator mutex.
import { digest, sanitize } from './privacy.js';
import { StagedStore, bootstrap } from './persistence.js';
import { queueNotification } from './notifications.js';
import { restoreSnapshot, readSnapshot } from './recovery.js';
import { incomingMedia } from './media.js';
const ACK = '<?xml version="1.0" encoding="UTF-8"?><Response><Message>Support is briefly updating. Your message has been saved for processing. Please avoid resending it.</Message></Response>';
const reply = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
export async function maintenanceMode(storage, env) {
  let mode = await storage.get('maintenance:mode');
  if (!mode) { mode = env.CUTOVER_MODE === 'hold' ? 'hold' : 'live'; await storage.put('maintenance:mode', mode); }
  return mode;
}
export async function captureInbound(request, storage, env) {
  const form = new URLSearchParams(await request.text());
  const from = form.get('From') || ''; const sid = form.get('MessageSid') || '';
  if (!/^whatsapp:\+\d{8,15}$/.test(from) || !/^[A-Za-z0-9_-]{8,100}$/.test(sid)) return reply({ error: 'Valid sender and MessageSid required' }, 400);
  const key = `held:${await digest(from)}:${sid}`;
  let media;
  try { media = incomingMedia(form, env); } catch { return reply({ error: 'Unsupported attachment' }, 400); }
  if (!await storage.get(key)) {
    await storage.transaction(async tx => {
      const sequence = (await tx.get('maintenance:sequence') || 0) + 1;
      await tx.put('maintenance:sequence', sequence);
      // No raw request headers, signatures, media URLs, or credentials retained.
      await tx.put(key, { from, sid, body: sanitize(form.get('Body') || '', 4000), media, receivedAt: Date.now(), sequence, status: 'PENDING' });
    });
  }
  return new Response(ACK, { headers: { 'Content-Type': 'text/xml', 'Cache-Control': 'no-store' } });
}
export async function maintenanceRequest(request, ctx, env, routeBusiness) {
  const storage = ctx.storage; const path = new URL(request.url).pathname;
  const mode = await maintenanceMode(storage, env);
  const entries = await storage.list({ prefix: 'held:' });
  const pending = [...entries].filter(([, item]) => item.status === 'PENDING').sort((a, b) => a[1].sequence - b[1].sequence);
  if (path === '/api/admin/maintenance' && request.method === 'GET') return reply({ mode, pending: pending.length, initialized: Boolean(await storage.get('initialized')) });
  if (path === '/api/admin/maintenance/hold' && request.method === 'POST') {
    await storage.put('maintenance:mode', 'hold');
    return reply({ mode: 'hold', pending: pending.length });
  }
  if (mode !== 'hold') return reply({ error: 'Put the coordinator on hold first' }, 409);
  if (path === '/api/admin/maintenance/prepare-production' && request.method === 'POST') {
    if (env.ENVIRONMENT !== 'production' || !/^[a-f0-9]{64}$/.test(env.MIGRATION_EXPECTED_SHA256 || '') || env.COORDINATOR_BOOTSTRAP_APPROVED !== 'true') return reply({ error: 'Production import is not enabled' }, 409);
    if (await storage.get('production:verified')) return reply(await storage.get('production:verified'));
    await bootstrap(storage, env.NOTES_KV, true);
    const records = [...await storage.list({ prefix: 'record:' })]
      .map(([key, item]) => [key.slice(7), item.value])
      .filter(([key]) => key.startsWith('support-case:') || key.startsWith('conversation:mapping:'))
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    if (await digest(JSON.stringify(records)) !== env.MIGRATION_EXPECTED_SHA256) return reply({ error: 'Import differs from the production backup; activation stopped' }, 409);
    const payload = { format: 'skoolio-coordinator-v1', createdAt: new Date().toISOString(), entries: [...await storage.list()] };
    await env.NOTES_KV.put('production-activation:checkpoint', JSON.stringify({ payload, sha256: await digest(JSON.stringify(payload)) }));
    const report = { verified: true, cases: records.filter(([key]) => /^support-case:(?:PS|RS|SA|GS)-/.test(key)).length, nextCaseNumber: Number(records.find(([key]) => key === 'support-case:sequence')?.[1]) + 1, verifiedAt: new Date().toISOString() };
    await storage.put('production:verified', report);
    await env.NOTES_KV.put('production-activation:latest', JSON.stringify({ ...report, mode: 'hold' }));
    return reply(report);
  }
  if (path === '/api/admin/maintenance/restore' && request.method === 'POST') {
    try { return reply(await restoreSnapshot(storage, await readSnapshot(request))); }
    catch { return reply({ error: 'Restore rejected: use a verified snapshot and an empty, isolated coordinator' }, 409); }
  }
  if (path === '/api/admin/maintenance/bootstrap' && request.method === 'POST') {
    await bootstrap(storage, env.NOTES_KV, env.COORDINATOR_BOOTSTRAP_APPROVED === 'true');
    return reply({ initialized: true });
  }
  if (path === '/api/admin/maintenance/replay' && request.method === 'POST') {
    if (!await storage.get('initialized')) return reply({ error: 'Bootstrap and verify the import first' }, 409);
    // One message per call keeps failures resumable without a long HTTP batch.
    const next = pending[0]; if (!next) return reply({ replayed: 0, pending: 0 });
    const [key, item] = next; const store = new StagedStore(storage);
    const senderKey = await digest(item.from);
    const inboundKey = `inbound:${senderKey}:${item.sid}`;
    const prior = await store.get(inboundKey);
    const form = new URLSearchParams({ From: item.from, MessageSid: item.sid, Body: item.body, NumMedia: String(item.media?.length || 0) });
    for (const [i, media] of (item.media || []).entries()) { form.set(`MediaUrl${i}`, media.url); form.set(`MediaContentType${i}`, media.type); }
    const response = await routeBusiness(new Request('https://coordinator.invalid/webhook/whatsapp', { method: 'POST', body: form }), { ...env, NOTES_KV: store, CONVERSATIONS_KV: store });
    if (!response.ok) return reply({ error: 'Replay failed; message remains pending' }, 502);
    const xml = await response.text();
    const body = await store.get(inboundKey) || xml.match(/<Message>([\s\S]*?)<\/Message>/)?.[1]?.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
    // Use actual receipt time, never the replay time, for the service window.
    const lastInbound = Math.max(Number(await storage.get(`record:last-inbound:${senderKey}`).then(value => value?.value)) || 0, item.receivedAt);
    await store.put(`last-inbound:${senderKey}`, String(lastInbound), { expirationTtl: 86400 });
    if (!prior && body) await queueNotification(store, { id: `cutover:${senderKey}:${item.sid}`, to: item.from, body, caseId: body.match(/(?:PS|RS|SA|GS)-\d{6,12}/)?.[0] || null, requiresSession: true });
    // Domain changes, notification and replay checkpoint share one transaction.
    await store.commit(async tx => { await tx.put(key, { status: 'PROCESSED', sequence: item.sequence, processedAt: Date.now() }); });
    return reply({ replayed: 1, pending: pending.length - 1 });
  }
  if (path === '/api/admin/maintenance/resume' && request.method === 'POST') {
    if (env.ENVIRONMENT === 'production' && env.MIGRATION_EXPECTED_SHA256 && !await storage.get('production:verified')) return reply({ error: 'Verify the production import first' }, 409);
    if (!await storage.get('initialized') || pending.length) return reply({ error: 'Import must be verified and held messages replayed before resuming', pending: pending.length }, 409);
    await storage.transaction(async tx => { await tx.put('maintenance:mode', 'live'); await tx.setAlarm(Date.now() + 1000); });
    if (await storage.get('production:verified')) await env.NOTES_KV.put('production-activation:latest', JSON.stringify({ ...await storage.get('production:verified'), mode: 'live', activatedAt: new Date().toISOString() }));
    return reply({ mode: 'live' });
  }
  if (path === '/api/admin/maintenance/export' && request.method === 'GET') {
    // The immutable response is a checkpoint. New arrivals can still be captured
    // afterward; the report explicitly identifies the capture high-water mark.
    const all = await storage.list({ limit: 10001 });
    if (all.size > 10000) return reply({ error: 'Snapshot requires a paginated export; limit exceeded' }, 413);
    const payload = { format: 'skoolio-coordinator-v1', createdAt: new Date().toISOString(), entries: [...all] };
    const serialized = JSON.stringify(payload);
    if (new TextEncoder().encode(serialized).length > 4 * 1024 * 1024) return reply({ error: 'Snapshot exceeds supported recovery size' }, 413);
    return reply({ payload, sha256: await digest(serialized) });
  }
  return reply({ error: 'Not found' }, 404);
}
