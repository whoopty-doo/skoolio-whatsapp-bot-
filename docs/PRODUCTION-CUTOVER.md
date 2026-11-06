# Production cutover plan

## Current execution — 22 September 2026

The owner explicitly authorized production deployment and confirmed they are the only user. This supersedes the planning-only approval gates in the historical notes below. The owner was asked to pause WhatsApp messages and dashboard edits for the migration. The most recent observed webhook completed successfully before this window.

Fresh private backup: `.artifacts/production-backups/2026-09-22T17-57-20-192Z/`. Two cases and one conversation mapping are unchanged; next allocation is PS-000003. All 43 unit tests passed. The actual bundled Worker passed an isolated production activation/import/replay check against this backup, preserving both cases with zero provider calls.

Production activation was verified at `2026-09-22T18:02:05.686Z` and resumed at `2026-09-22T18:02:06.173Z`. Both legacy cases passed checksum verification and the next allocation was PS-000003. The owner confirmed the dashboard is working live.

Final deployment: `21ca5b3d-872f-4cc2-a56a-faaee07833f5`. Temporary `COORDINATOR_BOOTSTRAP_APPROVED` is now false. `CUTOVER_MODE=hold` remains the safe default for an empty coordinator; the existing coordinator's persisted live mode takes precedence, so this setting does not pause it on redeployment. Preserve the `skoolio-support-v1` identity.

Existing secrets and webhook are preserved. The post-deployment backup `.artifacts/production-backups/2026-09-22T18-00-37-947Z/` matches the pre-deployment records. The activation saved a private recovery checkpoint in production KV under `production-activation:checkpoint` and metadata under `production-activation:latest`. No synthetic fixtures were written to production. The checkpoint is the initial migration checkpoint, not a continuously updated backup. Real-data WhatsApp-to-dashboard acceptance testing is next.


## Historical preparation notes (superseded status and permission gates)

Status: prepared for review, **not approved for execution**. No production changes were made while preparing this plan. The current deployed-Worker inventory is recorded below. The remaining pre-window gate is verifying the request-completion evidence available for the active ingress paths.

## Scope and evidence

Upgrade `skoolio-whatsapp-bot` on `ai.skoolio.co.za` using the existing provider secrets, webhook URL, Access configuration and KV namespace. Keep `SUPPORT_COORDINATOR` on the fixed `skoolio-support-v1` identity. Do not attach staging/recovery bindings to production.

The successful staging run is `ebf304875b2e`: authenticated capture, duplicate rejection, ordered replay, isolated restore and alarms passed; both staging mirrors contained 12 matching case IDs. See [STAGING.md](STAGING.md). Production was last verified on version `71e7590a-0f24-4686-aeda-a730090777ae` at `2026-09-22T15:23:44.152Z`. Recheck that version and the configuration immediately before an approved window.

The earlier production backup contained two cases and a next allocation of `PS-000003`. Those numbers are historical evidence, not cutover expectations. Derive the actual expected case IDs, counts and next sequence from a fresh backup after old writes finish.

## Drain evidence required before scheduling

Read-only account inspection at `2026-09-22T16:26:26.696Z` returned two deployed Worker scripts, both inspected without failures. Only `skoolio-whatsapp-bot` currently binds the production KV namespace. It has no scheduled triggers, internal-update secret or coding-agent service URL/secret configured. The deployed internal handler rejects requests when its update secret is absent. The production version remains `71e7590a-0f24-4686-aeda-a730090777ae` at 100%. This narrows the configured application writer paths to the WhatsApp webhook and owner dashboard. The checked-in CI workflow runs checks/tests and has no deployment or data-writing job.

Evidence is saved privately in `.artifacts/cutover-review/writer-inventory.json`. This inspection does not enumerate direct dashboard/REST writes, historical running versions or arbitrary external clients. During the approved window, pause manual KV changes and all owner case edits; investigate any additional writer that is identified rather than assuming it is covered by the Worker inventory.

The next pre-window check is whether the owner can inspect a recent inbound WhatsApp webhook's terminal HTTP response in Twilio. Go to **Monitor > Logs > Messaging**, open an incoming message and inspect **Request Inspector**. Confirm that the configured production endpoint and the HTTP response are visible; record status/timestamp only in the shared review. This verifies access to the evidence source, not drainage at a future cutover. [Twilio messaging logs](https://www.twilio.com/docs/messaging/features/messaging-logs)

