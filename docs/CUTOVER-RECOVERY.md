# Cutover hold and coordinator recovery

Implemented and tested locally and on isolated remote staging. The successful remote rehearsal is recorded in [STAGING.md](STAGING.md). No production deployment is authorized by this document. The existing production webhook and credentials remain unchanged.

## Verified behaviour

`npm run test:cutover` runs actual local workerd/SQLite with synthetic signed Twilio messages, separate persistent primary/recovery stores, full runtime restarts, and blocked external provider access. It verifies concurrent capture deduplication, persistence across restarts, legacy import/high-water numbering, resumable replay, frozen KV mirrors, checksum rejection, empty-target recovery, resumed alarms, and rebuilt case mirrors. Unit tests additionally inject transaction failure, verify arrival order and Access/origin checks, preserve the real receipt time, and quarantine interrupted sends. No actual WhatsApp delivery is tested or performed.

The initial production configuration now sets `CUTOVER_MODE=hold` and `COORDINATOR_BOOTSTRAP_APPROVED=false`. A fresh coordinator persists the hold setting. In hold:

- Valid signed inbound messages are durably captured before receiving a temporary TwiML acknowledgement. Only sender, SID, sanitized text and receipt metadata are retained. Capture does not require the legacy import to have happened.
- Case/admin/internal mutations return 503; initialized case data remains readable. Notifications, KV mirroring and expiry cleanup pause. Holding a running coordinator waits for its current request/alarm to finish.
- Messages replay one at a time in captured arrival order. Case changes, reply notification and replay checkpoint commit together. Failures leave the message pending. Processed capture entries discard sender/body and are cleaned up after seven days once live.
- Replay replies enter the existing outbox. The original receipt time determines the reply window. Expired replay replies become BLOCKED, even if a generic case-update template exists; a generic template cannot substitute for a clarification question. Provider delivery remains a separate operational check.
- Resume refuses uninitialized storage or pending captures. The explicit persisted live mode survives subsequent deployments with the initial hold variable still present. To hold an initialized coordinator again, use the hold endpoint.

## Access-protected operator API

All routes are below `/api/admin/maintenance`, use existing owner Access authorization, and return no-store responses. Every POST requires `Content-Type: application/json`; browser requests with another Origin are denied. Use same-origin authenticated requests from the owner admin session. Do not share session tokens or paste customer snapshots into chat.

| Method | Suffix | Result |
| --- | --- | --- |
| GET | (none) | Mode, pending capture count, initialization status |
| POST | `/hold` | Pause business writes and alarm work; continue capturing arrivals |
| POST | `/bootstrap` | Import legacy KV only while held and bootstrap is explicitly approved |
| POST | `/replay` | Atomically process the oldest held message; repeat until pending is zero |
| POST | `/resume` | Resume business traffic and alarm work after import/replay |
| GET | `/export` | Export a held coordinator checkpoint plus SHA-256 |
| POST | `/restore` | Restore the exported JSON into an empty held coordinator |

POST actions other than restore accept `{}`. Restore accepts the entire exported JSON object. An export contains private customer data. Save it in a permission-restricted, gitignored backup location. Checksums detect corruption, not who created the snapshot. The supported snapshot limit is 10,000 storage entries / 4 MiB of payload; larger snapshots are rejected and need a paginated recovery implementation.

## Staging rehearsal before production

1. Deploy this code to the isolated staging Worker, keeping its existing Access and synthetic provider secrets. It must never bind to production KV.
2. Use the owner session to hold staging; submit signed synthetic webhook fixtures and verify the pending count. Confirm unsigned requests remain rejected and case mutation is paused.
3. Export the checkpoint privately. Replay synthetic arrivals and confirm unique case IDs, ordered conversations, and zero pending captures before resume. Missing real provider credentials should keep notifications BLOCKED.
4. Rehearse restoring the checkpoint into a separate empty staging coordinator with its own KV, initially held. Restore deliberately rejects populated targets and does not overwrite a running coordinator. Verify original IDs/counts/sequence, pending messages, outbox states, and all rebuilt case mirrors after resuming.
5. Verify authenticated API access and the actual domain/webhook routing behaviour before proposing the production window. Local tests do not prove Cloudflare rollout propagation, old in-flight request drainage, or real Twilio delivery.

## Proposed first production cutover

After explicit owner approval, deploy the reviewed configuration in capture-only hold mode. Preserve the URL, Access settings, remote secrets and KV namespace. Confirm that new signed arrivals are captured and legacy writers (including old in-flight requests, internal callers and admin mutations) have drained. Do not assume a deployment instantly quiesces all old Worker instances.

Refresh and verify the production KV backup only after confirming drainage/visibility. Enable bootstrap approval while retaining the persisted hold, then call bootstrap and verify the legacy counts, descriptions, IDs and high-water mark. Disable bootstrap approval afterward. Replay arrivals, inspect queued/blocked notifications, and resume only after the pending count is zero and owner verification succeeds. A new arrival between the last replay and resume causes resume to refuse safely. Preserve private before/after snapshots.

Messages accepted by the legacy version before the hold boundary may not have a replay ledger in the new store. This implementation cannot retroactively guarantee deduplication of those legacy deliveries. Inspect overlapping SIDs if the provider redelivers across the boundary. A response acknowledgement and an outbox send are also separate transports; do not claim exactly-once delivery.

## Recovery after new coordinator writes

The tested recovery restores the new coordinator format into an isolated empty coordinator. It is not a downgrade to the old Worker. The snapshot includes case data, sequence, contexts, inbound deduplication, notification jobs, capture backlog and mirror work. Restore requeues all case mirrors, forces hold, and changes interrupted SENDING jobs to UNCERTAIN. Never automatically retry those jobs without inspecting provider outcomes.

A snapshot is a recovery point, not a continuously updated replica. The source continues to capture messages after export. **Do not switch traffic to the recovered target from a stale snapshot.** Before any real replacement, verify an ingress handoff/final catch-up procedure that preserves post-export arrivals and prevents both coordinators writing to production KV. That cross-Worker routing handoff has not been implemented or rehearsed. Keep the current coordinator and backups intact until reconciliation is verified.

For code regressions, holding the same coordinator and deploying a compatible correction preserves authoritative storage and avoids a storage handoff. Reverting to the old KV-only Worker after new writes still requires a separate, verified export/reconciliation of cases, sequence and compatible conversation mappings. Do not use a Worker-version rollback as a data rollback.
