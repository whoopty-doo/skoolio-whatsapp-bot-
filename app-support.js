import { sanitize, digest, parseObject } from './privacy.js';
import { CaseRepository } from './support-cases.js';
import { reportedIssue } from './triage.js';
import { reserveSpeech, speechConfigured } from './app-support-speech.js';

const TTL = 30 * 86400;
const ID = /^[a-f0-9]{64}$/;
const REQUEST_ID = /^[a-zA-Z0-9_-]{16,80}$/;
const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
const fail = (message, status) => { throw Object.assign(new Error(message), { status }); };
const key = id => `app-support:thread:${id}`;

async function rate(store, scope, limit, seconds) {
  const bucket = Math.floor(Date.now() / (seconds * 1000));
  const name = `app-support:rate:${scope}:${bucket}`;
  const count = Number(await store.get(name) || 0);
  if (count >= limit) fail('Support is busy. Please wait before trying again.', 429);
  await store.put(name, String(count + 1), { expirationTtl: seconds * 2 });
}
async function save(store, thread) {
  const seconds = Math.ceil((Date.parse(thread.expires_at) - Date.now()) / 1000);
  if (seconds <= 0) fail('This conversation has expired. Start a new chat.', 410);
  await store.put(key(thread.id), JSON.stringify(thread), { expirationTtl: seconds });
}
function append(thread, role, text) {
  thread.messages.push({ id: crypto.randomUUID(), role, text: sanitize(text, 4000), at: new Date().toISOString() });
  thread.updated_at = thread.messages.at(-1).at;
}
async function view(store, thread, env) {
  const item = thread.case_id ? await new CaseRepository(store).get(thread.case_id) : null;
  // Explicit public projection. Never return notes, approvals, identity or credentials.
  const presence = await store.list({ prefix: 'app-support:presence:', limit: 1 });
  return { voice_available: speechConfigured(env), human_available: presence.keys.length > 0, id: thread.id, mode: thread.mode, messages: thread.messages, expires_at: thread.expires_at, updated_at: thread.updated_at, case: item ? { case_id: item.case_id, status: item.status } : null };
}
async function recordCase(store, thread, text, human) {
  if (thread.case_id) return thread.case_id;
  const item = await new CaseRepository(store).create({
    product: 'PLAYSMART', category: human ? 'HUMAN_ASSISTANCE' : 'SUSPECTED_BUG',
    user_description: text, ai_summary: sanitize(text, 220), actual_behaviour: text,
    conversation_reference: { channel: 'app', conversationId: thread.id, messageCount: thread.messages.length },
    platform: thread.platform, app_version: thread.app_version,
  });
  thread.case_id = item.case_id;
  return item.case_id;
}

