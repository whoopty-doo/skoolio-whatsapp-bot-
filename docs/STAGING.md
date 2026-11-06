# Isolated staging environment

Staging Worker: `skoolio-support-staging`

URL: https://skoolio-support-staging.cowleyjared.workers.dev

This Worker has its own `NOTES_KV` namespace (`015fcf45ef6a4f058b8b1b88fb0b0584`) and SQLite Durable Object. It does not read or write the production namespace. Configuration is in `wrangler.staging.json`; the production `wrangler.jsonc` remains unchanged.

## Access configured

The owner created the staging Self-hosted Access application and supplied its Application Audience (AUD). That audience is now configured in `vars.ADMIN_ACCESS_AUDIENCE` and deployed to staging.

Verified protected paths:

- `skoolio-support-staging.cowleyjared.workers.dev/admin` and `/admin/`
- `skoolio-support-staging.cowleyjared.workers.dev/api/admin/cases`
- `skoolio-support-staging.cowleyjared.workers.dev/api/admin/operations`

All four redirect to the existing Cloudflare Access team with the configured staging audience. The Worker also independently checks the JWT and limits owner access to `cowleyjared@gmail.com`. Health remains public, and unsigned webhook requests are rejected with 403 rather than redirected to Access.

Open https://skoolio-support-staging.cowleyjared.workers.dev/admin and sign in as the allowed owner to complete the authenticated browser check. Anonymous redirect verification does not establish that an owner session successfully renders the dashboard. Production Access configuration is unchanged.

## Tests and credentials

Only two independently generated synthetic credentials are uploaded: `TWILIO_AUTH_TOKEN` for signed test requests and `CASE_STATUS_UPDATE_SECRET` for synthetic status updates. Their local copy is `.dev.vars.staging.json`, ignored by Git and created with owner-only permissions. Do not print or share its contents.

No OpenAI key, real Twilio account/sender, owner destination or coding-agent credentials are configured. No WhatsApp messages can be sent from this staging configuration. The deployed webhook can be exercised by the signed HTTP test script; this is not yet a live WhatsApp end-to-end test.

```sh
npm run deploy:staging -- --dry-run
npm run deploy:staging
npm run test:staging
```

Deploying and testing staging are remote actions and require an authorized Cloudflare session. The deploy wrapper checks the Worker name, staging environment, signature validation, separate KV namespace and absence of production domain routes. Synthetic-only secrets are enforced by the wrapper.

The smoke test verifies health, rejection of unauthenticated administration and unsigned messages, product clarification, case creation, replay, follow-ups, pending questions, status retrieval, rejection of technical-service approval, and concurrent unique case IDs. It records synthetic cases with fictitious reporter numbers. Access login is reported separately; a 401 from the Worker is not a successful Access login test.

After the initial staging bootstrap succeeds, set `COORDINATOR_BOOTSTRAP_APPROVED` to `false`. Existing initialized coordinator state continues to work. Keep the staging namespace and cases separate from the approved production migration.

## Next integration step

After authenticated dashboard testing, connect a separately approved Twilio sandbox/test sender and a scoped OpenAI key through Cloudflare secret management. That is a separate change: do not copy production secrets or redirect the live customer webhook. Confirm approved-template delivery and login before considering the production rollout in ROLLOUT.md.

## Deployment verification — 22 September 2026

- Staging deployed successfully to the URL above.
- Remote signed-request smoke checks passed, creating synthetic cases `PS-000001` through `PS-000005`.
- Read-only Cloudflare API verification confirmed all five staging case keys and sequence `5` in the isolated staging KV mirror.
- Initial coordinator bootstrap completed; the staging configuration now disables further bootstrap.
- Staging Access audience deployed in version `0e1afbb3-34ee-474d-9e96-922463ed3790`. Anonymous admin requests redirect to Access with the matching audience. Authenticated browser rendering awaits the owner sign-in check.
- Production Worker, production KV, live webhook, production Access configuration, and live messaging/provider credentials were not changed.

## Dashboard packaging repair

The initial dashboard serialized a JavaScript function with `toString()`. Wrangler's name-preserving bundle inserted references to its `__name` helper inside that function. Those helpers were not included in the browser script, so the deployed dashboard could fail before loading cases even though unbundled fixture tests passed.

The client now lives in `admin-client.js` and is embedded as generated text. Browser checks build the real Wrangler Worker and exercise its authenticated HTML response with synthetic Access credentials locally. Regression coverage includes row opening, history/actions tabs, metric filters, failed-load retry and safe text rendering. The UI also provides explicit Open case buttons and a visible Owner actions / Add note tab. Production remains unchanged.

