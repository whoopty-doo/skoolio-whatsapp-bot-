# Knowledge audit and implementation decision

Audit: 23 September 2026, before the KnowledgeService refactor.

## Existing mechanism

`knowledge.js` implements the legacy `searchKnowledge(query, category, limit)` export and an existing `KnowledgeService.retrieve(query, options)` abstraction. Both search the same eighteen hard-coded PlaySmart records with keyword overlap. The module includes product-specific subclasses. Several records contain implementation details (database schema, token validation, backend architecture) that should not be customer support material.

`worker.js` already calls ProductRouter, then KnowledgeService. ProductRouter recognizes explicit product names/aliases, otherwise uses saved conversation product, and asks for clarification on missing or conflicting products. Selected titles/content are included as untrusted data in OpenAI Responses instructions. Eight sanitized conversation turns and the existing provider conversation mapping supply memory.

`support-guidance.js` adds three hard-coded PlaySmart guides and fallback answers. `support-guides.js` stores owner-authored, publishable guides under `support-guide:*` in the same coordinator as cases. The existing dashboard editor and API remain; they are not a separate retrieval engine.

Other knowledge files found: older `knowledge.js` copies in `super-admin/reviews/unified-admin` and `super-admin/reviews/tenant-admin`. These are review checkouts, not independent authoritative knowledge collections. The chatbot `data` directory has no discoverable knowledge documents. Searches including ignored files found no generated `support_knowledge` documents in the three supplied workspace roots. The owner subsequently requested creation of the initial collection so it can be expanded later. The source-reviewed seed fulfills that request; no generated collection was silently omitted.

## Source collections

- PlaySmart: read-only source review at `c045a589d8274f52d5a12512d9f8c44587d4c396`. In-app dashboard help, spelling controller/screens, reading screen, mobile lesson documentation and home-lesson workflow provide a small curated seed. Another agent's uncommitted app/build changes are preserved. No PlaySmart files are modified.
- ReadSmart: no verified collection or dedicated source found. Keep an empty product collection with explicit coverage gaps. Do not copy PlaySmart behavior.
- Admin: `super-admin/playsmart_admin_console` and `src/routes/tenants.ts` provide source-verifiable access, tenant lookup and configuration behavior. The console calls itself “PlaySmart Admin Console”; matching it to the owner's deployed Skoolio backoffice remains unconfirmed. Public guidance identifies its applicable screen. Privileged configuration material is reserved for future verified centre-admin access. No backend files are modified.

## Design

Refactor the existing KnowledgeService, retain compatibility exports, and replace hard-coded product facts with one JSON document per topic under `support_knowledge/{playsmart,readsmart,skoolio_admin}`. JSON avoids a new Markdown/frontmatter parser dependency and supports structured troubleshooting directly. Shared schema validation checks all required metadata, product-directory consistency, dates, enums, troubleshooting, duplicate IDs and common secrets. Document provenance records source paths, not copied source code.

`knowledge:build` validates and deterministically generates an ES module containing the public, support-safe corpus and precomputed search terms. `knowledge:validate` validates without writing; `knowledge:check` also detects a stale generated asset. Nonpublic documents are excluded from the customer bundle. Collection coverage metadata and safe inventory metadata support the future admin Knowledge view.

`KnowledgeService.search({product,query,conversationContext,limit})` sits in front of a replaceable local retrieval backend. Product and permission filters run before scoring and again on results. Weighted topic/title/keyword matching, query coverage and a relevance floor avoid confident arbitrary matches; previous same-product context is used only for short follow-up requests. Results and total content are bounded. Confidence means lexical match strength, not factual correctness. Future remote/vector engines implement the same candidate search interface and cannot bypass service filtering.

Published owner guides are normalized to the same schema and searched through the same service. Existing `retrieve` and `searchKnowledge` delegate to it. No filesystem, repository mounts, uploads to OpenAI, vector-store creation, secret changes, or deployment occur at runtime/build time.

## Boundaries and risks

- Public support accepts only `PUBLIC_SUPPORT`, `support_safe: true`, and non-internal document types. INTERNAL_SUPPORT is never sent to customer response generation, even with a forged scope. Restricted visibility requires trusted verified identity with exact document/product/customer/centre scope; the WhatsApp entry point supplies no such identity.
- Runtime validation skips malformed or unsafe entries. Build validation fails visibly; it must not silently publish a partial corpus. Common secret/PII detection plus runtime redaction reduces risk but cannot prove arbitrary prose is safe. Human content review remains necessary.
- Retrieved prose, attachments and customer messages remain untrusted data, not model instructions. The response projection excludes repository paths and operational metadata. Structured troubleshooting is presented as questions/safe steps, not raw JSON or a confirmed diagnosis.
- Source review establishes behavior in a checkout, not the installed customer version. Each source document records its review/version. Gaps and unpublished material are explicit, not filled from another product.
- Existing provider conversation history can include prior public answers. Visibility withdrawal prevents future retrieval; it does not erase prior messages or provider history. A future permissions integration must separate/reset provider conversations on identity changes.

## Adding knowledge

Add a schema-valid JSON document in the matching product folder, or use the existing Support guides editor for owner-authored public guidance. Run validation, build, tests and dry-run; publishing a new bundled version remains a separate authorized release. The build never scans raw external repositories or executes document content. See `support_knowledge/README.md` for fields and examples.

Implementation note: the old eighteen-record catalog and three hard-coded guides were replaced, not kept as a parallel source. Unverified technical records were not promoted to public support content. The smaller seed deliberately leaves broader feature coverage for future verified documents.
