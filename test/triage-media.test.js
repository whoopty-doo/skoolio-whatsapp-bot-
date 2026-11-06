import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker.js';
import { setup, accessHeaders, adminConfig } from './helpers.js';
import { CaseRepository } from '../support-cases.js';
import { reportedIssue } from '../triage.js';
import { incomingMedia, extractMedia } from '../media.js';
const account = 'AC' + 'a'.repeat(32), sid = 'SM' + 'b'.repeat(32), mediaId = 'ME' + 'c'.repeat(32);
const mediaURL = `https://api.twilio.com/2010-04-01/Accounts/${account}/Messages/${sid}/Media/${mediaId}`;
const form = (type = 'audio/ogg', caption = '') => new URLSearchParams({ From: 'whatsapp:+15550001111', MessageSid: sid, Body: caption, NumMedia: '1', MediaUrl0: mediaURL, MediaContentType0: type });
const output = text => Response.json({ status: 'completed', output: [{ content: [{ type: 'output_text', text }] }] });

test('natural English/Afrikaans and product aliases create correctly prefixed cases without Bug commands', async () => {
  for (const [message, prefix] of [['Playsmart has an issue', 'PS'], ['rsmart werk nie wanneer ek Start druk nie', 'RS'], ['RS keeps loading', 'RS'], ['Skoolio Admin saves the wrong value', 'SA']]) {
    const f = setup(); assert.match(await (await f.send(message)).text(), new RegExp(prefix + '-000001'));
    assert.equal((await new CaseRepository(f.store()).list()).length, 1);
  }
  const f = setup(); await f.send('PS has an issue'); await f.send('On my laptop after clicking Start');
  const [item] = await new CaseRepository(f.store()).list(); assert.match(item.user_description, /laptop/); assert.equal(item.pending_question, '');
});
test('model intent is bounded and validated; questions, refusals and malformed results cannot create cases', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (_url, options) => { const body = JSON.parse(options.body); assert.equal(body.store, false); assert.equal(body.text.format.strict, true); assert.doesNotMatch(options.body, /EXAMPLE_SECRET/); return output(JSON.stringify({ intent: 'reported_issue', confidence: 0.94 })); };
    const f = setup({ OPENAI_API_KEY: 'test' }); assert.match(await (await f.send('PlaySmart sends me back to the beginning every time; password=EXAMPLE_SECRET')).text(), /PS-000001/);
    for (const result of [{ intent: 'question', confidence: 1 }, { intent: 'reported_issue', confidence: '1' }, { intent: 'reported_issue', confidence: 0.2 }]) { globalThis.fetch = async () => output(JSON.stringify(result)); assert.equal(await reportedIssue({ OPENAI_API_KEY: 'test' }, 'Where is the button?'), false); }
    globalThis.fetch = async () => { throw new Error('timeout'); }; assert.equal(await reportedIssue({ OPENAI_API_KEY: 'test' }, 'Where is the button?'), false);
    assert.equal(await reportedIssue({}, 'PlaySmart works fine, no issues'), false);
    assert.equal(await reportedIssue({}, 'How do I report a bug?'), false);
  } finally { globalThis.fetch = original; }
});
test('RS and SA cases remain readable, editable and visible in owner history alongside legacy PS cases', async () => {
  const f = setup(adminConfig, { 'support-case:PS-000040': JSON.stringify({ caseId: 'PS-000040' }), 'support-case:sequence': '1' });
  await f.send('ReadSmart has an issue'); await f.send('Skoolio Admin has an issue');
  const repo = new CaseRepository(f.store()); assert.deepEqual(new Set((await repo.list()).map(x => x.case_id)), new Set(['PS-000040', 'RS-000041', 'SA-000042']));
  const auth = await accessHeaders(), original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ keys: [auth.publicJwk] });
  try {
    assert.equal((await worker.fetch(new Request('https://example.com/api/admin/cases/RS-000041/history', auth), f.env)).status, 200);
    const item = await repo.get('SA-000042'); const response = await worker.fetch(new Request('https://example.com/api/admin/cases/SA-000042', { method: 'PATCH', headers: auth.headers, body: JSON.stringify({ revision: item.revision, owner_notes: 'Checked' }) }), f.env); assert.equal(response.status, 200);
  } finally { globalThis.fetch = original; }
});
test('voice notes queue once, remain responsive during extraction, and atomically create an RS case and reply', async () => {
  const f = setup({ TWILIO_ACCOUNT_SID: account, TWILIO_AUTH_TOKEN: 'test', OPENAI_API_KEY: 'test' });
  const send = () => worker.fetch(new Request('https://example.com/webhook/whatsapp', { method: 'POST', body: form() }), f.env);
  const original = globalThis.fetch; let release; let downloading;
  const started = new Promise(resolve => { downloading = resolve; });
  globalThis.fetch = async (url, options) => {
    if (url === mediaURL) { downloading(); await new Promise(resolve => { release = resolve; }); return new Response('OggS-test', { headers: { 'Content-Type': 'audio/ogg' } }); }
    assert.match(url, /audio\/transcriptions$/); assert.equal(options.body.get('file').name, 'voice.ogg');
    return Response.json({ text: 'ReadSmart reading crashes when I press Start' });
  };
  try {
    assert.match(await (await send()).text(), /received your attachment/); await send();
    assert.equal((await f.store().list({ prefix: 'media-job:' })).keys.length, 1);
    const alarm = f.coordinator.alarm(); await started;
    assert.match(await (await f.send('hello', 'whatsapp:+15550002222')).text(), /Welcome/);
    release(); await alarm;
    const [item] = await new CaseRepository(f.store()).list(); assert.equal(item.case_id, 'RS-000001'); assert.match(item.user_description, /Voice note transcription/);
    assert.equal((await f.store().list({ prefix: 'media-job:' })).keys.length, 0);
    await send(); assert.equal((await new CaseRepository(f.store()).list()).length, 1);
    assert.ok((await f.store().list({ prefix: 'outbox:media:' })).keys.length === 1);
  } finally { if (release) release(); globalThis.fetch = original; }
});
test('screenshot evidence updates its original case, strips secrets and removes temporary URLs', async () => {
  const f = setup({ TWILIO_ACCOUNT_SID: account, TWILIO_AUTH_TOKEN: 'test', OPENAI_API_KEY: 'test' });
  await f.send('PlaySmart has an issue'); const original = globalThis.fetch;
  globalThis.fetch = async url => url === mediaURL ? new Response('fake-image', { headers: { 'Content-Type': 'image/png' } }) : output('PlaySmart error on screen, password=EXAMPLE_SECRET');
  try {
    await worker.fetch(new Request('https://example.com/webhook/whatsapp', { method: 'POST', body: form('image/png') }), f.env);
    await f.coordinator.alarm(); const items = await new CaseRepository(f.store()).list(); assert.equal(items.length, 1); assert.match(items[0].user_description, /Screenshot description/);
    assert.doesNotMatch(JSON.stringify([...f.storage.values]), /EXAMPLE_SECRET|api.twilio.com/);
  } finally { globalThis.fetch = original; }
});
test('media rejects foreign accounts, arbitrary URLs, unsupported types, oversized files and credential-leaking redirects', async () => {
  for (const url of ['http://127.0.0.1/private', mediaURL.replace(account, 'AC' + 'd'.repeat(32)), mediaURL + '?secret=yes']) {
    const value = form(); value.set('MediaUrl0', url); assert.throws(() => incomingMedia(value, { TWILIO_ACCOUNT_SID: account }));
  }
  assert.throws(() => incomingMedia(form('application/pdf'), { TWILIO_ACCOUNT_SID: account }));
  const env = { TWILIO_ACCOUNT_SID: account, TWILIO_AUTH_TOKEN: 'test', OPENAI_API_KEY: 'test' }, job = { media: incomingMedia(form(), env) }, original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('', { status: 302, headers: { Location: 'https://attacker.invalid/' } }); await assert.rejects(extractMedia(job, env), /redirect/);
    globalThis.fetch = async () => new Response('x', { headers: { 'Content-Type': 'audio/ogg', 'Content-Length': '99999999' } }); await assert.rejects(extractMedia(job, env), /large/);
    let calls = 0; globalThis.fetch = async (url, options) => { calls++; if (calls === 1) return new Response('', { status: 302, headers: { Location: 'https://mms.twiliocdn.com/allowed' } }); if (calls === 2) { assert.equal(options.headers, undefined); return new Response('OggS', { headers: { 'Content-Type': 'audio/ogg' } }); } return Response.json({ text: 'ReadSmart issue' }); };
    assert.match(await extractMedia(job, env), /ReadSmart/);
  } finally { globalThis.fetch = original; }
});

