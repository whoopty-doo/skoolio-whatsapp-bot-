import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { fallbackReply } from '../worker.js';
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
  assert.match(supportCase.caseId, /^PS-\d{6}$/);
  assert.doesNotMatch(supportCase.userDescription, /secret-value|jane@example.com|27821234567/);
  assert.equal(supportCase.status, 'NEW');
  assert.match(ownerNotification(supportCase), new RegExp(supportCase.caseId));
  assert.doesNotMatch(ownerNotification(supportCase), /jane@example.com|27821234567/);
});