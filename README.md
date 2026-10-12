# Skoolio AI Support & Operations

One WhatsApp support interface for **PlaySmart, ReadSmart and Skoolio Admin / backoffice**. The Worker preserves the Twilio webhook, OpenAI integration, Cloudflare Access authentication, existing admin API route, and shared `PS-000001` case series.

## Current implementation

- Explicit product routing with conversation context and clarification when ambiguous. Legacy cases default to `UNKNOWN`.
- Sanitized triage drafts, persistent cases, reporter-scoped follow-ups, pending questions, and status requests.
- A responsive owner workspace with lifecycle metrics, product breakdown, search, filters, pagination, full case details, investigation evidence, notes, and revision-checked updates.
- Customer values rendered as DOM text under a nonce-based Content Security Policy.
- Cloudflare Access JWT signature, issuer, audience, lifetime, and owner allowlist verification. No development admin-auth bypass.
- A single SQLite-backed Durable Object coordinates writes. Each successful request commits case changes, sequence, context, inbound deduplication, audit events, and notification jobs together.
- Existing `support-case:*` records remain mirrored to `NOTES_KV`; the coordinator is authoritative after approved bootstrap. No unsafe KV-only allocation fallback.
- OpenAI conversations recover from creation failures without caching fake provider IDs. Model requests, local drafts, and model output use shared redaction.
- Outbound notification jobs are durable. WhatsApp updates outside the service window require an approved template. Ambiguous provider outcomes stop for review instead of risking duplicate sends.
- Evidence-gated investigation transitions, owner-only approval/release recording, and append-only case audit events.

## Run and verify locally

Use Node **22 or newer** and `npm ci`.

```sh
npm run check
npm test
npm run test:runtime
npm run dev
```

`npm run dev` explicitly uses `wrangler.local.jsonc`, local KV, and a local Durable Object. It does not use the production namespace. Local test messages require a `From` such as `whatsapp:+15550001111` and a unique `MessageSid`. The local configuration intentionally has no live provider credentials.

`npm run test:runtime` uses actual workerd and SQLite-backed Durable Object storage, with synthetic concurrent messages. It creates no remote resources.

`npm run test:browser` first builds the actual Wrangler Worker bundle, then launches local headless Chrome against a synthetic fixture server using that bundled dashboard and checks desktop/mobile rendering, case detail, editing, filtering, operations, and a stored-XSS fixture. Set `CHROME_PATH` for another Chrome installation. Screenshots are written to ignored `.artifacts/`. The fixture server is a test harness, not an authentication bypass in the Worker.

## Deployment status

**The legacy production `wrangler.jsonc` is unchanged. Do not deploy this code with it.** It does not bind the coordinator. Without coordinated persistence, reads can continue but support writes intentionally return 503 rather than risk losing cases.

See [the rollout and recovery procedure](docs/ROLLOUT.md). Production activation requires owner approval, a quiesced migration from the existing KV state, reviewed bindings, and staging checks. `npm run deploy` refuses accidental deployment with missing configuration. No deployment occurs in tests or CI.

## API

- `GET /health`: process health and whether write coordination is configured; not proof of provider health or bootstrap completion.
- `POST /webhook/whatsapp`: Twilio-signed form request; sender and `MessageSid` required.
- `GET /admin`: Access-protected workspace.
- `GET /api/admin/cases`: `{ cases, stats, total, page, limit, filters, statuses, categories }`. Filters: `product`, `status`, `category`, `severity`, `feature_module`, `platform`, `from`, `to`, `q`. `from`/`to` use `YYYY-MM-DD`. Page size is capped at 100.
- `GET /api/admin/cases/PS-000001`: normalized case, including legacy defaults.
- `GET /api/admin/cases/PS-000001/history`: immutable events with cursor pagination. Imported legacy cases only have history that actually existed.
- `PATCH /api/admin/cases/PS-000001`: owner updates require the current integer `revision`; stale edits receive 409.
- `GET /api/admin/operations`: notification summary, attachment queue, safe failure diagnostics, and integration readiness.
- `GET /api/admin/knowledge`: owner-only bundled inventory, product coverage and published-guide metadata; no restricted document bodies.
- `GET /api/admin/guides`: owner-authored guides, including drafts.
- `POST /api/admin/guides`: create/update a product guide; updates require its current revision. Published guides are customer-visible. See [support improvements](docs/SUPPORT-IMPROVEMENTS.md).
- `POST /internal/support-cases/PS-000001`: bearer-authenticated technical updates, also requiring `revision`. This service cannot approve or release fixes.