test('temporary extraction failures retry durably; success returns the transcript and safe diagnostics', async () => {
  const f = setup({ TWILIO_ACCOUNT_SID: account, TWILIO_AUTH_TOKEN: 'test', OPENAI_API_KEY: 'test' });
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = async url => {
    if (url === mediaURL) return new Response('OggS-test', { headers: { 'Content-Type': 'audio/ogg; codecs=opus' } });
    calls++; return calls === 1 ? new Response('secret provider body', { status: 503 }) : Response.json({ text: 'ReadSmart reading crashes on Start' });
  };
  try {
    await worker.fetch(new Request('https://example.com/webhook/whatsapp', { method: 'POST', body: form() }), f.env);
    await f.coordinator.alarm();
    const store = f.store(), key = (await store.list({ prefix: 'media-job:' })).keys[0].name;
    const job = JSON.parse(await store.get(key)); assert.equal(job.status, 'PENDING'); assert.equal(job.failure.status, 503);
    assert.equal((await store.list({ prefix: 'outbox:media:' })).keys.length, 0);
    await f.coordinator.alarm(); assert.equal(calls, 1, 'backoff must prevent early retries');
    await store.put(key, JSON.stringify({ ...job, nextAttemptAt: 0 })); await store.commit();
    await f.coordinator.alarm();
    const outboxKey = (await f.store().list({ prefix: 'outbox:media:' })).keys[0].name;
    const reply = JSON.parse(await f.store().get(outboxKey)); assert.match(reply.body, /Voice note transcription.*ReadSmart/s); assert.match(reply.body, /RS-000001/);
    const diagnostics = JSON.parse(await f.store().get('media-diagnostics')); assert.equal(diagnostics.retries, 1); assert.equal(diagnostics.completed, 1);
    assert.doesNotMatch(JSON.stringify(diagnostics), /secret provider body|api.twilio.com|whatsapp:/);
  } finally { globalThis.fetch = original; }
});

