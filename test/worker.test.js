import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { ConversationStore, fallbackReply } from '../worker.js';
import { searchKnowledge } from '../knowledge.js';
import { CaseRepository, ownerNotification } from '../support-cases.js';

const env = { VALIDATE_TWILIO_SIGNATURE: 'false' };

test('health endpoint returns Worker status', async () => {
  const response = await worker.fetch(new Request('https://example.com/health'), env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, service: 'skoolio-whatsapp-bot', aiConfigured: false });
});

test('WhatsApp webhook returns TwiML for PlaySmart', async () => {
  const body = new URLSearchParams({ From: 'whatsapp:+15550001111', Body: 'PLAYSMART' });
  const response = await worker.fetch(new Request('https://example.com/webhook/whatsapp', { method: 'POST', body }), env);
  const xml = await response.text();
  assert.equal(response.status, 200);
  assert.match(xml, /<Response><Message>/);
  assert.match(xml, /PlaySmart helps learners/);
});

test('bug messages are acknowledged and sanitized in TwiML', async () => {
  const body = new URLSearchParams({ From: 'whatsapp:+15550001111', Body: 'BUG: <cannot open app>' });
  const response = await worker.fetch(new Request('https://example.com/webhook/whatsapp', { method: 'POST', body }), env);
  const xml = await response.text();
  assert.match(xml, /recorded this for the Skoolio team/);
  assert.doesNotMatch(xml, /<cannot open app>/);
});

test('fallback remains available without OpenAI', () => {
  assert.match(fallbackReply('READSMART'), /ReadSmart supports reading practice/);
});

test('knowledge retrieval returns focused product records', () => {
  const matches = searchKnowledge('student reading lesson loading sync');
  assert.ok(matches.length > 0);
  assert.ok(matches.length <= 4);
  assert.ok(matches.some((record) => record.category === 'reading' || record.category === 'sync'));
  assert.ok(matches.every((record) => !('sourceCode' in record)));
});

test('support cases have PS IDs and sanitize sensitive data', async () => {
  const supportCase = await new CaseRepository().create({
    userDescription: 'Student Jane cannot login. token: secret-value, jane@example.com, +27821234567',
    aiSummary: 'Authentication issue',
    category: 'AUTHENTICATION',
    confidence: 0.8,
    actualBehaviour: 'Login fails'
  });
  assert.match(supportCase.case_id, /^PS-\d{6}$/);
  assert.doesNotMatch(supportCase.user_description, /secret-value|jane@example.com|27821234567/);
  assert.equal(supportCase.status, 'NEW');
  assert.match(ownerNotification(supportCase), new RegExp(supportCase.case_id));
  assert.doesNotMatch(ownerNotification(supportCase), /jane@example.com|27821234567/);
});

test('each WhatsApp sender gets an isolated persistent OpenAI conversation', async () => {
  const values = new Map();
  const kv = {
    async get(key) { return values.get(key) || null; },
    async put(key, value) { values.set(key, value); },
    async delete(key) { values.delete(key); }
  };
  const originalFetch = globalThis.fetch;
  let created = 0;
  globalThis.fetch = async (url) => {
    assert.equal(url, 'https://api.openai.com/v1/conversations');
    created += 1;
    return new Response(JSON.stringify({ id: `conv_${created}` }), { status: 200 });
  };
  try {
    const store = new ConversationStore({ OPENAI_API_KEY: 'test-key', NOTES_KV: kv });
    const first = await store.getOrCreate('whatsapp:+15550001111');
    const sameSender = await store.getOrCreate('whatsapp:+15550001111');
    const otherSender = await store.getOrCreate('whatsapp:+15550002222');
    assert.equal(first.id, 'conv_1');
    assert.equal(sameSender.id, first.id);
    assert.equal(otherSender.id, 'conv_2');
    assert.equal(created, 2);
    await store.reset('whatsapp:+15550001111');
    assert.equal((await store.getOrCreate('whatsapp:+15550001111')).id, 'conv_3');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('webhook asks for useful diagnostics before creating a case and notifies owner', async () => {
  const values = new Map();
  const kv = {
    async get(key) { return values.get(key) || null; },
    async put(key, value) { values.set(key, value); },
    async delete(key) { values.delete(key); }
  };
  const originalFetch = globalThis.fetch;
  const twilioBodies = [];
  globalThis.fetch = async (url, options = {}) => {
    if (url === 'https://api.openai.com/v1/conversations') {
      return new Response(JSON.stringify({ id: 'conv_triage' }), { status: 200 });
    }
    if (url === 'https://api.openai.com/v1/responses') {
      return new Response(JSON.stringify({ output_text: 'Thanks, I understand.' }), { status: 200 });
    }
    if (String(url).includes('api.twilio.com')) {
      twilioBodies.push(new URLSearchParams(options.body).get('Body'));
      return new Response('{}', { status: 201 });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };
  const testEnv = {
    ...env,
    OPENAI_API_KEY: 'test-key',
    NOTES_KV: kv,
    TWILIO_ACCOUNT_SID: 'ACtest',
    TWILIO_AUTH_TOKEN: 'twilio-test',
    TWILIO_WHATSAPP_FROM: 'whatsapp:+15550000000',
    OWNER_WHATSAPP_NUMBER: 'whatsapp:+15559999999'
  };
  const send = (from, text) => worker.fetch(new Request('https://example.com/webhook/whatsapp', {
    method: 'POST',
    body: new URLSearchParams({ From: from, Body: text })
  }), testEnv);
  try {
    const first = await send('whatsapp:+15550001111', 'My spelling lesson is not working');
    assert.match(await first.text(), /which PlaySmart feature or screen/);
    assert.equal(twilioBodies.length, 0);

    const second = await send('whatsapp:+15550001111', 'It closes when I press Start on Windows');
    assert.match(await second.text(), /PS-\d{6}/);
    assert.equal(twilioBodies.length, 1);
    assert.match(twilioBodies[0], /PLAYSMART SUPPORT/);
    assert.match(twilioBodies[0], /Area:.*Spelling/);
    assert.doesNotMatch(twilioBodies[0], /15550001111/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('reset command clears the sender conversation and triage draft', async () => {
  const values = new Map();
  const kv = {
    async get(key) { return values.get(key) || null; },
    async put(key, value) { values.set(key, value); },
    async delete(key) { values.delete(key); }
  };
  const testEnv = { ...env, NOTES_KV: kv };
  const send = (text) => worker.fetch(new Request('https://example.com/webhook/whatsapp', {
    method: 'POST',
    body: new URLSearchParams({ From: 'whatsapp:+15550003333', Body: text })
  }), testEnv);
  await send('My spelling lesson is not working');
  assert.ok([...values.keys()].some((key) => key.startsWith('conversation:mapping:')));
  assert.ok([...values.keys()].some((key) => key.startsWith('support-triage:')));
  const response = await send('start over');
  assert.match(await response.text(), /conversation has been reset/);
  assert.equal([...values.keys()].filter((key) => key.startsWith('conversation:mapping:')).length, 0);
  assert.equal([...values.keys()].filter((key) => key.startsWith('support-triage:')).length, 0);
});