A technical update can supply `status`, `question`, `technical_investigation: { result, evidence, tests }`, and artifact references. Confirmed bugs require a structured result and evidence. Fix readiness requires a PR URL and validation results. Human approval records the owner identity reference and artifact revision; material artifact changes invalidate approval. The API records lifecycle information; it has **no merge, deployment or release execution code**.

## Product knowledge and identity

`KnowledgeService.search({ product, query, conversationContext, limit })` retrieves from a validated, curated JSON collection under [`support_knowledge/`](support_knowledge/README.md). It replaces the hard-coded catalog; `searchKnowledge` and `retrieve` remain compatibility entry points to the same service. The initial collection contains seven PlaySmart documents, three public admin documents, and one restricted admin document. ReadSmart has explicit coverage gaps instead of copied PlaySmart facts.

Run `npm run knowledge:validate` to check documents and `npm run knowledge:build` to update the bundled index. `npm run check` and release wrappers reject stale output. Public support-safe content is indexed by product using weighted keywords and bounded same-product follow-up context. INTERNAL_SUPPORT and other restricted document bodies are excluded from the customer bundle. The interface permits replacing candidate retrieval with a vector or remote backend while retaining service policy checks.

`/admin` → **Knowledge** shows collection coverage and document metadata alongside the existing public owner-guide editor. Published owner guides use the same retrieval service; old owner-guide records remain compatible. ReadSmart content must be supplied from verified sources. The admin seed applies to the available PlaySmart Admin Console; equivalence to the deployed Skoolio backoffice still needs owner confirmation. See [the audit and design](docs/KNOWLEDGE-AUDIT.md) and [implementation results](docs/KNOWLEDGE-IMPLEMENTATION.md).

Customer and centre fields are present in the case schema. Account linking and authorization cannot be activated until a trusted identity source and its rules are supplied. A WhatsApp number alone is not treated as proof of a customer's permissions.

## Agent boundaries

`CodingAgentRouter` is a policy-only abstraction with no configured repositories or running agents. Legacy arbitrary coding-service HTTP dispatch is removed. No case content can trigger repository access. Product workers, repository mappings, source access, private document ingestion, and real merge/release operations remain disconnected.

The future execution contract is investigation first, evidence before confirmation, a dedicated `ai/bugfix/PS-XXXXXX` branch, appropriate tests/static analysis/build checks, PR, then `FIX_READY` and a stop for human review. Cross-system repository access requires explicit human approval. Agent deployment, production database access, secret changes, protected-branch pushes and self-approval are not supported.

## Privacy and operational limits

Redaction reduces common credential and personal-data exposure; regexes cannot guarantee anonymity for arbitrary prose. Do not solicit student/parent identities, payment details, passwords, or tokens. Reporter WhatsApp identifiers are retained for case communication and visible only to authenticated owners.

Drafts expire after seven days; recent context after thirty; inbound replay records after seven; inbound messaging-window records after one day. Conversation mapping retention is configurable up to thirty days. Resetting a conversation removes the mapping and local context/draft, not support cases or provider-retained conversations. Cases, audit events and notification jobs require a separately approved retention/deletion policy.

Notification states distinguish `PENDING`, `SENDING`, `ACCEPTED`, `BLOCKED`, and `UNCERTAIN`. `ACCEPTED` means Twilio accepted the API request, not confirmed WhatsApp delivery. `SENDING` remaining after a crash and `UNCERTAIN` require manual reconciliation with Twilio; no automatic retry is attempted. `BLOCKED` jobs require configuration correction and operator review. Approved template notifications ask the recipient to reply for case details.

This first coordinator serializes requests across the support platform and scans records for list filtering/statistics. It prioritizes correctness for the existing small case store. Load-test before increasing traffic; per-conversation queues and indexed queries are the next scaling steps. Do not run old KV writers alongside the new coordinator.

## Remote staging

An isolated staging configuration and guarded deployment/test scripts are available. See [staging setup and Access requirements](docs/STAGING.md). Staging uses synthetic signing credentials and cannot send real WhatsApp messages. It is separate from the production migration.

For deployment preparation, `npm run test:cutover` rehearses durable message capture, replay and snapshot recovery in isolated local workerd instances. See the [cutover and recovery procedure](docs/CUTOVER-RECOVERY.md) for the owner-protected controls, staging validation, and remaining production handoff requirements.

The dashboard source lives in `admin-client.js`. Run `npm run build:admin` after editing it; deployment wrappers regenerate `admin-client.generated.js` automatically, and checks reject a stale asset. The browser script is embedded as text so Worker bundling cannot inject runtime helpers into it.