test('permanent provider failures do not retry and remove media URLs; transient failures stop after three attempts', async () => {
  const original = globalThis.fetch;
  try {
    for (const status of [401, 429]) {
      const f = setup({ TWILIO_ACCOUNT_SID: account, TWILIO_AUTH_TOKEN: 'test', OPENAI_API_KEY: 'test' }); let calls = 0;
      globalThis.fetch = async () => { calls++; return new Response('private failure', { status }); };
      await worker.fetch(new Request('https://example.com/webhook/whatsapp', { method: 'POST', body: form() }), f.env);
      for (let i = 0; i < 3; i++) {
        await f.coordinator.alarm();
        const store = f.store(); for (const { name } of (await store.list({ prefix: 'media-job:' })).keys) { const job = JSON.parse(await store.get(name)); await store.put(name, JSON.stringify({ ...job, nextAttemptAt: 0 })); } await store.commit();
      }
      assert.equal(calls, status === 401 ? 1 : 3);
      assert.equal((await f.store().list({ prefix: 'media-job:' })).keys.length, 0);
      assert.equal(JSON.parse(await f.store().get('media-diagnostics')).failed, 1);
      assert.doesNotMatch(JSON.stringify([...f.storage.values]), /api.twilio.com|private failure/);
    }
  } finally { globalThis.fetch = original; }
});

test('equivalent media MIME aliases are accepted without weakening origin verification', async () => {
  const env = { TWILIO_ACCOUNT_SID: account, TWILIO_AUTH_TOKEN: 'test', OPENAI_API_KEY: 'test' };
  assert.equal(incomingMedia(form('application/ogg; codecs=opus'), env)[0].type, 'audio/ogg');
  assert.equal(incomingMedia(form('image/jpg'), env)[0].type, 'image/jpeg');
  const original = globalThis.fetch;
  globalThis.fetch = async url => url === mediaURL ? new Response('audio', { headers: { 'Content-Type': 'audio/mp4' } }) : Response.json({ text: 'How do I start a reading lesson in PlaySmart?' });
  try { assert.match(await extractMedia({ media: incomingMedia(form('audio/x-m4a'), env) }, env), /reading lesson/); }
  finally { globalThis.fetch = original; }
});

