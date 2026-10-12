import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { build } from 'esbuild';
import assert from 'node:assert/strict';
const built = await build({ entryPoints: ['worker.js'], bundle: true, format: 'esm', write: false, platform: 'browser', target: 'es2022' });
const runtime = new Miniflare(convertV4MiniflareOptions({ modules: true, script: built.outputFiles[0].text, compatibilityDate: '2026-09-21', kvNamespaces: ['NOTES_KV'], durableObjects: { SUPPORT_COORDINATOR: { className: 'SupportCoordinator', useSQLite: true } }, bindings: { ENVIRONMENT: 'development', VALIDATE_TWILIO_SIGNATURE: 'false', COORDINATOR_BOOTSTRAP_APPROVED: 'true' } }));
try {
  const requests = Array.from({ length: 6 }, (_, i) => runtime.dispatchFetch('https://example.com/webhook/whatsapp', { method: 'POST', body: new URLSearchParams({ From: `whatsapp:+1555000000${i}`, MessageSid: `SMruntime00000${i}`, Body: 'ReadSmart reading crashes on Windows' }) }));
  const replies = await Promise.all((await Promise.all(requests)).map(async response => { assert.equal(response.status, 200); return response.text(); }));
  const ids = replies.map(reply => reply.match(/(?:PS|RS|SA|GS)-\d+/)?.[0]); assert.equal(new Set(ids).size, 6); assert.ok(ids.every(Boolean));
  const duplicate = await runtime.dispatchFetch('https://example.com/webhook/whatsapp', { method: 'POST', body: new URLSearchParams({ From: 'whatsapp:+15550000000', MessageSid: 'SMruntime000000', Body: 'ReadSmart reading crashes on Windows' }) });
  assert.equal(await duplicate.text(), replies[0]);
  await new Promise(resolve => setTimeout(resolve, 2000));
  const kv = await runtime.getKVNamespace('NOTES_KV');
  const mirrored = await kv.list({ prefix: 'support-case:RS-' });
  assert.equal(mirrored.keys.length, 6, 'Durable alarm mirrors committed cases to KV');
  const report = async (body, sid) => (await runtime.dispatchFetch('https://example.com/webhook/whatsapp', { method: 'POST', body: new URLSearchParams({ From: 'whatsapp:+15550000000', MessageSid: sid, Body: body }) })).text();
  assert.match(await report('PlaySmart spelling crashes', 'SMrouting000001'), /PS-000007/);
  assert.match(await report('PlaySmart login rejects my password', 'SMrouting000002'), /PS-000008/);
  assert.match(await report('PlaySmart login shows the wrong account', 'SMrouting000003'), /separate issue/);
  assert.match(await report('new issue', 'SMrouting000004'), /PS-000009/);
  assert.match(await report('It still happens on Windows too', 'SMrouting000005'), /added that to support case PS-000009/);
  console.log('Actual workerd + SQLite Durable Object: concurrent cases, replay and alarm-driven KV mirroring passed.');
} finally { await runtime.dispose(); }
