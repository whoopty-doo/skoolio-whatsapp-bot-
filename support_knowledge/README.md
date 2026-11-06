# Curated support knowledge

This is the source of truth for bundled customer-support knowledge. The Worker receives curated documents, never repository access. Start with this small seed collection and extend it after verifying the relevant product behavior.

| Folder | Product | Current coverage |
| --- | --- | --- |
| `playsmart/` | `PLAYSMART` | Dashboard, reading, spelling, reports, home lessons, sync and spelling troubleshooting |
| `readsmart/` | `READSMART` | Intentionally empty pending verified ReadSmart material |
| `skoolio_admin/` | `SKOOLIO_ADMIN` | Source-reviewed admin console overview, tenant search, access troubleshooting; restricted configuration guidance |

The available admin console is branded PlaySmart Admin Console. Its guidance explicitly states that scope; verify its relationship to the deployed Skoolio backoffice before expanding it.

## Add or update a document

1. Create one `.json` file under the correct product folder. Nested topic folders work. README/gap `.md` files are not indexed. Arbitrary formats and symlinks are rejected.
2. Use a unique stable `id`. Fill every required metadata field, including a source reference and review date. Write support-safe prose, not source code, account records, internal endpoints or credentials. Keep instructions tied to the version/screen you checked.
3. Run `npm run knowledge:validate` to catch schema errors, duplicate IDs/content, product-folder mismatches and common secret/PII patterns. Validation fails without rewriting the existing asset.
4. Run `npm run knowledge:build`. This deterministically updates `knowledge.generated.js` and its search index. Review the document and generated diff together.
5. Run `npm run check`, `npm test` and `npx wrangler deploy --dry-run`. These do not publish. Release remains a separate authorised action.

Example (replace the illustrative workflow with verified product instructions):

```json
{
  "id": "readsmart.verified-topic",
  "product": "READSMART",
  "module": "topic",
  "title": "Describe the verified task",
  "content": "State the applicable screen and role. Give short numbered steps and the expected result.",
  "keywords": ["topic", "customer wording"],
  "document_type": "HOW_TO",
  "version": "reviewed-app-version",
  "updated_at": "2026-09-23",
  "source": "Source document or repository-relative path reviewed by the author",
  "visibility": "PUBLIC_SUPPORT",
  "support_safe": true
}
```

Required fields: `id`, `product`, `module`, `title`, `content`, `keywords`, `document_type`, `version`, `updated_at`, `source`, `visibility`, `support_safe`. Content is limited to 6000 characters. Dates must be a real ISO calendar date or UTC timestamp. Unknown fields fail validation to catch misspellings. See `knowledge-schema.js` for exact limits. Do not put examples containing actual personal information into indexed documents.

Document types: `OVERVIEW`, `HOW_TO`, `TROUBLESHOOTING`, `KNOWN_ISSUE`, `FEATURE`, `INSTALLATION`, `RELEASE_NOTE`, `INTERNAL_SUPPORT`.

Visibility: `PUBLIC_SUPPORT`, `AUTHENTICATED_CUSTOMER`, `CENTRE_ADMIN`, `INTERNAL_SUPPORT`. Only public, support-safe, non-internal records enter the customer bundle. Restricted bodies stay in these source files; only their inventory metadata is available to the Access-protected dashboard. Merely choosing a visibility does not activate customer permissions. The public WhatsApp handler does not provide a verified identity scope.

A future trusted identity adapter may retrieve restricted documents through the service using an exact `product`, `allowedDocumentIds`, `customer_reference`, `centre_reference` and verified role. Restricted records need matching account references. INTERNAL_SUPPORT remains unavailable to customer response generation even with a verified scope. Never trust a WhatsApp message claiming to be an administrator.

## Troubleshooting

A `TROUBLESHOOTING` document requires this additional structured object:

```json
{
  "troubleshooting": {
    "symptoms": ["Customer-observable symptom"],
    "questions": ["One useful diagnostic question?"],
    "safe_steps": ["A reversible, source-supported check"],
    "collect_if_unresolved": ["Platform and app version; no learner identity"],
    "escalate_as": "SUSPECTED_BUG"
  }
}
```

Each list has 1–10 entries. Escalation values: `SUSPECTED_BUG`, `CONFIGURATION`, `SYNC`, `HUMAN_ASSISTANCE`. These are hints, not authority to confirm bugs or change case lifecycle. The bot presents selected safe checks and questions, not this JSON. A new matched issue still creates its normal support case and owner notification.

## Existing owner guides and dashboard

`/admin` → **Knowledge** shows the three product collections, document titles, visibility, last-updated dates and gaps. The existing owner guide editor can add/edit/publish public guidance without a code edit or bundled rebuild. Published owner guides are adapted to the same schema and searched by the same KnowledgeService. Old `PUBLIC`/`SUPPORT_GUIDE` owner records remain compatible; drafts are not retrieved. File-based documents are read-only in this initial dashboard.

`GET /api/admin/knowledge` supplies a read-only inventory and collection coverage for future dashboard work. It requires the existing owner Access session and exposes no restricted document bodies. A complex upload/CMS or remote index rebuild is intentionally not implemented.

## Retrieval and replacement backend

```js
const results = await service.search({
  product: 'PLAYSMART',
  query: 'spelling speed does not change',
  conversationContext: { product: 'PLAYSMART', turns: [] },
  limit: 4
});
```

The bundled backend uses per-product term postings with topic/module weights, explicit English/Afrikaans aliases, query-coverage and topic-match thresholds. Only explicit short follow-ups use the last same-product user question. An unrelated question never falls back to stale topic matches. Results include provenance and lexical match confidence, capped at 0.95; this is not factual certainty or an evaluation score. At most eight results and 10,000 serialized characters are returned (the bot requests four). Only the response projection's title, content and safe troubleshooting fields go to OpenAI.

`new KnowledgeService(documents, { backend })` accepts a synchronous or asynchronous candidate backend exposing `search({ product, query, limit, allowedIds })`, returning `{ id, confidence, score? }[]`. The service rechecks the document allowlist, deduplicates and applies response budgets after candidate retrieval. A vector backend can replace candidate ranking without changing the Worker call. The document registry must still be loaded from validated curated content; a backend cannot inject arbitrary documents via its result payload.

`knowledge:check` rejects stale generated output and runs inside `npm run check`. Release wrappers also check freshness. No build command calls providers, executes document content, scans another repository, modifies secrets, or deploys.

## Coverage and review

`collections.json` records missing topics separately from searchable facts. Change `AWAITING_SOURCE` to `SOURCE_REVIEWED_SEED` when verified documents are added to that product; retain remaining gaps. Source review establishes a checkout's behavior, not every installed app version. See `docs/KNOWLEDGE-AUDIT.md` for provenance, prior architecture, privacy boundaries and remaining confirmations.
