# Playable Factory preview

Open `/admin/game-studio`, save and validate a draft, choose **Preview**, then
**Open saved preview**. The existing Flutter player runs inside the page.
**Full screen** expands it. Gameplay remains practice-only and does not publish
learner content or award XP/Moola.

Build the player from a clean PlaySmart checkout using its existing
`tools/factory/build_learning_studio_preview.py --output BUILD_DIR --composer`.
Then run `node scripts/package-factory-player.mjs BUILD_DIR/build/web` to include
the pinned, licensed local emoji fonts. Deploy only that built web directory
under `/factory-preview/`; exclude source maps and service workers. Never upload
source checkouts, credentials or server files as static assets.

The Worker requires a `FACTORY_PREVIEW_ASSETS` assets binding, with
`run_worker_first: true`, `html_handling: none` and `not_found_handling: none`.
The browser loads the player under `/api/admin/game-studio/learning/player/`,
inside the same protected API path as saved drafts. The server maps these requests
to the stored `/factory-preview/` assets and rewrites the HTML base path. Every
player request goes through the existing Super Admin verification before asset serving. Private drafts arrive through the same-origin message bridge.

For a scoped update over a captured live Worker, use
`node scripts/prepare-factory-preview.mjs BASELINE_DIR RELEASE_DIR`. This checks
the expected insertion points and preserves unrelated live code and the private
workspace module. It does not deploy. Validate the actual candidate with
`node scripts/test-factory-player-browser.mjs RELEASE_DIR BUILD_DIR/build/web EVIDENCE_DIR`.
That test uses a loopback server and synthetic admin identity, never production
accounts. It checks Game, Mission and Skill Pack interaction using the real
compiled player; it is not native-app or owner-session acceptance.

The Factory header provides Cloudflare Access sign-out. Player access failures
check the existing catalogue session before suggesting sign-in; recovery opens a
new tab so the current editor stays available.
