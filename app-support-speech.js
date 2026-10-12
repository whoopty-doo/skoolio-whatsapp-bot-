import { sanitize, digest } from './privacy.js';
import { answerLanguage } from './support-language.js';
export { answerLanguage } from './support-language.js';

const fail = (message, status) => { throw Object.assign(new Error(message), { status }); };
export function speechConfigured(env) {
  return env.APP_SUPPORT_VOICE_ENABLED === 'true' &&
    Boolean(env.TINA_ELEVENLABS_API_KEY && /^[a-zA-Z0-9_-]{8,100}$/.test(env.TINA_ELEVENLABS_VOICE_ID || ''));
}

// Runs in the existing coordinator transaction. Reserve spend BEFORE the provider
// call; even an ambiguous timeout or client retry must count toward the budget.
export async function reserveSpeech(store, thread, payload, env) {
  if (!speechConfigured(env)) fail('Klik cloud voice is not connected yet. Use device voice.', 503);
  if (Object.keys(payload).some(name => !['message_id', 'language'].includes(name))) fail('Select a saved answer to read.', 400);
  if (typeof payload.message_id !== 'string' || !['auto', 'en', 'af'].includes(payload.language || 'auto')) fail('Invalid speech request.', 400);
  const message = thread.messages.find(item => item.id === payload.message_id);
  if (!message || !['assistant', 'human'].includes(message.role)) fail('Answer not found in this conversation.', 404);
  const text = sanitize(message.text, 4000)
    .replace(/https?:\/\/\S+/g, '').replace(/\[[^\]\n]{1,100}\]/g, '')
    .replace(/[*#`_]/g, '').trim();
  if (!text) fail('This answer has no readable text.', 400);
  const language = payload.language && payload.language !== 'auto' ? payload.language : answerLanguage(text);
  const retryKey = `app-support:speech:recent:${thread.id}:${await digest(message.id + ':' + language)}`;
  if (await store.get(retryKey)) fail('Please wait before generating this answer again.', 429);
  const day = Math.floor(Date.now() / 86400000);
  const globalKey = `app-support:speech:characters:${day}`;
  const threadKey = `app-support:speech:characters:${thread.id}:${day}`;
  const configured = Number(env.APP_SUPPORT_VOICE_DAILY_CHAR_LIMIT || 12000);
  const limit = Number.isSafeInteger(configured) && configured > 0 ? Math.min(configured, 100000) : 12000;
  const globalCount = Number(await store.get(globalKey) || 0);
  const threadCount = Number(await store.get(threadKey) || 0);
  if (globalCount + text.length > limit || threadCount + text.length > 8000) fail('Today’s voice limit has been reached. You can still read the answer.', 429);
  await store.put(globalKey, String(globalCount + text.length), { expirationTtl: 172800 });
  await store.put(threadKey, String(threadCount + text.length), { expirationTtl: 172800 });
  await store.put(retryKey, 'reserved', { expirationTtl: 60 });
  // This response is consumed by the outer Worker, never returned to the guest.
  return Response.json({ text, language }, { headers: { 'Cache-Control': 'no-store' } });
}

// Runs OUTSIDE the coordinator mutex, keeping chat, admin and WhatsApp responsive.
export async function renderSupportSpeech(reservation, env) {
  if (!reservation.ok) return reservation;
  const { text, language } = await reservation.json();
  const voice = env.TINA_ELEVENLABS_VOICE_ID;
  if (!speechConfigured(env) || !/^[a-zA-Z0-9_-]{8,100}$/.test(voice || '')) fail('Klik cloud voice is not configured.', 503);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  try {
    const result = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`, {
      method: 'POST', redirect: 'manual', signal: controller.signal,
      headers: { 'xi-api-key': env.TINA_ELEVENLABS_API_KEY, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify({ text, language_code: language, model_id: 'eleven_v3', voice_settings: { stability: 0.5, similarity_boost: 0.75 } }),
    });
    if (!result.ok || !result.headers.get('Content-Type')?.startsWith('audio/mpeg')) {
      await result.body?.cancel();
      fail('Klik voice could not generate this answer. Please try later or use device voice.', 502);
    }
    const reader = result.body.getReader();
    const chunks = []; let length = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > 4 * 1024 * 1024) { await reader.cancel(); fail('This voice answer is too large.', 502); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    if (!length) fail('Klik voice returned an empty answer.', 502);
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return new Response(bytes, { headers: {
      'Content-Type': 'audio/mpeg', 'Content-Length': String(length),
      'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
      'X-Tina-Voice': 'elevenlabs', 'X-Tina-Language': language,
    } });
  } catch (error) {
    if (error.status) throw error;
    fail('Klik voice could not connect. Please try later or use device voice.', 502);
  } finally { clearTimeout(timeout); }
}