// Called only inside SupportCoordinator's serialized, transactional store.
export async function appSupport(request, env, { readJSON, answer }) {
  if (env.APP_SUPPORT_ENABLED !== 'true') return response({ error: 'In-app support is not available yet.' }, 503);
  const store = env.NOTES_KV;
  if (!store?.atomicWrites) return response({ error: 'Support persistence is not ready.' }, 503);
  const url = new URL(request.url);
  const admin = url.pathname.startsWith('/api/admin/app-support');
  if (request.method !== 'GET') {
    if (request.headers.get('Origin') && request.headers.get('Origin') !== url.origin) fail('Invalid origin', 403);
    if (!request.headers.get('Content-Type')?.startsWith('application/json')) fail('JSON body required', 415);
  }
  if (admin) {
    // The outer Worker verifies Cloudflare Access on every /api/admin/ request.
    if (url.pathname === '/api/admin/app-support/presence' && request.method === 'POST') {
      const payload = await readJSON(request);
      if (typeof payload.available !== 'boolean') fail('Availability must be true or false.', 400);
      // Assertion has already been signature/issuer/audience/allowlist checked.
      const encoded = request.headers.get('CF-Access-JWT-Assertion').split('.')[1].replaceAll('-', '+').replaceAll('_', '/');
      const identity = JSON.parse(atob(encoded)).email.toLowerCase();
      const presenceKey = `app-support:presence:${await digest(identity)}`;
      if (payload.available) await store.put(presenceKey, 'available', { expirationTtl: 90 });
      else await store.delete(presenceKey);
      return response({ available: payload.available, expires_in: payload.available ? 90 : 0 });
    }
    if (url.pathname === '/api/admin/app-support' && request.method === 'GET') {
      const cursor = url.searchParams.get('cursor');
      if (cursor && !ID.test(cursor)) fail('Invalid cursor', 400);
      const page = await store.list({ prefix: 'app-support:thread:', cursor: cursor ? key(cursor) : undefined, limit: 50 });
      const threads = [];
      for (const { name } of page.keys) {
        const thread = parseObject(await store.get(name));
        if (thread) threads.push({ id: thread.id, mode: thread.mode, case_id: thread.case_id, updated_at: thread.updated_at, preview: thread.messages.at(-1)?.text || '' });
      }
      return response({ threads, cursor: page.list_complete ? null : page.keys.at(-1).name.slice('app-support:thread:'.length) });
    }
    const match = url.pathname.match(/^\/api\/admin\/app-support\/([a-f0-9]{64})(\/messages)?$/);
    if (!match) return response({ error: 'Not found' }, 404);
    const thread = parseObject(await store.get(key(match[1])));
    if (!thread) return response({ error: 'Conversation not found or expired.' }, 404);
    if (request.method === 'GET' && !match[2]) return response(await view(store, thread, env));
    if (request.method !== 'POST' || !match[2]) return response({ error: 'Method not allowed' }, 405);
    const payload = await readJSON(request);
    const text = validMessage(payload.text);
    const fingerprint = await digest(`human:${text}`);
    if (duplicate(thread, payload.request_id, fingerprint)) return response(await view(store, thread, env));
    capacity(thread);
    append(thread, 'human', text);
    thread.mode = 'HUMAN';
    thread.receipts[payload.request_id] = fingerprint;
    // Preserve an audit actor without exposing an admin email to the customer.
    thread.last_admin = await digest(request.headers.get('CF-Access-JWT-Assertion') || '');
    await save(store, thread);
    return response(await view(store, thread, env));
  }
  if (!['/api/app-support/session', '/api/app-support/messages', '/api/app-support/speech'].includes(url.pathname)) return response({ error: 'Not found' }, 404);
  const token = request.headers.get('Authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
  if (!token) return response({ error: 'A private support session is required.' }, 401);
  const id = await digest(`playsmart-app-support:${token}`);
  let thread = parseObject(await store.get(key(id)));
  if (url.pathname === '/api/app-support/session' && request.method === 'POST') {
    if (!thread) {
      // CF-Connecting-IP is supplied by Cloudflare, never by app metadata.
      const ip = request.headers.get('CF-Connecting-IP');
      if (!ip && !['test', 'development'].includes(env.ENVIRONMENT)) fail('Support connection could not be verified.', 503);
      await rate(store, `start:${await digest(ip || 'local')}`, 10, 3600);
      await rate(store, 'starts-global', 500, 86400);
      const payload = await readJSON(request);
      thread = { id, mode: 'AI', case_id: null, platform: sanitize(payload.platform, 40), app_version: sanitize(payload.app_version, 40), messages: [], receipts: {}, expires_at: new Date(Date.now() + TTL * 1000).toISOString() };
      append(thread, 'system', 'Hi! I’m Klik, Tina’s friendly robot companion and your PlaySmart AI helper. Ask for a guide, report a problem, or choose Speak to a human. Please do not share passwords, licence codes or private student or parent information.');
      await save(store, thread);
    }
    return response(await view(store, thread, env));
  }
  if (!thread) return response({ error: 'Conversation not found or expired. Start a new chat.' }, 404);
  if (url.pathname === '/api/app-support/speech') {
    if (request.method !== 'POST') return response({ error: 'Method not allowed' }, 405);
    return reserveSpeech(store, thread, await readJSON(request), env);
  }
  if (url.pathname === '/api/app-support/session' && request.method === 'GET') {
    await rate(store, `read:${id}`, 120, 60);
    return response(await view(store, thread, env));
  }
  if (url.pathname !== '/api/app-support/messages' || request.method !== 'POST') return response({ error: 'Method not allowed' }, 405);
  const payload = await readJSON(request);
  const text = validMessage(payload.text);
  const action = payload.action || 'chat';
  if (!['chat', 'report', 'human', 'ai'].includes(action)) fail('Invalid action', 400);
  const fingerprint = await digest(`${action}:${text}`);
  if (duplicate(thread, payload.request_id, fingerprint)) return response(await view(store, thread, env));
  capacity(thread);
  await rate(store, `send:${id}`, 15, 60);
  await rate(store, 'messages-global', 2000, 86400);
  append(thread, 'user', text);
  const human = action === 'human' || /\b(speak to (?:a )?human|talk to (?:a )?person|human support)\b/i.test(text);
  if (human) {
    thread.mode = 'WAITING';
    const caseId = await recordCase(store, thread, text, true);
    append(thread, 'system', `Your request is in the human support inbox (${caseId}). A person can reply here. Replies may not be immediate; return to this chat to check.`);
  } else if (action === 'report' || (action === 'chat' && thread.mode === 'AI' && await reportedIssue(env, text, { product: 'PLAYSMART' }))) {
    const caseId = await recordCase(store, thread, text, false);
    append(thread, 'system', `Report recorded as ${caseId} for investigation; a software defect is not yet confirmed. What did you expect, and what happened instead? Do not include private learner details.`);
  } else if (action === 'ai' || thread.mode === 'AI') {
    thread.mode = 'AI';
    const result = await answer(text, thread.messages.filter(item => ['user', 'assistant'].includes(item.role)).slice(-8).map(item => ({ role: item.role, content: item.text })));
    append(thread, 'assistant', result);
  }
  // While waiting/on human support, user messages append without an AI reply.
  thread.receipts[payload.request_id] = fingerprint;
  await save(store, thread);
  return response(await view(store, thread, env));
}
function validMessage(text) {
  if (typeof text !== 'string' || !text.trim() || text.length > 4000) fail('Enter a message of 1–4000 characters.', 400);
  return sanitize(text, 4000);
}
function duplicate(thread, id, fingerprint) {
  if (!REQUEST_ID.test(id || '')) fail('A valid request ID is required.', 400);
  if (!Object.hasOwn(thread.receipts, id)) return false;
  if (thread.receipts[id] !== fingerprint) fail('Request ID already used for another message.', 409);
  return true;
}
function capacity(thread) {
  if (thread.messages.length >= 198) fail('This conversation is full. Start a new chat and keep your case reference.', 409);
}
