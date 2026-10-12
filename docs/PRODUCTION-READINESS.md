# Production preparation — 22 September 2026

## Latest production update

`4756072a-325a-49db-9790-ef7207cc1e3e` fixes unrelated reports being merged into the last open case. All 53 unit tests passed; bundled routing/media/recovery checks passed. Existing cases and the live coordinator were preserved.

Version `7b00f481-d6a0-46fc-9868-f25e5b631aa8` adds natural-language intake, PS/RS/SA/GS case IDs and queued voice-note/screenshot extraction. Health passed after deployment. See [INTAKE-AND-MEDIA.md](INTAKE-AND-MEDIA.md) for tests, behavior and live media acceptance checks still needed.

## Initial activation — 22 September 2026

The owner explicitly authorized production deployment and confirmed they are the only user. This supersedes the planning-only approval gates in the historical notes below. The owner was asked to pause WhatsApp messages and dashboard edits for the migration. The most recent observed webhook completed successfully before this window.

Fresh private backup: `.artifacts/production-backups/2026-09-22T17-57-20-192Z/`. Two cases and one conversation mapping are unchanged; next allocation is PS-000003. All 43 unit tests passed. The actual bundled Worker passed an isolated production activation/import/replay check against this backup, preserving both cases with zero provider calls.

Production activation was verified at `2026-09-22T18:02:05.686Z` and resumed at `2026-09-22T18:02:06.173Z`. Both legacy cases passed checksum verification and the next allocation was PS-000003. The owner confirmed the dashboard is working live.

Final deployment: `21ca5b3d-872f-4cc2-a56a-faaee07833f5`. Temporary `COORDINATOR_BOOTSTRAP_APPROVED` is now false. `CUTOVER_MODE=hold` remains the safe default for an empty coordinator; the existing coordinator's persisted live mode takes precedence, so this setting does not pause it on redeployment. Preserve the `skoolio-support-v1` identity.

Existing secrets and webhook are preserved. The post-deployment backup `.artifacts/production-backups/2026-09-22T18-00-37-947Z/` matches the pre-deployment records. The activation saved a private recovery checkpoint in production KV under `production-activation:checkpoint` and metadata under `production-activation:latest`. No synthetic fixtures were written to production. The checkpoint is the initial migration checkpoint, not a continuously updated backup. Real-data WhatsApp-to-dashboard acceptance testing is next.


## Historical preparation notes (superseded status and permission gates)

Preparation is complete; production deployment and migration have not been performed. The existing WhatsApp bot is unchanged.

## Verified evidence

- Production Worker: `skoolio-whatsapp-bot`, domain `ai.skoolio.co.za`.
- Existing deployed version: `71e7590a-0f24-4686-aeda-a730090777ae`.
- Private backup: `.artifacts/production-backups/2026-09-22T14-42-48-744Z/`. Files are gitignored and permission-restricted. It includes deployed source, configuration metadata, deployment/routing information, and two complete KV reads.
- Both KV reads matched: two case records, one conversation mapping, sequence 2. One case uses the early camelCase schema; the compatibility adapter now preserves it without rewriting the original record or guessing its product/reporter.
- Snapshot SHA-256: `5b79a6d1aacbb7bcd90e94e991ba2e96783507e4b824d9bf4527ef22d6e23143`.
- A local workerd/SQLite Durable Object rehearsal imported the verified backup, preserved both cases and the conversation mapping, allocated synthetic case `PS-000003`, and handled its replay idempotently. It made zero external provider calls. The private backup directory contains `rehearsal-report.json`.
- All 35 unit tests passed. The reviewed production configuration passed Wrangler's deployment dry-run.

These are live, non-atomic backup reads. Matching passes do not establish that all writers have stopped or that no later messages arrived. Refresh the backup at cutover after quiescing writers.

## Configuration and credentials

`wrangler.production.reviewed.json` retains the production Worker, account, KV namespace, domain, compatibility date, observability, and existing workers.dev settings. It adds the coordinator binding and migration. The guarded deployment command preserves remote variables with `--keep-vars`; configured variables still take precedence. Existing remote secrets are not exported or copied.

Twilio, OpenAI, owner and Access secret bindings are present in production. Presence confirms configuration names, not credential validity. The owner has confirmed the existing bot works.

`CASE_STATUS_UPDATE_SECRET` and `TWILIO_UPDATE_CONTENT_SID` are absent. Internal technical updates remain disabled until their secret is configured. Automated notifications outside the WhatsApp service window remain blocked until an approved template is configured. This limitation must be accepted or resolved before enabling those workflows.

## Cutover is not yet authorized or ready to run

The concrete phase-by-phase plan is [PRODUCTION-CUTOVER.md](PRODUCTION-CUTOVER.md). Its current gate is confirming all legacy writers and an observable way to establish that their outstanding writes have finished. Inspection of the backed-up Worker found no explicit network cancellation deadline, so the plan does not substitute a fixed wait for drainage evidence. Routine recovery keeps the same coordinator held for a compatible repair; switching to a restored copy requires a separate handoff procedure.

The read-only deployed-Worker inventory completed at `2026-09-22T16:26:26.696Z`: only the production bot binds production KV; no production schedules or internal/coding-agent integration credentials are configured. Production remains on the recorded original version. The next external check is access to Twilio's inbound-webhook completion records; direct Cloudflare edits must also stay paused during a future window. Details and evidence limitations are in the cutover plan.

The reviewed configuration sets `COORDINATOR_BOOTSTRAP_APPROVED=false` and now sets `CUTOVER_MODE=hold`. It is a capture-only initial deployment configuration: authenticated inbound messages are saved and acknowledged, but business processing stays paused until the import is approved, verified and replayed. It is not a normal live-serving configuration.

Durable capture/replay and isolated snapshot recovery are now implemented and verified in local workerd, including complete runtime restarts. All 42 unit tests passed. The authenticated remote staging rehearsal also passed: three captured messages plus a duplicate replayed into two unique cases, both isolated stores have 12 matching case mirrors, primary staging resumed, and recovery remains held. No provider messages were accepted. See [STAGING.md](STAGING.md) for the recorded run and [CUTOVER-RECOVERY.md](CUTOVER-RECOVERY.md) for the protected operator API. Actual legacy production request drainage, real provider delivery and cross-Worker recovery handoff remain unverified. Do not rely on assumed Twilio retries or simply turn off the webhook.

Once the pre-window gates are resolved, obtain owner approval for the concrete maintenance window and follow [PRODUCTION-CUTOVER.md](PRODUCTION-CUTOVER.md): deploy capture-only with bootstrap disabled, verify legacy drainage, refresh the verified backup/high-water mark, temporarily enable bootstrap while held, validate the import, disable bootstrap, replay and reopen traffic. Preserve the current webhook URL and provider secrets.

## Recovery boundary

The recorded Worker version and source backup support pre-migration recovery, but any newly captured messages must also be retained/replayed. After coordinator writes, a Worker-only rollback is unsafe. The new checksum-verified export/restore path recovers into an isolated empty coordinator and quarantines interrupted sends; it is not a KV-only downgrade. A production routing handoff must account for arrivals after the snapshot. Legacy-schema reconciliation for a downgrade remains unimplemented.

Keep backups private; they contain customer data even though this report does not.
