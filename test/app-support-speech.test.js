import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker.js';
import { answerLanguage } from '../app-support-speech.js';
import { setup } from './helpers.js';

const token = 'fa'.repeat(32);
const config = { APP_SUPPORT_ENABLED: 'true', APP_SUPPORT_VOICE_ENABLED: 'true',
  TINA_ELEVENLABS_API_KEY: 'synthetic-provider-key', TINA_ELEVENLABS_VOICE_ID: 'syntheticVoice123' };
const call = (fixture, path, body = {}, session = token) => worker.fetch(new Request(`https://example.com/api/app-support/${path}`, {
  method: 'POST', headers: { Authorization: `Bearer ${session}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}), fixture.env);
async function prepare(overrides = {}, text = 'Hallo! Ek is Klik. Ek help jou met jou lesinstellings.') {
  const fixture = setup({ ...config, ...overrides });
  const session = await (await call(fixture, 'session')).json();
  const store = fixture.store();
  const thread = JSON.parse(await store.get(`app-support:thread:${session.id}`));
  thread.messages.push({ id: 'answer-1', role: 'assistant', text });
  await store.put(`app-support:thread:${thread.id}`, JSON.stringify(thread)); await store.commit();
  return fixture;
}
async function provider(run, response = () => new Response(new Uint8Array([73, 68, 51, 1]), { headers: { 'Content-Type': 'audio/mpeg' } })) {
  const original = globalThis.fetch; const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), options });
    return response(url, options);
  };
  try { await run(requests); } finally { globalThis.fetch = original; }
}

test('voice is feature-gated and never sends arbitrary text or another session’s messages', async () => {
  const fixture = await prepare();
  await provider(async requests => {
    assert.equal((await call(fixture, 'speech', { message_id: 'answer-1' }, 'invalid')).status, 401);
    assert.equal((await call(fixture, 'speech', { message_id: 'answer-1' }, 'bd'.repeat(32))).status, 404);
    assert.equal((await call(fixture, 'speech', { message_id: 'missing' })).status, 404);
    assert.equal((await call(fixture, 'speech', { message_id: 'answer-1', text: 'arbitrary input' })).status, 400);
    assert.equal((await call(fixture, 'speech', { message_id: 'answer-1', language: 'unknown' })).status, 400);
    const other = await prepare({ APP_SUPPORT_VOICE_ENABLED: 'false' });
    assert.equal((await (await call(other, 'session')).json()).voice_available, false);
    assert.equal((await call(other, 'speech', { message_id: 'answer-1' })).status, 503);
    assert.equal(requests.length, 0);
  });
});

test('Afrikaans voice uses v3, authenticated provider request, bounded MP3 and no public cache', async () => {
  const fixture = await prepare();
  await provider(async requests => {
    assert.equal((await (await call(fixture, 'session')).json()).voice_available, true);
    const response = await call(fixture, 'speech', { message_id: 'answer-1', language: 'auto' });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('X-Tina-Language'), 'af');
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
    assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [73, 68, 51, 1]);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].options.headers['xi-api-key'], config.TINA_ELEVENLABS_API_KEY);
    assert.equal(requests[0].options.redirect, 'manual');
    assert.equal(requests[0].options.headers.Authorization, undefined);
    const payload = JSON.parse(requests[0].options.body);
    assert.equal(payload.model_id, 'eleven_v3'); assert.equal(payload.language_code, 'af');
    assert.equal((await call(fixture, 'speech', { message_id: 'answer-1' })).status, 429);
    assert.equal(requests.length, 1);
  });
});

test('provider calls do not block support coordinator; concurrent duplicate spend is prevented', async () => {
  const fixture = await prepare();
  let finish; let started;
  const ready = new Promise(resolve => { started = resolve; });
  await provider(async requests => {
    const speech = call(fixture, 'speech', { message_id: 'answer-1' });
    await ready;
    assert.equal((await call(fixture, 'session')).status, 200);
    assert.equal((await call(fixture, 'speech', { message_id: 'answer-1' })).status, 429);
    finish(new Response(new Uint8Array([73, 68, 51]), { headers: { 'Content-Type': 'audio/mpeg' } }));
    assert.equal((await speech).status, 200);
    assert.equal(requests.length, 1);
  }, () => new Promise(resolve => { finish = resolve; started(); }));
});

test('provider failure does not leak diagnostics, refund uncertain spend or retry automatically', async () => {
  const fixture = await prepare();
  await provider(async requests => {
    const result = await call(fixture, 'speech', { message_id: 'answer-1' });
    assert.equal(result.status, 502);
    assert.ok(!(await result.text()).includes('PRIVATE'));
    assert.equal((await call(fixture, 'speech', { message_id: 'answer-1' })).status, 429);
    assert.equal(requests.length, 1);
  }, () => new Response('PRIVATE PROVIDER DETAILS', { status: 401 }));
});

test('global daily character budget stops new paid requests and rejects oversized audio', async () => {
  const limited = await prepare({ APP_SUPPORT_VOICE_DAILY_CHAR_LIMIT: '10' });
  await provider(async requests => {
    assert.equal((await call(limited, 'speech', { message_id: 'answer-1' })).status, 429);
    assert.equal(requests.length, 0);
  });
  const fixture = await prepare();
  await provider(async () => {
    assert.equal((await call(fixture, 'speech', { message_id: 'answer-1' })).status, 502);
  }, () => new Response(new Uint8Array(4 * 1024 * 1024 + 1), { headers: { 'Content-Type': 'audio/mpeg' } }));
});

test('failed budget commit cannot call the paid provider', async () => {
  const fixture = await prepare();
  fixture.storage.transaction = async () => { throw new Error('Synthetic outage'); };
  await provider(async requests => {
    assert.equal((await call(fixture, 'speech', { message_id: 'answer-1' })).status, 500);
    assert.equal(requests.length, 0);
  });
});

test('language hint handles Afrikaans and English; user can override ambiguous text', async () => {
  assert.equal(answerLanguage('Kies jou les en kliek op Speel.'), 'af');
  assert.equal(answerLanguage('Choose your lesson and press Play.'), 'en');
  const fixture = await prepare({}, 'PlaySmart');
  await provider(async requests => {
    assert.equal((await call(fixture, 'speech', { message_id: 'answer-1', language: 'af' })).status, 200);
    assert.equal(JSON.parse(requests[0].options.body).language_code, 'af');
  });
});
