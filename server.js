require('dotenv').config();

const express = require('express');
const fs = require('fs');
const path = require('path');
const twilio = require('twilio');
const OpenAI = require('openai');

const app = express();
const port = Number(process.env.PORT || 3000);
const conversations = new Map();
const notesPath = path.join(__dirname, 'data', 'notes.json');
const ownerNumber = process.env.OWNER_WHATSAPP_NUMBER;
const twilioClient = process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
  ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
  : null;
const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

function loadNotes() {
  try {
    return JSON.parse(fs.readFileSync(notesPath, 'utf8'));
  } catch {
    return [];
  }
}

function saveNotes(notes) {
  fs.mkdirSync(path.dirname(notesPath), { recursive: true });
  fs.writeFileSync(notesPath, JSON.stringify(notes, null, 2));
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

async function aiReply(message, from, history) {
  if (!openai) return fallbackReply(message);
  try {
    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0.3,
      max_tokens: 280,
      messages: [
        {
          role: 'system',
          content: 'You are Skoolio support on WhatsApp. Help clients with PlaySmart, ReadSmart, and onboarding. Be warm, concise, practical, and ask one useful follow-up question. Never invent account-specific facts, passwords, refunds, or technical fixes. If the issue needs a person, say so and suggest the client send details. Use plain text suitable for WhatsApp.'
        },
        ...history.slice(-8),
        { role: 'user', content: `Client ${from}: ${message}` }
      ]
    });
    return response.choices[0]?.message?.content?.trim() || fallbackReply(message);
  } catch (error) {
    console.error('AI reply failed:', error.message);
    return fallbackReply(message);
  }
}

async function createNote({ from, body, kind }) {
  const note = { id: `note_${Date.now()}`, createdAt: new Date().toISOString(), from, kind, body };
  const notes = loadNotes();
  notes.push(note);
  saveNotes(notes);

  if (twilioClient && ownerNumber && process.env.TWILIO_WHATSAPP_FROM) {
    const ownerMessage = `Skoolio ${kind} from ${from}\n\n${body}\n\nNote ID: ${note.id}`;
    try {
      await twilioClient.messages.create({
        from: process.env.TWILIO_WHATSAPP_FROM,
        to: ownerNumber,
        body: ownerMessage
      });
    } catch (error) {
      console.error('Owner alert failed:', error.message);
    }
  }
  return note;
}

function isNoteMessage(message) {
  return /^(bug|issue|problem|note|feedback)\s*:/i.test(message) || /\b(can't|cannot|doesn't|won't|broken|error|bug|crash|stuck)\b/i.test(message);
}

function twimlResponse(text) {
  const response = new twilio.twiml.MessagingResponse();
  response.message(text);
  return response.toString();
}

app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'skoolio-whatsapp-bot', aiConfigured: Boolean(openai) });
});

app.post('/webhook/whatsapp', (req, res) => {
  if (process.env.VALIDATE_TWILIO_SIGNATURE !== 'false') {
    const signature = req.header('X-Twilio-Signature');
    const url = `${process.env.BASE_URL || `${req.protocol}://${req.get('host')}`}${req.originalUrl}`;
    const valid = signature && twilio.validateRequest(process.env.TWILIO_AUTH_TOKEN, signature, url, req.body);
    if (!valid) return res.status(403).send('Invalid Twilio signature');
  }

  const from = cleanText(req.body.From || 'unknown-client');
  const message = cleanText(req.body.Body);
  if (!message) return res.type('text/xml').send(twimlResponse('Please send a message and I will help.'));

  const history = conversations.get(from) || [];
  history.push({ role: 'user', content: message });
  conversations.set(from, history.slice(-10));

  const noteMatch = message.match(/^(bug|issue|problem|note|feedback)\s*:\s*(.*)$/i);
  const notePromise = isNoteMessage(message)
    ? createNote({ from, body: noteMatch?.[2] || message, kind: noteMatch?.[1]?.toUpperCase() || 'SUPPORT ISSUE' })
    : Promise.resolve(null);

  Promise.all([aiReply(message, from, history), notePromise]).then(([reply, note]) => {
    const finalReply = note
      ? `Thanks, I recorded this for the Skoolio team as ${note.id}. A team member can follow up with you.\n\n${reply}`
      : reply;
    history.push({ role: 'assistant', content: finalReply });
    conversations.set(from, history.slice(-10));
    res.type('text/xml').send(twimlResponse(finalReply));
  }).catch((error) => {
    console.error('Webhook handling failed:', error);
    res.type('text/xml').send(twimlResponse('I could not complete that request. Please try again or reply HUMAN for team support.'));
  });
});

app.listen(port, () => {
  console.log(`Skoolio WhatsApp bot listening on port ${port}`);
});
