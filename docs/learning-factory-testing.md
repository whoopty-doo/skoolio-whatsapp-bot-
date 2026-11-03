# Learning Factory authoring workspace — isolated testing

This checkpoint adds one authoring workspace for Games, Skill Packs, Missions,
Worlds and Assets. It is a local test system, not a production release. Existing
Game compiler/runtime and V2 evidence/reporting contracts are reused. Word Power
contains Week 1 only and remains PILOT / NOT YET EDUCATIONALLY APPROVED.

Both authoring modes share saved drafts, validation, exact preview receipts,
review notes, approval, immutable revisions and selection of a prior revision.
Editing clears validation/preview/approval. Published references pin ID, revision
and digest. Tenant authorization is derived from the authenticated actor; shared
references cannot cross tenant boundaries. The new HTTP router uses the existing
Super Admin gate and is not mounted in the production app.

Klik and Nano Banana are explicitly mocked. Klik preserves the current definition
and labels its description with the requested brief; it does not generate a new
curriculum. Nano Banana returns a deterministic small PNG to exercise candidate
review. Provider/model, prompt, requester, tenant and references are recorded.
Neither mock demonstrates live AI quality. Generated artwork cannot become
published without validation, preview, human review and explicit test approval.
No provider secret is present in Flutter or the browser.

The runtime preview uses actual FactoryPlayScreen and LearningFactoryPreview
components. Games run installed engine capabilities; Skill Packs use V2 activity
presentation, BUILD integration and evidence-aware reports. Kid, Parent and Centre
views retain one run; device choices constrain Phone/Tablet/Desktop layouts.
The browser projection has a separate entry point and a preview-only disabled
Google Sign-In plugin, plus bundled licensed fallback fonts. Normal app pubspec,
plugin behavior, bootstrap and packaging are unchanged. This preview is not a
complete native app build, installation or signed release.

The JSON workspace is durable synthetic local state. It does not publish to
Firestore, the live Arcade catalogue or real learners. Entitlement rules are
authored metadata; this task does not activate purchases, subscriptions, tenant
affiliations, XP/Moola or real-account entitlement authority. Preview rewards are
practice-only. The existing app pilot remains gated and disabled for release.

Known limits before broader rollout: educational approval; supported live AI
configuration and quality checks; an explicitly isolated hosted backend; native
platform validation; production catalogue/entitlement integration and release
review. World audio references are reserved metadata in this test workspace; no
new audio upload/playback workflow is implemented. The standalone runtime preview
currently opens English. Existing bilingual game content remains editable.

## Studio source and verification

Run `npm ci`, `node scripts/build-game-studio.mjs`, and `npm test` using the matching
Node 24 toolchain. Generated clients are rebuilt from their JS source. Existing
Game Studio remains available; the Learning Factory embeds its visual editor
through a same-origin message bridge.

Start the backend loopback harness with this checkout. For an isolated browser
acceptance run, start a separate harness on port 8793 without a state-file setting,
then run `node scripts/test-learning-studio-browser.mjs`. It creates its own Chrome
profile, requires a synthetic health response, rejects external gameplay requests
and page/console errors, and removes only its own temporary browser profile.

The Worker route retains the existing admin authentication gate. Its new proxy
fails closed unless ENVIRONMENT is staging and LEARNING_FACTORY_TEST_API_URL is
explicitly configured separately from the normal backend. No such configuration
or deployment was performed. A staging Worker alone is insufficient without an
isolated backend. Do not route this workspace to production for convenience.