No Twilio account-reading connection is available in this session, and Cloudflare secret values cannot be read back. Do not expose a production secret or deploy a secret-export/debug route to obtain access. The owner can inspect the existing Twilio Console session. Before a window, confirm actual applicable webhook settings as well: URL overrides can be superseded by webhook rules, so the documented default timeout is not proof of this account's configuration. [Twilio connection overrides](https://www.twilio.com/docs/usage/webhooks/webhooks-connection-overrides)

The backed-up legacy Worker has external `fetch` calls and no explicit AbortSignal, AbortController or timer-based request cancellation found in its deployed source. It has no coordinator binding or write-lease mechanism. Its route literals include the WhatsApp webhook, admin cases and internal case updates. Presence of a route does not establish that a caller actively uses it.

HTTP Workers do not have a general wall-clock execution deadline while the client remains connected. Cloudflare's documented runtime-update grace period is not a deployment-specific drain guarantee. A CPU budget is not a request-duration bound. [Cloudflare Worker duration limits](https://developers.cloudflare.com/workers/platform/limits/#duration)

KV reads are eventually consistent, including cached missing keys. Changes can take 60 seconds or more to become visible elsewhere. Matching immediate reads do not prove that a late write cannot still arrive. [Cloudflare KV consistency](https://developers.cloudflare.com/kv/concepts/how-kv-works/#consistency)

Before choosing the maintenance window, record each actual writer and the evidence available for its completion:

| Possible writer | Required confirmation |
| --- | --- |
| WhatsApp ingress | Actual webhook configuration and request/response records identifying deliveries overlapping the cutover; account for retries and unresolved deliveries. Do not assume a generic timeout value. |
| Owner dashboard | No outstanding case mutations; pause new edits during the transition. |
| Internal integrations or scripts | Identify callers and outstanding writes, or confirm none are active. Missing legacy secret bindings are evidence to investigate, not proof that no other writer exists. |
| Cloudflare dashboard/API/other Workers | Confirm who can write directly to the production KV namespace and pause those writes. |

Select an observable completion method for all known in-flight writes and verify its coverage before deployment. Quiet sampled logs, a healthy `/health`, a 100% version assignment, two matching KV exports, or a fixed waiting period are not sufficient by themselves. If complete coverage cannot be established, an additional migration bridge/drain mechanism or provider-assisted request reconciliation is needed; it must be implemented and rehearsed before the window. Do not start a production hold with an open-ended plan to figure this out afterward.

## Explicit approval scope

Once the gate above is resolved, agree a maintenance window in Africa/Johannesburg time and a person available to verify an owner-initiated WhatsApp canary. Approval must cover deploying capture-only mode, importing legacy cases, replaying real held messages, and resuming normal customer/owner notification delivery. Existing authorization to prepare or test staging does not cover these production actions.

Inform the owner of the observed limitations before approval: internal technical updates remain disabled without `CASE_STATUS_UPDATE_SECRET`; notifications outside the messaging window are blocked without the approved template; replay replies outside their session window are also blocked. Do not copy staging credentials or synthetic fixtures into production. No outbound canary is sent automatically by the operator.

## Execution checkpoints

Use one operator. Keep a private evidence record with timestamps, source/deployed version, writer-completion records, backup hashes, case IDs/counts/sequence, capture counts and each API outcome. Never include secrets, JWTs or customer message bodies in the public report.

| Phase | Action | Evidence required to advance | Failure action |
| --- | --- | --- | --- |
| 0. Preflight | Verify current deployment/bindings, owner Access, exact webhook URL, approved scope and writer inventory. Save a fresh preliminary backup. | All pre-window gates met; provider secrets preserved; no staging resources bound. | Cancel before changing production. |
| 1. Capture | Deploy `wrangler.production.reviewed.json` with `CUTOVER_MODE=hold` and `COORDINATOR_BOOTSTRAP_APPROVED=false`, retaining remote variables. | Owner maintenance status is held/uninitialized; approved inbound message is durably captured; unsigned requests fail; case changes are paused. | Preserve captured messages. Repair capture/authentication before considering any import or replay. |
| 2. Drain | Verify old-version writes have finished using the completion method agreed before the window. Account for every alternate writer and overlapping/retried webhook SID. | Recorded terminal outcomes and no remaining old writer capable of mutating KV. | Keep capture active and import disabled; escalate against the agreed stop deadline. A time limit expiring is not permission to import. |
| 3. Snapshot | Export legacy KV again after drainage and verify its completeness/visibility against the known writes. Reconcile any differences. | Final source manifest, hashes, original case ID set and sequence high-water mark agree with the writer records. | Do not bootstrap; investigate the mismatch. |
| 4. Import | Retain the persisted hold, temporarily enable bootstrap approval, then call the protected bootstrap endpoint. | Export the held coordinator; compare original case IDs, normalized descriptions/timestamps, mappings and sequence with the final source snapshot. No incoming backlog processed yet. | Keep hold; preserve both source and coordinator snapshots. An initialized coordinator will not automatically re-import corrected KV. |
| 5. Lock import | Disable bootstrap approval while preserving the same binding, class and coordinator identity. | Status still held and initialized; original records remain present. | Correct configuration while retaining storage. Do not create another writer. |
| 6. Replay | Replay one captured message per request, preserving arrival order. Export a checkpoint when the backlog drains. | No pending captures; no duplicate allocation; original IDs preserved; new case sequence continues from the fresh high-water mark; notification jobs reviewed. | Keep hold and inspect the failed request. Successfully committed earlier replays remain committed. |
| 7. Resume | Invoke resume. If a new arrival caused refusal, replay it and retry. | Mode live, zero pending backlog at the transition, original plus new cases visible. | Keep or re-enter hold; do not bypass the pending-message check. |
| 8. Observe | Owner sends an agreed real message and verifies the reply/follow-up. Check alarms, mirrors and queued notification outcomes. | Actual owner-observed reply, expected case association, matching case mirrors/sequence, and no unexplained SENDING/UNCERTAIN or failed jobs. | Hold the same coordinator and repair the cause. Never blindly retry uncertain sends. |

No elapsed time alone advances a checkpoint. The operator must have authenticated access to the production maintenance API before starting; the staging-only rehearsal page cannot operate production.

## Operator API reference

All requests use the existing owner Access session on `https://ai.skoolio.co.za`. POSTs require JSON and same-origin browser requests. Do not paste authentication tokens into chat or shell history.

- `GET /api/admin/maintenance`: mode, pending capture count, initialized state.
- `POST /api/admin/maintenance/bootstrap`: import while held and explicitly approved.
- `GET /api/admin/maintenance/export`: private, checksum-verified checkpoint.
- `POST /api/admin/maintenance/replay`: one oldest pending message.
- `POST /api/admin/maintenance/resume`: refuses if uninitialized or captures remain.
- `POST /api/admin/maintenance/hold`: pause the initialized coordinator again.
- `GET /api/admin/operations`: notification outcomes.

The existing guarded deployment wrapper requires the reviewed JSON and owner-approval flag and preserves remote variables. The flag is an accidental-deployment guard, not evidence that approval occurred. Do not run it during preparation.

## Recovery selected for this cutover

For a recoverable code/configuration error, hold and repair **the same coordinator**, preserving its authoritative cases, replay checkpoints and pending captures. This avoids moving traffic to a stale copy. Once initialized, changing `CUTOVER_MODE` in configuration does not override persisted live mode; use the protected hold endpoint. If that endpoint is broken, restore a compatible handler/configuration on the same binding and invoke hold before further processing.

Do not roll back to the old KV-only Worker after coordinator writes. Mirrored KV may be behind and lacks the complete replay/outbox state. Before any reversion even in the capture-only phase, account for messages already acknowledged into the hold queue.

The independently tested snapshot restore is a disaster-recovery capability, not the default cutover rollback. Replacing a coordinator requires a separately verified handoff for messages arriving after the snapshot and protection against two active writers. That handoff is not implemented; this plan does not authorize switching production to an isolated recovery copy. If in-place repair cannot preserve state, remain held and use a separately approved recovery procedure.

## Current release decision

**Do not deploy yet.** The configured-Worker inventory is complete within the stated scope. Verify access to the Twilio completion records and establish the cutover reconciliation method next. Then finalize the owner-approved window and operator access method. Staging results validate the new storage and replay flow; they do not establish that legacy production requests have finished.
