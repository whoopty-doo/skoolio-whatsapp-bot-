# Skoolio WhatsApp Support Bot

AI-assisted customer support and onboarding over a Twilio WhatsApp webhook for Skoolio PlaySmart and ReadSmart.

## What it does

- Welcomes new clients and guides them through PlaySmart, ReadSmart, and app onboarding.
- Answers common support questions with a reliable built-in fallback.
- Uses OpenAI when `OPENAI_API_KEY` is configured.
- Captures messages containing bug/problem language as owner notes.
- Lets a client send `bug: ...` or `note: ...` to create a note.
- Sends new notes to the configured owner WhatsApp number through Twilio.
- Keeps a small local conversation history and notes file for development.
- Uses a reviewed PlaySmart knowledge catalog and retrieves only relevant product records for AI replies.
- Creates structured support cases with `PS-000001` identifiers and lifecycle status `NEW`.

## Cloudflare Worker deployment

```bash
npm install
npx wrangler login
npx wrangler kv namespace create NOTES_KV
```

Put the returned KV namespace ID into `wrangler.jsonc` in place of `REPLACE_WITH_CLOUDFLARE_KV_NAMESPACE_ID`, then set production secrets:

```bash
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put TWILIO_ACCOUNT_SID
npx wrangler secret put TWILIO_AUTH_TOKEN
npx wrangler secret put TWILIO_WHATSAPP_FROM
npx wrangler secret put OWNER_WHATSAPP_NUMBER
npm run deploy
```

The Worker exposes `GET /health` and `POST /webhook/whatsapp`.

For local testing, run `npm run dev` and use `VALIDATE_TWILIO_SIGNATURE=false` only in a local Wrangler environment. Cloudflare KV is the production note store; the Worker uses a process-local fallback only for tests and local development.

Set the Twilio WhatsApp sender webhook to:

```text
https://YOUR_DOMAIN/webhook/whatsapp
```

`VALIDATE_TWILIO_SIGNATURE=true` is configured for production. Twilio signs the request using the exact Worker URL that receives the request.

## Phase 2 support architecture

The public support Worker has no GitHub access and cannot modify the PlaySmart repository. The reviewed knowledge snapshot is in `knowledge.js`; it contains sanitized summaries of routes, lessons, reading, spelling, perceptual activities, comprehension, eye kinetics, evaluations, results, parent/centre workflows, authentication, licensing, SQLite, sync, platforms, and recovery paths.

`searchKnowledge()` selects a small number of matching records before an OpenAI request. The full PlaySmart source is never sent to the model. The catalog is versioned and should be regenerated through a reviewed process when PlaySmart changes.

Support cases are defined in `support-cases.js`. Cases are stored under individual KV keys such as `support-case:PS-000001`, with the sequence stored separately. The `CaseRepository` abstraction allows KV to be replaced by a database later. Case content and owner notifications redact phone numbers, email addresses, token-like values, license values, and student/parent names where they are explicitly labelled.

Meaningful issue messages create cases containing the client description, AI summary, category, severity, confidence, app/build/platform fields, route/screen fields, sanitized diagnostics, sync/database status, an internal hashed conversation reference, and status. Owner WhatsApp alerts contain a concise case summary and never include the client's WhatsApp number or full transcript.

## Client commands

- `menu` - show the main options
- `playsmart` - PlaySmart overview and onboarding steps
- `readsmart` - ReadSmart overview and onboarding steps
- `onboarding` - app setup checklist
- `human` - request owner follow-up
- `bug: the issue description` - report a bug
- `note: something to remember` - send an owner note

## Production notes

Conversation history is intentionally bounded and process-local. Notes use the `NoteStore` abstraction and Cloudflare KV when the `NOTES_KV` binding is configured. Keep Twilio credentials and `OPENAI_API_KEY` in Cloudflare secrets, never in source control.

## Test locally

```bash
npm run check
npm test
```

The test suite exercises the health endpoint, TwiML webhook, fallback responses, knowledge retrieval, structured case IDs, and privacy sanitization. The production Worker should still be tested through a staging URL before changing the live Twilio webhook.
