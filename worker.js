import { searchKnowledge } from './knowledge.js';
import { CaseRepository, TriageDraftStore, ownerNotification } from './support-cases.js';

const conversations = new Map();
const localConversationMappings = new Map();
const SYSTEM_PROMPT = 'You are Skoolio support on WhatsApp. Help clients with PlaySmart, ReadSmart, and onboarding. Be warm, concise, practical, and ask one useful follow-up question. Never invent account-specific facts, passwords, refunds, or technical fixes. If the issue needs a person, say so and suggest the client send details. Use plain text suitable for WhatsApp.';
const CONVERSATION_KEY_PREFIX = 'conversation:mapping:';
const DEFAULT_CONVERSATION_RETENTION_SECONDS = 60 * 60 * 24 * 30;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/health') {
      return jsonResponse({ ok: true, service: 'skoolio-whatsapp-bot', aiConfigured: Boolean(env.OPENAI_API_KEY) });
    }

    if (request.method === 'POST' && url.pathname === '/webhook/whatsapp') {
      return handleWhatsAppWebhook(request, env);
    }

    return new Response('Not found', { status: 404 });
  }
};

async function handleWhatsAppWebhook(request, env) {
  const rawBody = await request.text();
  if (env.VALIDATE_TWILIO_SIGNATURE !== 'false') {
    const signature = request.headers.get('X-Twilio-Signature');
    const valid = signature && env.TWILIO_AUTH_TOKEN
      ? await validateTwilioSignature(env.TWILIO_AUTH_TOKEN, signature, request.url, rawBody)
      : false;
    if (!valid) return new Response('Invalid Twilio signature', { status: 403 });
  }

  const form = new URLSearchParams(rawBody);
  const from = cleanText(form.get('From') || 'unknown-client');
  const message = cleanText(form.get('Body'));
  if (!message) return twimlResponse('Please send a message and I will help.');
  const senderKey = await internalConversationId(from);
  const triageStore = new TriageDraftStore(env.NOTES_KV);

  if (isConversationReset(message)) {
    await new ConversationStore(env).reset(from);
    await triageStore.clear(senderKey);
    return twimlResponse('Your conversation has been reset. What would you like help with?');
  }

  const knowledge = searchKnowledge(message);
  const conversation = await new ConversationStore(env).getOrCreate(from);
  const supportCase = await triageSupportCase(env, { from, message, knowledge, conversationId: conversation.id, senderKey, triageStore });
  if (supportCase?.needsInformation) return twimlResponse(supportCase.reply);

  const reply = await aiReply(env, message, knowledge, conversation.id);
  const finalReply = supportCase
    ? `Thanks, I recorded this for the Skoolio team as ${supportCase.case_id}. A team member can follow up with you.\n\n${reply}`
    : reply;
  return twimlResponse(finalReply);
}

function cleanText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function menu() {
  return [
    'Welcome to Skoolio 👋',
    '',
    'I can help with:',
    '1. PlaySmart',
    '2. ReadSmart',
    '3. App onboarding',
    '4. Support or bug reports',
    '',
    'Reply with a number or type PLAYSMART, READSMART, ONBOARDING, HUMAN, or MENU.'
  ].join('\n');
}

function fallbackReply(message) {
  const text = message.toLowerCase();
  if (text === '1' || text.includes('playsmart')) {
    return 'PlaySmart helps learners build practical skills through guided activities and progress tracking. To get started: install the app, sign in with your invite, complete your profile, then open the first assigned activity. What part should I help with?';
  }
  if (text === '2' || text.includes('readsmart')) {
    return 'ReadSmart supports reading practice with guided lessons and progress tracking. To get started: install the app, sign in with your invite, complete the short setup, then begin the recommended lesson. What part should I help with?';
  }
  if (text === '3' || text.includes('onboard')) {
    return 'App onboarding checklist: 1) download the app, 2) open your invite link, 3) create or confirm your account, 4) complete your profile, and 5) start the assigned activity. Tell me where you are stuck and I will guide you.';
  }
  if (text === '4' || text.includes('human') || text.includes('person')) {
    return 'I have recorded your request for a team member. Please include your name, app, and the best detail about what you need help with.';
  }
  if (text === 'help' || text === 'menu' || text === 'start' || text === 'hi' || text === 'hello') {
    return menu();
  }
  return 'I can help with PlaySmart, ReadSmart, app onboarding, or support. Try MENU, PLAYSMART, READSMART, ONBOARDING, or HUMAN. For an issue, send it as: BUG: what happened.';
}

