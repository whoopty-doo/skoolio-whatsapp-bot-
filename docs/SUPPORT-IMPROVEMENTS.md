# Attachment reliability and how-to support — 23 September 2026

Prepared locally; not deployed. Live production inspection confirmed version `4756072a-325a-49db-9790-ef7207cc1e3e` and the expected OpenAI, Twilio, sender and coordinator bindings. Binding presence does not prove credential validity. No historical extraction failure detail was exposed by the old implementation, so the specific reported live failure remains unconfirmed.

## Pictures and voice notes

- Normalize equivalent MIME labels (including M4A/MP4 and OGG with codec parameters).
- Allow 45 seconds for each extraction request. Keep webhook acknowledgement immediate and extraction outside the request mutex.
- Retry timeouts, network failures, HTTP 408/429 and server failures, with backoff and at most three extraction attempts. Authentication failures and invalid files finish without repeated calls. Expired processing leases have the same attempt bound.
- Keep provider URLs only while work is pending; remove them on completion or terminal failure. Raw media is not persisted.
- Return a short sanitized transcript/screenshot preview when reply space allows. Preserve the actual support reply within the existing WhatsApp message budget.
- Extract visible controls and normal screens as well as error messages, so screenshots can help answer how-to questions.
- `/admin` → **Operations** shows attachment configuration, pending work, completion/failure/retry counters, and the latest processing outcome and safe failure code. It never displays tokens, provider error bodies or media URLs. Counters begin with this version; they are not historical totals.
- `OPENAI_TRANSCRIPTION_MODEL` defaults to `whisper-1`; `OPENAI_VISION_MODEL` defaults to `OPENAI_MODEL` or `gpt-4o-mini`. Existing credentials remain unchanged.

API compatibility was checked against [OpenAI file transcription](https://developers.openai.com/api/docs/guides/speech-to-text) and [Twilio media retrieval](https://www.twilio.com/docs/messaging/api/media-resource). Tests simulate providers; real WhatsApp attachments still require live verification.

## Support guides

Open `/admin` → **Support guides**. Choose a product, title, search words and instructions. Include the relevant role/screen, short numbered steps and expected result. Save as a draft while preparing it; check **Publish for customer replies** when the instructions are verified. Select a saved guide to edit it or uncheck publication to withdraw it. Published documents are public to customers of that product, so they must not contain private customer information.

Guides are stored in the existing coordinator and included in coordinator checkpoint exports. They are not mirrored into the legacy cases KV. Maximum 100 guides, 6000 characters each. Concurrent edits require matching revisions. The editor uses existing Cloudflare Access authentication, JSON/origin checks and DOM text rendering.

The bot preserves a question when asking which product it concerns. General how-to questions no longer get appended to an unrelated open case or misread as case-status requests. Retrieval emphasizes matching titles/search words and uses prior questions when the current turn lacks matching context. The response instructions call for short numbered steps, expected results and one follow-up question, with no invented controls. Basic reading, spelling and report guides derive from the existing PlaySmart catalog. Published owner guides support all three products. Missing product knowledge produces a request for the current screen; an AI outage uses available guides instead of repeating the welcome menu.

## Verification and release

- 61 unit tests and syntax/generated-admin checks pass.
- Actual workerd/SQLite persistence smoke and attachment runtime tests pass with synthetic provider fixtures.
- Bundled Chrome desktop/mobile smoke passes, including guide publication and attachment failure diagnostics.
- `git diff --check` passes.
- Private read-only preflight snapshot: `.artifacts/production-backups/2026-09-23T09-56-41-448Z/`. Four case mirrors were parseable; no remote data was changed. This is a KV mirror snapshot, not an atomic coordinator backup.

Deployment uses the existing reviewed production configuration and same coordinator, keeping bootstrap disabled. The deployment wrapper requires explicit owner approval. After deployment, verify a real screenshot, a voice note and a published guide question, checking both the customer reply and Operations. No live test message is sent automatically.
