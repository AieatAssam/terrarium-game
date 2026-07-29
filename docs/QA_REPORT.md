# QA Report — Tiny Terrarium Works, Phase 1

This report describes only what was actually run and observed during integration, not expected/predicted outcomes.

## Commands run (final state, all green)

```
npm install
npm run typecheck   # tsc --noEmit — clean
npm run lint        # eslint . --max-warnings 0 — clean
npm test            # vitest run — 129 tests / 18 files passed
npm run build       # vite build — succeeds, dist/ contains manifest.json + all 55 SVGs
npm run test:e2e    # playwright test — 21/21 tests passed (dev + preview projects)
```

## Automated test coverage

**Unit (Vitest, 129 tests / 18 files)**: fixed-step sim loop and determinism, event bus semantics, the sim/render/ui/audio architecture boundary, all data-driven progression modules (sprout types, habitats, upgrades, unlocks, achievements, spawning, offline progress), the gameplay systems added during integration (spawn, placement adjudication, Dewdrop accrual, Garden Slide auto-unlock/build, Colour Gate's behavioral purchase gate, achievement checks), persistence save/load and migration, UI preferences, and the UI state store's event-mirroring (including the save-hydration fix below).

**End-to-end (Playwright, 21 tests, two projects)**:
- `dev` project (18 tests) against the Vite dev server: first load with a draggable Sprout within seconds; a real pointer-drag correct placement that earns Dewdrops; a real pointer-drag incorrect placement that recovers gracefully with no fail-state UI; Garden Slide's auto-unlock-and-build at exactly 20 correct placements, targeting the most-fed habitat; Colour Gate's behavioral purchase gate rejecting an early attempt (no charge) and accepting a properly-conditioned one; Journal (12 slots / 4 discoverable), Settings, and Credits panels; full keyboard flow (Tab → focus ring → Enter → panel opens → Escape → panel closes, focus restored); `prefers-reduced-motion` honored while the game remains fully playable; persistence across a real reload via IndexedDB; the debug-only Star Sprout spawn control, confirmed to settle correctly in all three habitats.
- `preview` project (3 tests) against a production build (`vite build && vite preview`): the debug panel and both dev-only globals (`window.__terrariumUIF`, `window.__debug`) are confirmed **absent**; the game still renders and is playable; no console errors.

All 21 pass reliably; two were flaky under 5-way parallel worker CPU contention (WebGL/Babylon is heavy per browser context) and were fixed by widening an overly tight 5-second poll timeout to 20 seconds for a sim-progression check — not an application bug.

## Bugs found and fixed during integration

Several of these were found by the agents who built earlier phases and left as documented findings for the integrator; others surfaced only once the full stack was exercised together. All are fixed and covered by the test suite above unless noted.

1. **SVG textures never rendered at all.** Babylon's WebGPU texture path uses `createImageBitmap()` internally, which throws `InvalidStateError` on SVG blobs in Chromium (confirmed via direct reproduction) even though a plain `<img>` tag decodes the same SVG fine. Fixed by rasterizing via `<img>` → canvas → `DynamicTexture` (`src/render/assets.ts`) instead of handing Babylon's `Texture` constructor a raw SVG URL.
2. **`assets/` was never copied into `dist/`.** Vite only copies its configured `publicDir` (default `public/`); the top-level `assets/` folder was invisible to the production build. Fixed by moving source assets to `public/assets/`.
3. **Manifest key mismatches** between the renderer's scenery/path lookups and the asset manifest's actual keys (e.g. `scenery.rock.1` vs. the real `scenery.rockSmall`/`rockLarge`). Fixed by correcting the renderer's key mapping to the manifest's real key set.
4. **Flat top-down art wrapped/smeared around 3D volumes** (Nursery, habitats, automation sites, scenery) — see docs/ART_QA_REPORT.md for the full writeup and fix (`src/render/flatArt.ts`).
5. **Automation art (400×260) stretched into a square** during rasterization. Fixed by letterboxing instead of forcing a square fit.
6. **No gameplay systems existed at all.** The original phase split assigned data definitions (Subagent B) and a fixed-step sim *shell* (Subagent A) but never assigned anyone to actually wire spawning, placement adjudication, Dewdrop accrual, automation unlock/build/routing, upgrade purchases, or achievement checks into the sim loop. This is a gap in the plan, not a subagent error. Filled in during integration: `src/sim/systems.ts` (pure gameplay logic) and `src/sim/runtime.ts` (composition root: live state, fixed-step loop, immediate reactions to player intent, load/offline-progress/autosave). Replaces a dev-only placeholder (`gameplayStopgap.ts`) a rendering agent had built just to have something to show on screen.
7. **No debug panel existed**, only a bare console hook — the brief requires spawning each Sprout type (incl. Star), granting Dewdrops, speeding simulation, and resetting save data. Added `src/ui/components/debugPanel.ts` plus debug-only `SimRuntime` methods, all `isDev`-gated (confirmed absent from the production build by the `preview` Playwright project).
8. **The UI state store never hydrated from a restored save.** It only ever mirrored live bus events going forward, so `dewdropTotal`/unlocked automations/upgrade levels/achievements/journal entries all read back as fresh defaults immediately after a reload even though the persisted `SimState` was correct (the actual sim continued operating on the correct data — only the UI's *display* of it was wrong until the next live event). Found while writing the persistence Playwright spec. Fixed by extending the `save:loaded` event with a `snapshot` field that `src/ui/uiState.ts` hydrates from silently, without replaying achievement/build toasts for old history.
9. **The Upgrades panel could become perpetually unclickable at a high Dewdrop income rate** (or with the debug speed control). It fully rebuilt its DOM on every single `currency:dewdropsChanged` tick, which at a fast income rate can fire many times per second — fast enough to detach a buy button out from under an in-progress click. Fixed by building rows once and updating only the dynamic text/disabled state in place.
10. **An internal doc filename leaked into player-facing UI copy**: the Colour Gate upgrade's description literally read "...(see docs/GAME_DESIGN.md)". Rewritten in plain player-facing language.
11. **An always-on debug global** (`window.__debug`, a world-to-screen projection helper used during manual QA) was not gated behind the dev flag. Gated behind `isDev`, confirmed absent in the production preview.

## Known limitations (documented scope decisions, not defects)

- **Both automations auto-build; there is no manual "place it in the world" step.** The brief's build-menu language and docs/GAME_DESIGN.md's "unlocks and auto-builds" language were in tension, and a full freeform-placement UI wasn't in scope for this integration pass. Garden Slide auto-builds the instant its 20-placement threshold is hit; Colour Gate auto-builds the instant its behaviorally-gated upgrade purchase succeeds. The build menu component exists and is wired but has no consequential effect when clicked — this is a real UX gap against the brief's original "intuitive build menu, ghost preview, placement" language, called out explicitly rather than silently shipped.
- **Colour Gate routes "whichever common type Garden Slide isn't already feeding" rather than a player-selectable colour picker.** A simplification of the brief's "player selects a colour through obvious pictorial controls" — the underlying routing/unlock logic is real and tested, but there's no colour-selection UI.
- **Ground/terrain is a flat solid colour**, not an illustrated texture (not in Subagent C's original asset scope).

## Screenshots

See `docs/qa-screenshots/`: `01-initial-garden-fresh.png` (first load), `02-star-sprout-reveal.png` (Star Sprout + achievement toast), `03-upgrades-panel.png`, `04-settings-panel.png`, `05-credits-panel.png`, `06-journal-panel.png` (12 slots / 4 discoverable), `07-mobile-viewport.png` (390×844).

## Performance

Not formally profiled (no frame-time instrumentation was added this pass). Manual observation during testing at default zoom with ~20-30 Sprouts on screen showed no visible stutter in the in-app browser. Background-tab throttling exists (`src/render/visibility.ts`) and the sim's own tick loop is decoupled from the render loop.
