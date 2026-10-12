# KnowledgeService implementation results

## Production deployment — 23 September 2026

After the local-only implementation was completed, the owner explicitly authorised deployment to test through WhatsApp. Deployed using the reviewed production configuration and `--keep-vars`, retaining the same coordinator and KV namespace, with bootstrap disabled.

- Production version: `6a0f3b0a-3146-4250-828f-64d0b92d93eb`.
- Knowledge version: `060a84128969fa69`.
- Fresh pre-deployment private snapshot: `.artifacts/production-backups/2026-09-23T10-29-11-844Z/` (four case mirrors; read-only KV snapshot, not an atomic coordinator export).
- Deployment command completed successfully; Worker startup 5 ms.
- Live `/health`: HTTP 200, `ok`, `aiConfigured`, and `writesConfigured` all true.
- `/admin` and `/api/admin/knowledge`: redirect to Access when unauthenticated.
- No secrets were replaced and no WhatsApp test messages were sent automatically. Owner-sent screenshot and voice-note checks remain necessary to verify real provider behavior.

The local-only statements below describe the earlier implementation phase, before this explicit deployment authorisation.

Completed locally on 23 September 2026. No production/staging deployment, secret changes, provider upload or live customer messages were performed. Existing unrelated workspace changes were preserved. PlaySmart and backend files were inspected read-only.

## Sources connected

| Product | Bundled customer documents | Other documents | Provenance |
| --- | ---: | ---: | --- |
| PLAYSMART | 7 | 0 | Source review at `c045a589d8274f52d5a12512d9f8c44587d4c396`: in-app dashboard guide and dashboard implementation; reading screen; spelling controller and screen; mobile/home-lesson documentation; synchronization service |
| READSMART | 0 | 0 | Explicit empty collection and missing-area metadata; no verified source found |
| SKOOLIO_ADMIN | 3 | 1 restricted | Available admin console screens/router and tenant backend route; public overview, search and access checks; configuration document reserved for future centre-admin scope |

The available admin console identifies itself as PlaySmart Admin Console; source-reviewed guidance explicitly identifies this scope. Source references are metadata, not code shipped to the customer model. No runtime repository connection exists.

## Files created

- `knowledge-schema.js`: shared metadata, visibility, troubleshooting and common-sensitive-content validation.
- `knowledge-index.js`: per-product term postings and lexical candidate ranking.
- `knowledge.generated.js`: deterministic generated public corpus, search terms, coverage and owner inventory metadata.
- `scripts/knowledge-build.mjs`: discovery, schema/duplicate/security validation, deterministic build and freshness checking.
- `support_knowledge/README.md` and `support_knowledge/collections.json`: authoring instructions and collection gaps.
- `support_knowledge/playsmart/guide.reading.json`
- `support_knowledge/playsmart/guide.spelling.json`
- `support_knowledge/playsmart/guide.reports.json`
- `support_knowledge/playsmart/playsmart.dashboard.json`
- `support_knowledge/playsmart/playsmart.home-lessons.json`
- `support_knowledge/playsmart/playsmart.sync-troubleshooting.json`
- `support_knowledge/playsmart/playsmart.spelling-speed.json`
- `support_knowledge/readsmart/README.md`
- `support_knowledge/skoolio_admin/admin.overview.json`
- `support_knowledge/skoolio_admin/admin.tenant-lookup.json`
- `support_knowledge/skoolio_admin/admin.access.json`
- `support_knowledge/skoolio_admin/admin.tenant-settings.json` (restricted; body excluded from bundle)
- `test/knowledge.test.js`: 14 tests covering retrieval, policy, build and webhook integration.
- `docs/KNOWLEDGE-AUDIT.md` and this report.

## Files changed in this phase

- `knowledge.js`: refactored existing service; removed hard-coded product records; kept legacy exports/facades delegating to one backend; bounded results and model projection.
- `worker.js`: integrated `search`, structured troubleshooting on matched issue intake, safe model projection, readiness and Access-protected knowledge inventory API. Existing case allocation, notifications, conversation mapping and Twilio verification remain in place.
- `support-guidance.js`: removed hard-coded guide collection; renders selected retrieved how-to/troubleshooting content when AI is unavailable.
- `support-guides.js`: existing owner store normalized into canonical metadata; compatibility adapter for earlier public owner guides.
- `admin.js`, `admin-client.js`, `admin-client.generated.js`: lightweight Knowledge inventory/coverage view integrated with the existing guide editor.
- `package.json`: `knowledge:validate`, `knowledge:build`, `knowledge:check`; check/predev integration. No new dependency.
- `scripts/deploy.mjs`, `scripts/staging-deploy.mjs`: freshness guard only; neither was used to publish.
- `scripts/browser-smoke.mjs`: knowledge inventory and coverage UI fixture/assertions alongside existing editor regression tests.
- `test/worker.test.js`: existing private-knowledge fixture updated to the required schema and explicit verified product scope; all original assertions retained.
- `README.md`: current knowledge architecture, API and authoring links.