test('media network failures identify the failing stage without leaking provider URLs or error text', async () => {
  const original = globalThis.fetch;
  const env = { TWILIO_ACCOUNT_SID: account, TWILIO_AUTH_TOKEN: 'test', OPENAI_API_KEY: 'test' };
  const job = { media: incomingMedia(form(), env) };
  try {
    globalThis.fetch = async url => { if (url === mediaURL) return new Response('', { status: 302, headers: { Location: 'https://mms.twiliocdn.com/allowed' } }); throw new TypeError('Unexpected redirect: https://secret.invalid/EXAMPLE_SECRET'); };
    await assert.rejects(extractMedia(job, env), error => error.code === 'DOWNLOAD_CDN_REDIRECT' && error.stage === 'download_cdn' && !error.retryable && !JSON.stringify(error).includes('EXAMPLE_SECRET'));
    globalThis.fetch = async url => { if (url === mediaURL) return new Response('audio', { headers: { 'Content-Type': 'audio/ogg' } }); throw new DOMException('Timed out', 'TimeoutError'); };
    await assert.rejects(extractMedia(job, env), error => error.code === 'TRANSCRIPTION_TIMEOUT' && error.retryable);
  } finally { globalThis.fetch = original; }
});

test('WhatsApp outbound accepts a configured bare E.164 sender and preserves only numeric provider errors', async () => {
  const { deliverNotification } = await import('../notifications.js');
  const original = globalThis.fetch;
  const env = { TWILIO_ACCOUNT_SID: account, TWILIO_AUTH_TOKEN: 'test', TWILIO_WHATSAPP_FROM: ' +15550002222 ' };
  try {
    globalThis.fetch = async (_url, options) => {
      assert.equal(options.body.get('From'), 'whatsapp:+15550002222');
      return Response.json({ code: 63007, message: 'Private phone and EXAMPLE_SECRET' }, { status: 400 });
    };
    const result = await deliverNotification(env, { to: 'whatsapp:+15550001111', body: 'Test', requires_session: true }, Date.now());
    assert.equal(result.reason, 'TWILIO_ERROR_63007'); assert.equal(result.status, 'BLOCKED'); assert.doesNotMatch(JSON.stringify(result), /EXAMPLE_SECRET/);
    assert.equal((await deliverNotification({ ...env, TWILIO_WHATSAPP_FROM: 'not-a-number' }, {}, Date.now())).reason, 'TWILIO_SENDER_INVALID');
  } finally { globalThis.fetch = original; }
});

test('media follows bounded same-CDN redirects without credentials and rejects unsafe later hops', async () => {
  const original = globalThis.fetch;
  const env = { TWILIO_ACCOUNT_SID: account, TWILIO_AUTH_TOKEN: 'test', OPENAI_API_KEY: 'test' };
  const job = { media: incomingMedia(form(), env) };
  try {
    let calls = 0;
    globalThis.fetch = async (url, options) => {
      calls++;
      if (url === mediaURL) return new Response('', { status: 307, headers: { Location: 'https://mms.twiliocdn.com/media' } });
      if (url.startsWith('https://mms.twiliocdn.com/')) {
        assert.equal(options.headers, undefined); assert.equal(options.redirect, 'manual');
        if (url.endsWith('/media')) return new Response('', { status: 302, headers: { Location: '/signed?token=test' } });
        return new Response('OggS', { headers: { 'Content-Type': 'audio/ogg' } });
      }
      return Response.json({ text: 'How do I use PlaySmart?' });
    };
    assert.match(await extractMedia(job, env), /How do I use PlaySmart/); assert.equal(calls, 4);
    for (const target of ['https://attacker.invalid/private', 'http://mms.twiliocdn.com/media', 'https://user:pass@mms.twiliocdn.com/media']) {
      calls = 0;
      globalThis.fetch = async () => { calls++; return new Response('', { status: 302, headers: { Location: calls === 1 ? 'https://mms.twiliocdn.com/media' : target } }); };
      await assert.rejects(extractMedia(job, env), /redirect rejected/); assert.equal(calls, 2);
    }
    calls = 0;
    globalThis.fetch = async () => { calls++; return new Response('', { status: 302, headers: { Location: 'https://mms.twiliocdn.com/loop' } }); };
    await assert.rejects(extractMedia(job, env), /redirect limit/); assert.equal(calls, 5);
  } finally { globalThis.fetch = original; }
});
