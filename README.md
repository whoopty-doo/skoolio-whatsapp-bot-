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

## Run locally

```bash
npm install
cp .env.example .env
npm start
```

The health endpoint is `GET /health` and the webhook is `POST /webhook/whatsapp`.

For local testing, set `VALIDATE_TWILIO_SIGNATURE=false`. To receive real WhatsApp messages, expose the server with a public HTTPS URL (for example, a deployment or an HTTPS tunnel) and set the Twilio WhatsApp sender webhook to:

```text
https://YOUR_DOMAIN/webhook/whatsapp
```

Set `VALIDATE_TWILIO_SIGNATURE=true` in production. Twilio signs the request using the exact public URL configured in `BASE_URL`.

## Client commands

- `menu` - show the main options
- `playsmart` - PlaySmart overview and onboarding steps
- `readsmart` - ReadSmart overview and onboarding steps
- `onboarding` - app setup checklist
- `human` - request owner follow-up
- `bug: the issue description` - report a bug
- `note: something to remember` - send an owner note

## Production notes

For a multi-instance deployment, replace the in-memory conversations with Redis or a database. Keep Twilio credentials and `OPENAI_API_KEY` in deployment secrets, never in source control.
