// Actual workerd/SQLite with a mocked speech provider. No external requests.
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { build } from 'esbuild';
import assert from 'node:assert/strict';
const built = await build({ entryPoints: ['worker.js'], bundle: true, format: 'esm', write: false, platform: 'browser', target: 'es2022' });
let calls = 0;
const runtime = new Miniflare(convertV4MiniflareOptions({ modules: true, script: built.outputFiles[0].text, compatibilityDate: '2026-09-21', kvNamespaces: ['NOTES_KV'], durableObjects: { SUPPORT_COORDINATOR: { className: 'SupportCoordinator', useSQLite: true } }, bindings: {
  ENVIRONMENT: 'development', VALIDATE_TWILIO_SIGNATURE: 'false', COORDINATOR_BOOTSTRAP_APPROVED: 'true', APP_SUPPORT_ENABLED: 'true',
  APP_SUPPORT_VOICE_ENABLED: 'true', TINA_ELEVENLABS_API_KEY: 'synthetic', TINA_ELEVENLABS_VOICE_ID: 'syntheticVoice123',
}, outboundService: async request => {
  assert.equal(new URL(request.url).hostname, 'api.elevenlabs.io');
  assert.equal(request.headers.get('xi-api-key'), 'synthetic');
  const payload = await request.json();
  assert.equal(payload.model_id, 'eleven_v3'); assert.equal(payload.language_code, 'af');
  assert.match(payload.text, /Moenie jou wagwoord/);
  calls++;
  return new Response(new Uint8Array([73, 68, 51, 1]), { headers: { 'Content-Type': 'audio/mpeg' } });
} }));
const call = (path, body, token = 'ad'.repeat(32)) => runtime.dispatchFetch(`https://example.com/api/app-support/${path}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
try {
  assert.equal((await (await call('session', { platform: 'synthetic' })).json()).voice_available, true);
  const chat = await (await call('messages', { text: 'Hoe kan ek aanmeld? Help my asseblief.', action: 'chat', request_id: crypto.randomUUID() })).json();
  const answer = chat.messages.at(-1); assert.equal(answer.role, 'assistant');
  const response = await call('speech', { message_id: answer.id });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('X-Tina-Language'), 'af');
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [73, 68, 51, 1]);
  assert.equal((await call('speech', { message_id: answer.id })).status, 429);
  assert.equal((await call('speech', { message_id: answer.id }, 'ac'.repeat(32))).status, 404);
  assert.equal(calls, 1);
  console.log('Actual workerd/SQLite passed: Afrikaans fallback, private MP3, language/model, duplicate budget and guest isolation. Provider mocked.');
} finally { await runtime.dispose(); }