async function aiReply(env, message, knowledge, conversationId) {
  if (!env.OPENAI_API_KEY) return fallbackReply(message);
  try {
    const knowledgeContext = knowledge.map((record) => `[${record.id}] ${record.title}: ${record.content}`).join('\n');
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: env.OPENAI_MODEL || 'gpt-4o-mini',
        conversation: conversationId,
        instructions: `${SYSTEM_PROMPT} Use only the relevant product knowledge below for product-specific claims. If it does not answer the question, say that you need more information or a team member. Never reveal source paths, internal identifiers, or private data.\n\nRelevant product knowledge:\n${knowledgeContext || 'No matching product knowledge was found.'}`,
        input: message,
        max_output_tokens: 280
      })
    });
    if (!response.ok) throw new Error(`OpenAI returned ${response.status}`);
    const data = await response.json();
    return responseText(data) || fallbackReply(message);
  } catch (error) {
    console.error('AI reply failed:', error.message);
    return fallbackReply(message);
  }
}

function isNoteMessage(message) {
  return /^(bug|issue|problem|note|feedback)\s*:/i.test(message) || /\b(can't|cannot|doesn't|isn't|won't|not working|broken|error|bug|crash|stuck)\b/i.test(message);
}

function hasActionableIssueDetails(message, knowledge) {
  const hasFeature = knowledge.some((record) => ['reading', 'spelling', 'authentication', 'activation', 'sync', 'database', 'lesson', 'platform'].includes(record.category));
  const hasObservedBehavior = /\b(close|crash|crash(es|ed)?|error|stuck|freeze|freez|blank|wrong|fail|doesn't|won't|cannot|can't)\b/i.test(message);
  return hasFeature && hasObservedBehavior;
}

function inferIssueCategory(message, knowledge) {
  const text = message.toLowerCase();
  const explicitCategories = [
    ['perceptual spelling', 'PERCEPTUAL_SPELLING'],
    ['perceptual reading', 'PERCEPTUAL_READING'],
    ['spelling', 'SPELLING'],
    ['reading', 'READING'],
    ['comprehension', 'COMPREHENSION'],
    ['eye kinetics', 'EYE_KINETICS'],
    ['evaluation', 'EVALUATION'],
    ['login', 'AUTHENTICATION'],
    ['activation', 'ACTIVATION'],
    ['sync', 'SYNC'],
    ['database', 'DATABASE']
  ];
  return explicitCategories.find(([term]) => text.includes(term))?.[1] || knowledge[0]?.category?.toUpperCase() || 'OTHER';
}

async function triageSupportCase(env, { from, message, knowledge, conversationId, senderKey, triageStore }) {
  const explicit = /^(bug|issue|problem|feedback)\s*:/i.test(message);
  const existingDraft = await triageStore.get(senderKey);
  if (!explicit && !existingDraft && isNoteMessage(message) && !hasActionableIssueDetails(message, knowledge)) {
    await triageStore.put(senderKey, { initialDescription: message, category: inferIssueCategory(message, knowledge) });
    return { needsInformation: true, reply: 'I can help report that. What were you doing when it happened, and which PlaySmart feature or screen were you using?' };
  }

  if (!explicit && existingDraft) {
    const combined = `${existingDraft.initialDescription}. Follow-up: ${message}`;
    const combinedKnowledge = searchKnowledge(combined);
    const supportCase = await createSupportCase(env, { from, message: combined, knowledge: combinedKnowledge, category: existingDraft.category, conversationId, senderKey });
    await triageStore.clear(senderKey);
    return supportCase;
  }

  if (explicit) {
    const supportCase = await createSupportCase(env, { from, message, knowledge, category: inferIssueCategory(message, knowledge), conversationId, senderKey });
    await triageStore.clear(senderKey);
    return supportCase;
  }

  return null;
}

function isConversationReset(message) {
  return /^(new conversation|start over|reset conversation|new chat)$/i.test(message.trim());
}

function responseText(data) {
  if (typeof data.output_text === 'string') return data.output_text.trim();
  return (data.output || [])
    .flatMap((item) => item.content || [])
    .filter((item) => item.type === 'output_text' && typeof item.text === 'string')
    .map((item) => item.text)
    .join('\n')
    .trim();
}

class ConversationStore {
  constructor(env) {
    this.env = env;
    this.kv = env.CONVERSATIONS_KV || env.NOTES_KV;
    this.retentionSeconds = Number(env.CONVERSATION_RETENTION_SECONDS || DEFAULT_CONVERSATION_RETENTION_SECONDS);
  }

  async getOrCreate(sender) {
    const key = await conversationKey(sender);
    const existing = this.kv ? await this.kv.get(key) : localConversationMappings.get(key);
    if (existing) return { id: existing, key, created: false };
    let id;
    try {
      id = await createOpenAIConversation(this.env);
    } catch (error) {
      console.error('OpenAI conversation creation failed:', error.message);
      id = `local-${Date.now()}`;
    }
    if (this.kv) {
      const options = this.retentionSeconds > 0 ? { expirationTtl: this.retentionSeconds } : undefined;
      await this.kv.put(key, id, options);
    } else {
      localConversationMappings.set(key, id);
    }
    return { id, key, created: true };
  }

  async reset(sender) {
    const key = await conversationKey(sender);
    if (this.kv) await this.kv.delete(key);
    localConversationMappings.delete(key);
  }
}

async function createOpenAIConversation(env) {
  if (!env?.OPENAI_API_KEY) return `local-${Date.now()}`;
  const response = await fetch('https://api.openai.com/v1/conversations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ metadata: { channel: 'whatsapp', product: 'playsmart' } })
  });
  if (!response.ok) throw new Error(`OpenAI conversation creation failed: ${response.status}`);
  const data = await response.json();
  if (!data.id) throw new Error('OpenAI conversation response did not include an id');
  return data.id;
}