## Remote cutover and recovery rehearsal

Staging also binds `SUPPORT_RECOVERY` to a separate `StagingRecoveryCoordinator` namespace and `RECOVERY_KV` (`b7ef3be367b2463eaf702d03f3333730`). The recovery class refuses production environments and real provider bindings. Production configurations do not bind it. The deploy wrapper rejects shared primary/recovery KV IDs.

The owner-protected `/api/admin/maintenance/recovery` routes address only this secondary coordinator. Supported suffixes are `/hold`, `/export`, `/restore`, `/replay`, `/resume`, `/cases`, and `/operations`. Origin/JSON requirements match primary maintenance routes. Anonymous requests must still receive an Access login challenge.

The preferred operator flow is to open [the staging rehearsal page](https://skoolio-support-staging.cowleyjared.workers.dev/admin/rehearsal) in an existing owner session and click **Run staging rehearsal**. Keep the page open. A durable run lock prevents concurrent/repeated runs. Reports are stored in a separate coordinator for consistent reads and mirrored to staging KV; synthetic snapshots also remain in staging KV. The page runs only in staging without live provider bindings. Fixtures pass through the real signature-validation handler internally; the separate external smoke test verifies public webhook routing/signatures at the edge.

`node scripts/read-staging-rehearsal.mjs` reads the saved result through the Cloudflare API and saves private local copies after all replay/alarm checks pass. This avoids sharing login tokens or connecting to the owner's browser. `npm run test:staging:runtime` exercises the entire owner-triggered flow in local workerd, including the durable run lock, report storage and alarm finalization.

The optional dedicated-browser flow is `npm run browser:staging-owner` followed by `npm run test:staging:cutover`. It requires login in that exact browser instance; a session in another browser is not shared. Do not run both flows concurrently. Its local connection metadata and synthetic snapshots are private/gitignored. Close the dedicated browser after the rehearsal.

The test requires primary staging to start live with no held backlog and the secondary coordinator to be empty. It holds primary staging, captures three synthetic messages with a duplicate delivery, exports a checkpoint, verifies corrupt/nonempty restore rejection, replays into recovery, verifies primary isolation, and then replays/resumes primary staging. It leaves the recovered coordinator held for inspection. It intentionally refuses a second restore into the populated recovery target; preserve the evidence before planning any reset/new target.

If a check fails after holding staging, the script leaves captured messages safely held and prints that condition. Inspect the owner maintenance API and finish replay before resuming. Never blindly rerun or discard the held backlog. This does not pause production.

Use `node scripts/verify-staging-cutover.mjs <private-report-directory>` after a successful rehearsal for read-only Cloudflare confirmation that both separate KV mirrors contain matching case IDs and no live provider or production KV bindings are configured. A completed script report proves only the checks it records; actual WhatsApp delivery and a production routing handoff remain separate.

### Deployment and verification — maintenance release

- Deployed staging version `43f4373c-3608-4436-ab1d-8a356c5efe03` with the isolated recovery binding and owner-triggered rehearsal page.
- All 42 unit tests passed, including owner/staging-only recovery routing, rejection of real provider bindings, and the complete owner-triggered orchestration. The new flow also passed a real local workerd rehearsal.
- The remote signed-message smoke test passed and created synthetic cases `PS-000006` through `PS-000010`.
- Read-only Cloudflare inspection confirmed separate primary/recovery KV namespaces, neither matching production, and no real Twilio account/sender, owner recipient or OpenAI binding.
- Anonymous requests to maintenance, export and recovery routes redirect to Cloudflare Access.
- The owner-triggered remote rehearsal completed successfully at `2026-09-22T15:22:35.196Z`, run `ebf304875b2e`. Three captured messages (plus an ignored duplicate) produced exactly two new cases, `PS-000011` and `PS-000012`, preserving PlaySmart/ReadSmart conversation routing.
- Corrupt snapshots and restoration over populated storage were rejected. Replaying in the recovery coordinator preserved the main coordinator's cases and pending backlog. Both copies ended with the same 12 case IDs.
- Alarm verification passed. Five synthetic notification jobs are BLOCKED because staging has no real messaging credentials; provider-accepted messages: zero. Primary staging is live with no replay backlog; recovery is held for inspection.
- Read-only Cloudflare verification at `2026-09-22T15:23:10.052Z` confirmed 12 matching case mirrors in each isolated KV namespace, no production KV binding and no live provider bindings.
- Private reports and checksum-verified before/held/after snapshots are in `.artifacts/staging-cutover/server-ebf304875b2e/`. The original dedicated-browser attempt timed out before any maintenance mutation; the successful result came from the owner-triggered page in the existing authenticated session.
