import { boundedFetch, parseObject, sanitize } from './privacy.js';
export async function queueNotification(store, { id, to, body, caseId, requiresSession = false }) {
  if (!/^whatsapp:\+\d{8,15}$/.test(to || '')) return;
  const key = `outbox:${id}`;
  if (await store.get(key)) return;
  await store.put(key, JSON.stringify({ id, to, body: sanitize(body, 1500), case_id: caseId, requires_session: requiresSession, status: 'PENDING', attempts: 0, created_at: new Date().toISOString(), next_attempt: Date.now() }));
}
export async function deliverNotification(env, item, lastInbound) {
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_WHATSAPP_FROM) return { status: 'BLOCKED', reason: 'TWILIO_NOT_CONFIGURED' };
  const rawSender = String(env.TWILIO_WHATSAPP_FROM).trim();
  const sender = /^\+\d{8,15}$/.test(rawSender) ? `whatsapp:${rawSender}` : rawSender;
  const form = new URLSearchParams({ From: sender, To: item.to });
  if (lastInbound && Date.now() - lastInbound < 23 * 60 * 60 * 1000) form.set('Body', item.body);
  else if (item.requires_session) return { status: 'BLOCKED', reason: 'REPLAY_SERVICE_WINDOW_EXPIRED' };
  else if (env.TWILIO_UPDATE_CONTENT_SID) {
    form.set('ContentSid', env.TWILIO_UPDATE_CONTENT_SID);
    // Configure an approved generic template: "There is an update on support case {{1}}. Reply here for details."
    form.set('ContentVariables', JSON.stringify({ 1: item.case_id }));
  } else return { status: 'BLOCKED', reason: 'APPROVED_TEMPLATE_REQUIRED' };
  if (!/^whatsapp:\+\d{8,15}$/.test(sender)) return { status: 'BLOCKED', reason: 'TWILIO_SENDER_INVALID' };
  let response;
  try {
    response = await boundedFetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`, { method: 'POST', headers: { Authorization: `Basic ${btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`)}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: form });
  } catch { return { status: 'UNCERTAIN', reason: 'NETWORK_OUTCOME_UNKNOWN' }; }
  if (response.status === 429) return { status: 'PENDING', reason: 'RATE_LIMITED' };
  if (!response.ok) {
    // Provider prose may include phone numbers; retain only a numeric error code.
    const error = await response.json().catch(() => null);
    const code = Number.isSafeInteger(error?.code) ? error.code : null;
    return { status: response.status >= 500 ? 'UNCERTAIN' : 'BLOCKED', reason: code ? `TWILIO_ERROR_${code}` : `TWILIO_HTTP_${response.status}`, provider_status: response.status };
  }
  const result = parseObject(await response.text());
  return { status: 'ACCEPTED', provider_id: result?.sid || null, reason: null };
}