## Retrieval and privacy

The build discovers JSON documents under exactly three product folders, validates required metadata/types/dates, rejects malformed/duplicate documents, rejects symlinks and common credential/PII patterns, and generates a reproducible ES module. Nonpublic bodies and internal document types are not bundled into the customer corpus. Bad runtime documents are skipped without failing the webhook.

`KnowledgeService.search` filters by product, support safety and verified permissions before ranking. The local index uses module/title/keyword/symptom weights, English/Afrikaans aliases, a topic-match condition and query-coverage threshold. Explicit short follow-ups can use the last same-product question; unrelated questions do not borrow stale context. Up to eight results and 10,000 serialized characters are returned; the bot asks for four. Match confidence describes lexical relevance, not factual certainty.

A synchronous or asynchronous replacement backend returns candidate IDs/confidence. Service validation, permission filtering, deduplication and budgets still apply. The model receives selected title/content and safe troubleshooting fields, not repository paths, account scopes, visibility policy or the entire corpus. The public WhatsApp route never constructs a verified customer scope. Internal content is never projected to customer responses.

Published owner guides remain in the existing coordinator and enter this same service. No second knowledge store/retrieval system was added. Public withdrawal prevents future retrieval; it does not erase prior chat/provider history. Common-sensitive-content checks cannot guarantee arbitrary prose contains no private facts; human review remains required.

## Validation results

All checks below completed successfully:

- `npm run knowledge:validate` — 11 valid documents, 10 public.
- `npm run knowledge:build` and `npm run knowledge:check` — deterministic current artifact, version `060a84128969fa69`.
- `npm run check` — knowledge freshness, generated dashboard freshness, Worker/admin JavaScript syntax.
- `npm test` — 75 tests passed, 0 failed (61 existing plus 14 knowledge tests).
- `npm run test:runtime` — actual workerd/SQLite case concurrency, replay, alarms and KV mirrors.
- `npm run test:cutover` — local signed capture, restart, replay, deduplication and snapshot recovery; zero external provider calls.
- `npm run test:staging:runtime` — local isolated staging rehearsal/recovery; zero external provider calls.
- `npm run test:media:runtime` — bundled OGG transcription, screenshot follow-up, replies and deduplication with synthetic providers.
- `npm run test:browser` — bundled Chrome desktop/mobile, Knowledge inventory/gaps, guide publication, existing case actions, failure recovery and XSS fixture.
- `npx wrangler deploy --dry-run` — exit 0, 185.03 KiB uncompressed / 51.17 KiB gzip; “--dry-run: exiting now.” This was the requested default-config bundle check, not a production activation check; the default legacy config still is not the configuration used for a real coordinated deployment.
- `git diff --check` — no whitespace errors.

Remote staging smoke/cutover/browser scripts were not run against the old deployed staging version: doing so would not validate this local code and would require a separately deployed staging build. All existing local unit and runtime suites were run. Flutter/backend tests are not applicable because no source files there changed. No commit, branch, pull request or release was created for this phase.

## Add knowledge later

Add a schema-valid JSON document in the appropriate product folder, then run:

```sh
npm run knowledge:validate
npm run knowledge:build
npm run check
npm test
npx wrangler deploy --dry-run
```

Review documents and generated output together before any separately authorised release. For public owner-authored guides, the existing `/admin` Knowledge editor can publish to the coordinator directly once this code is deployed; it needs no JavaScript rewrite or bundled index rebuild. See `support_knowledge/README.md` for the schema, troubleshooting structure, visibility rules and backend contract.

## NEEDS_OWNER_CONFIRMATION

- Confirm whether the inspected PlaySmart Admin Console is the deployed Skoolio Admin/backoffice you want covered. The seed states its limited applicability rather than asserting equivalence.
- Supply or approve source-reviewed ReadSmart instructions when available. Its collection intentionally returns no invented product behavior.
- Confirm product release/platform coverage before treating source-snapshot guides as instructions for every installed version.

These are content-coverage follow-ups, not blockers to the implemented service/build/tests. This phase does not authorize or perform deployment.
