# Owner-reviewed rollout

No production deployment, configuration change, migration, notification, or data mutation was performed while building this update.

## Before activation

1. Review the diff and run checks, unit tests, runtime tests, and browser tests. Review the fixture screenshots separately from actual customer records.
2. Establish a staging Worker, its own KV namespace, and a SQLite Durable Object binding named `SUPPORT_COORDINATOR`, class `SupportCoordinator`, with a `new_sqlite_classes` migration. Use synthetic cases; never point local/staging bindings at production KV.
3. Preserve `/admin*` and `/api/admin/*` Cloudflare Access protection. Set `ADMIN_ACCESS_TEAM_DOMAIN`, `ADMIN_ACCESS_AUDIENCE`, and `ADMIN_EMAILS`. Verify unauthenticated, expired, wrong-audience, wrong-issuer, and wrong-email requests fail.
4. Configure Twilio/OpenAI secrets through the existing secret mechanism. Production must set `VALIDATE_TWILIO_SIGNATURE=true`. Confirm the exact webhook URL/signature. Keep the existing account/sender and `OWNER_WHATSAPP_NUMBER`.
5. Configure an approved generic WhatsApp update template via `TWILIO_UPDATE_CONTENT_SID`, with variable `1` containing the case ID. Outside the service window, notifications stay BLOCKED until this is available. Provider acceptance is not delivery confirmation.
6. Review sanitized legacy PlaySmart knowledge. Supply approved ReadSmart/admin documents and trusted identity/repository mappings before activating those integrations. No coding service is connected in this release.

## Controlled production migration

The coordinator becomes the authoritative store, retaining the existing KV keys as mirrors. This is an architectural data transition and needs a dedicated approved maintenance window.

Follow [PRODUCTION-CUTOVER.md](PRODUCTION-CUTOVER.md) for the concrete execution order, pre-window drain evidence, stop conditions and recovery choice. The first production deployment captures messages with bootstrap disabled; bootstrap is enabled only after old writes have finished and the source snapshot is verified.

The locally tested capture/replay and recovery endpoints are documented in [CUTOVER-RECOVERY.md](CUTOVER-RECOVERY.md). Rehearse them on isolated staging before production. Initial `CUTOVER_MODE=hold` allows authenticated arrivals to be retained before bootstrap; it does not establish that older Worker instances have drained.

1. Export and verify a backup of existing KV cases, sequence and conversation mappings. Record the greatest allocated case number. Keep the previously deployed Worker version available.
2. After the pre-window gates and owner approval, deploy capture-only mode with bootstrap disabled. Quiesce legacy writers while the new coordinator durably retains incoming messages. Do not assume a provider will retry every failed request.
3. Wait for the final legacy KV writes to be visible and verify the backup/high-water mark again. An eventually-consistent KV scan while old writers are still active is NOT a safe migration.
4. Temporarily enable `COORDINATOR_BOOTSTRAP_APPROVED=true` in the reviewed production configuration while retaining the persisted hold. Keep the actual KV/coordinator bindings, signature validation, Access, domain routes and owner configuration intact. Do not deploy the local configuration.
5. Call the protected bootstrap endpoint while held to import legacy cases, sequence and conversation mappings. It chooses the maximum of the sequence and all recognized case-key numbers. It deliberately does not import raw old triage drafts. No legacy cases are automatically relabelled PlaySmart.
6. Verify counts, normalized legacy details, original case IDs, high-water mark and next allocation in an approved canary. Bootstrap must complete before reopening traffic. Disable the bootstrap-approval setting afterward; initialized storage is retained.
7. Resume one writer path through this coordinator. Verify reporter follow-ups, owner notifications, approved-template behaviour, KV mirror progress and dashboard updates. Keep real agent/repository execution disabled.

The guarded command is `npm run deploy -- --config <reviewed-production.json> --owner-approved`. This guard prevents an accidental default deployment; it is not a substitute for authorization. No such command should run without explicit owner approval.

## Failure and recovery

- Before any new coordinator writes, rollback can restore the old Worker after verifying the untouched legacy KV state and preserving/replaying any messages already acknowledged by the capture hold.
- After coordinator writes, do not simply redeploy the old Worker: it could allocate from stale KV or discard newer state. Quiesce writers, export authoritative coordinator state, reconcile all case records and the sequence into KV, verify the high-water mark, then perform the approved rollback.
- KV mirror errors remain durably queued and retry through alarms. Coordinator commits remain authoritative even while a mirror is delayed.
- A crash before request commit leaves no partially allocated case/context/outbox changes. A repeated inbound SID returns its committed reply for seven days.
- Outbound delivery cannot be made exactly-once solely by local transactions. Ambiguous requests are marked UNCERTAIN, and interrupted SENDING jobs require a Twilio lookup before retry. Never claim delivery just because the request was accepted.
- Monitor BLOCKED/UNCERTAIN/SENDING notification counts, unhandled request errors, mirror retries, and request latency. The Operations dialog exposes notification counts without exposing recipient details.

## Remaining prerequisites

Trusted customer/centre identity, private-document authorization, approved ReadSmart/admin knowledge, product repository access, investigation workers, Twilio delivery callbacks, operator notification-retry tooling, indexed storage, and retention/deletion operations require further implementation or external configuration. None are represented as live integrations.