async function conversationKey(sender) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sender));
  const hash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${CONVERSATION_KEY_PREFIX}${hash}`;
}

async function createSupportCase(env, { from, message, knowledge, category: requestedCategory, conversationId, senderKey }) {
  const category = requestedCategory || inferIssueCategory(message, knowledge);
  const supportCase = await new CaseRepository(env.NOTES_KV).create({
    userDescription: message,
    aiSummary: `Client reports a possible ${category.toLowerCase()} support issue.`,
    category,
    severity: /crash|cannot|can't|broken|blocked/i.test(message) ? 'HIGH' : 'MEDIUM',
    confidence: knowledge.length ? 0.65 : 0.35,
    featureModule: category === 'SPELLING' ? 'Spelling' : (knowledge[0]?.title || category),
    actualBehaviour: message,
    errorMessage: /\b(error|crash|crash(es|ed)?)\b/i.test(message) ? message : '',
    reporterWhatsappIdentifier: senderKey,
    conversationReference: { channel: 'whatsapp', conversationId: await internalConversationId(conversationId), messageCount: 1 }
  });
  if (env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_WHATSAPP_FROM && env.OWNER_WHATSAPP_NUMBER) {
    try {
      await sendTwilioMessage(env, env.OWNER_WHATSAPP_NUMBER, ownerNotification(supportCase));
    } catch (error) {
      console.error('Owner alert failed:', error.message);
    }
  }
  return supportCase;
}

async function internalConversationId(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

async function sendTwilioMessage(env, to, body) {
  const credentials = btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`);
  const form = new URLSearchParams({ From: env.TWILIO_WHATSAPP_FROM, To: to, Body: body });
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: `Basic ${credentials}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form
  });
  if (!response.ok) console.error('Owner alert failed:', response.status, await response.text());
}

async function validateTwilioSignature(authToken, signature, url, rawBody) {
  const form = new URLSearchParams(rawBody);
  const fields = [...form.keys()].sort();
  const data = url + fields.map((key) => key + form.get(key)).join('');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(authToken), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return timingSafeEqual(signature, arrayBufferToBase64(digest));
}

function timingSafeEqual(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

function arrayBufferToBase64(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}

function twimlResponse(text) {
  const escaped = String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\"/g, '&quot;').replace(/'/g, '&apos;');
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escaped}</Message></Response>`, {
    headers: { 'Content-Type': 'text/xml; charset=UTF-8' }
  });
}

function jsonResponse(data) {
  return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
}

export { ConversationStore, fallbackReply, validateTwilioSignature, conversationKey };