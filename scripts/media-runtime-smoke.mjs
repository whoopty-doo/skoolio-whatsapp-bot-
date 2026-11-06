// Bundled workerd, real alarms and provider-shaped fixtures. No external calls.
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { build } from 'esbuild';
import assert from 'node:assert/strict';
const account = 'AC' + 'a'.repeat(32), message = 'SM' + 'b'.repeat(32), media = 'ME' + 'c'.repeat(32);
const built = await build({ entryPoints: ['worker.js'], bundle: true, format: 'esm', write: false, platform: 'browser', target: 'es2022' });
let transcripts = 0, images = 0, replies = 0;
const response = text => Response.json({ status: 'completed', output: [{ content: [{ type: 'output_text', text }] }] });
const runtime = new Miniflare(convertV4MiniflareOptions({ modules: true, script: built.outputFiles[0].text, compatibilityDate: '2026-09-21', kvNamespaces: ['NOTES_KV'], durableObjects: { SUPPORT_COORDINATOR: { className: 'SupportCoordinator', useSQLite: true } }, bindings: { ENVIRONMENT: 'development', VALIDATE_TWILIO_SIGNATURE: 'false', COORDINATOR_BOOTSTRAP_APPROVED: 'true', TWILIO_ACCOUNT_SID: account, TWILIO_AUTH_TOKEN: 'fixture', TWILIO_WHATSAPP_FROM: 'whatsapp:+15550002222', OPENAI_API_KEY: 'fixture' }, outboundService: async request => {
  const url = new URL(request.url);
  if (url.hostname === 'api.twilio.com' && url.pathname.includes('/Media/')) return new Response('fixture', { headers: { 'Content-Type': url.pathname.includes(message) ? 'audio/ogg' : 'image/png' } });
  if (url.pathname === '/v1/audio/transcriptions') { const form = await request.formData(); assert.equal(form.get('file').name, 'voice.ogg'); transcripts++; return Response.json({ text: 'ReadSmart reading crashes on Start' }); }
  if (url.pathname === '/v1/responses') { const body = await request.json(); assert.equal(body.input[0].content[1].type, 'input_image'); images++; return response('ReadSmart screen shows an error on Start'); }
  if (url.hostname === 'api.twilio.com' && url.pathname.endsWith('/Messages.json')) { const form = await request.formData(); assert.match(form.get('Body'), /RS-000001/); replies++; return Response.json({ sid: 'SMfixtureoutbound' }, { status: 201 }); }
  throw new Error('Unexpected outbound service');
} }));
async function waitFor(check) { for (let i = 0; i < 100; i++) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 100)); } throw new Error('Alarm did not finish'); }
try {
  const send = (sid, type) => runtime.dispatchFetch('https://example.com/webhook/whatsapp', { method: 'POST', body: new URLSearchParams({ From: 'whatsapp:+15550001111', MessageSid: sid, NumMedia: '1', MediaContentType0: type, MediaUrl0: `https://api.twilio.com/2010-04-01/Accounts/${account}/Messages/${sid}/Media/${media}` }) });
  const ack = await (await send(message, 'audio/ogg; codecs=opus')).text(); assert.match(ack, /received your attachment/);
  assert.equal(await (await send(message, 'audio/ogg; codecs=opus')).text(), ack);
  const kv = await runtime.getKVNamespace('NOTES_KV');
  await waitFor(async () => Boolean(await kv.get('support-case:RS-000001')) && replies === 1);
  await send('SM' + 'd'.repeat(32), 'image/png');
  await waitFor(async () => /Screenshot description/.test((await kv.get('support-case:RS-000001')) || '') && replies === 2);
  assert.equal(transcripts, 1); assert.equal(images, 1);
  assert.equal((await kv.list({ prefix: 'support-case:RS-' })).keys.length, 1);
  console.log('Bundled Worker: queued OGG transcription, screenshot follow-up, deduplication, alarms, case mirrors and outbound replies passed with provider fixtures.');
} finally { await runtime.dispose(); }
