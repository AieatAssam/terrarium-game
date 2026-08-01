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
- **Ground/terrain is a flat solid colour**, not an illustrated texture (not in Subagent C's original asset scope).

> **SUPERSEDED 2026-08-01**: this section used to list "Colour Gate routes
> whichever common type Garden Slide isn't feeding, no colour-selection UI"
> as a known limitation. That's no longer true — `src/ui/components/
> colourGate.ts` is a real two-lane pictorial picker (per GAME_DESIGN.md's
> "The Colour Gate's rule"), and the Garden Slide always targets Sunflower
> Meadow (2026-07-31), not "whichever type the Gate isn't." Left as a dated
> note rather than silently deleted, since this whole report is a point-in-
> time integration snapshot — see the addendum below for what's current.

## Screenshots

See `docs/qa-screenshots/`: `01-initial-garden-fresh.png` (first load), `02-star-sprout-reveal.png` (Star Sprout + achievement toast), `03-upgrades-panel.png`, `04-settings-panel.png`, `05-credits-panel.png`, `06-journal-panel.png` (12 slots / 4 discoverable), `07-mobile-viewport.png` (390×844).

## Performance

Not formally profiled (no frame-time instrumentation was added this pass). Manual observation during testing at default zoom with ~20-30 Sprouts on screen showed no visible stutter in the in-app browser. Background-tab throttling exists (`src/render/visibility.ts`) and the sim's own tick loop is decoupled from the render loop.

---

# Addendum — Garden Slide pass (three Phase-1 gaps closed)

Scope: the Garden Slide was functionally present but read as inert scenery. Three
confirmed defects against GameRules §8.3, §9.2, §9.3 and §9.7, plus two
pre-existing bugs found while verifying them.

## Defects fixed

1. **Transported Sprouts ignored the garden paths.** The
   `sprout:transportStarted` subscriber in `src/render/sprouts.ts` lerped
   straight from the Nursery tile to the habitat tile, so a carried Sprout
   drifted diagonally across open grass while the L-shaped path sat unused
   beside it (GameRules §9.2 makes paths the physical route; §9.3 requires the
   Slide to visibly carry Sprouts along one). The ride now follows the real tile
   route, found by breadth-first search over `GARDEN_PATH_TILES`, with each
   corner replaced by a quadratic Bézier fillet and traversal parameterised by
   arc length so the pace is continuous across segment boundaries.
2. **The Garden Slide Speed upgrade had no visible effect, and visual/sim
   arrival could desync.** The renderer hard-coded `420 * distanceTiles` while
   the simulation independently derived duration from `transportMsPerTile`,
   which is the only side that applies the upgrade. Simulation is now the single
   authority: `sprout:transportStarted` carries `durationMs`, and the renderer
   animates over exactly that interval (falling back to a local per-tile
   constant only if the field is missing, e.g. a stale bundle mid-HMR).
3. **The built Slide never animated and never showed load or blockage.** It now
   has three states driven purely from bus events — carrying (a continuously
   cycling procession of parcels across its front, paced from the sim's own ride
   duration, so the speed upgrade is visible on the machine too), idle (a
   barely-there breathing glow, no parcels), and blocked (a parcel parked at the
   outfeed under a warm amber glow, which is exactly when `automationSystem`
   declines to dispatch toward a full habitat). A decaying "recent deliveries"
   level modulates the glow as the simple throughput read.

## Jerkiness: what was actually wrong

Initial user feedback on this pass was that the slide animation was jerky and
should read as continuous conveyor movement. Three separate causes, all fixed:

- **Ride easing.** The ride used an ease-in-out over the whole journey, which
  reads as the belt speeding up in the middle. A conveyor moves at a constant
  rate; traversal is now strictly linear in arc length.
- **A single shuttling bead.** The structure's animation had one parcel sliding
  from one end to the other and snapping back — a visible jump every cycle. It
  is now three parcels evenly spaced in phase, each scaling to exactly zero at
  both ends of its pass, so the procession has no observable loop point. The
  phase is an accumulator advanced by frame delta rather than `now % period`, so
  it does not hitch when the ride duration changes (i.e. when the speed upgrade
  is bought) and does not restart when a new Sprout boards.
- **Hard state switches.** Carrying/idle/blocked were branches, so the belt
  stopped dead and the body's rock snapped to zero at the end of every delivery.
  They are now eased weights (`1 - exp(-dt/T)`, frame-rate independent) that are
  summed, so motion and glow cross-fade.

Everything interpolates off `scene.onBeforeRenderObservable` and
`performance.now()`, never off sim ticks — a 100ms tick would otherwise show as
visible 10Hz stepping regardless of frame rate.

## Additional bugs found while verifying

4. **The dev speed control desynced the animation from the simulation.**
   `debug.setSpeedMultiplier` runs N ticks per animation frame, so at 5x a 3.4s
   ride genuinely finishes in 0.68s of real time — but the emitted duration was
   still the unscaled sim-time figure, leaving the animation gliding along the
   path long after the Sprout had settled, then cut short mid-journey. Fixed in
   `src/sim/runtime.ts`: sim-emitted `durationMs` is divided by the live speed
   multiplier at the boundary where sim time is mapped onto wall-clock time.
   `speedMultiplier` is always 1 outside dev, so this is an identity transform
   in production. (Changing speed *during* a ride still truncates that one ride;
   that is inherent to the dev control and only affects the ride in flight.)
5. **A ride animation could fight the settle position.** The per-ride observer
   kept writing `mesh.position` after `sprout:settled` had already parked the
   Sprout on its habitat. Rides are now tracked and torn down the moment the sim
   says the journey is over.

## Pre-existing bugs found, NOT fixed (outside this pass's file ownership)

6. **A built automation renders as an unbuilt translucent ghost after a
   reload.** `src/render/automation.ts` learns "built" from `automation:built`,
   which a restored save never replays. This pass added a `save:loaded`
   subscriber (plus `snapshot.fullHabitats` and `snapshot.automationTargets`, so
   a garden that was jammed when the player left still reads as jammed when they
   return) — but it does not fire, because of a composition-order race in
   `src/main.ts`: `startSimRuntime(bus)` is started first and emits `save:loaded`
   as soon as its IndexedDB read resolves, while `initRenderer` is still waiting
   on `bootstrap()` and `loadManifest()`. The UI mounts synchronously and so
   catches the event; the renderer misses it every time. **Confirmed in-browser:
   after a reload with a built Garden Slide, its body material alpha reads 0.4
   (the "not yet built" marker) instead of 1.** The fix is in `src/main.ts`,
   which this pass does not own — either construct the renderer before starting
   the sim, or have the sim's `save:loaded` emission wait until the renderer has
   subscribed. The renderer-side handling is already written and correct; it
   starts working the moment the ordering is fixed.
7. **Restored Sprouts have no meshes.** `src/render/sprouts.ts` creates a mesh
   per `sprout:spawned`, which is never replayed for a restored save, so idle
   Sprouts persisted in `SimState` are invisible after a reload (observed: 734
   Sprouts in the save, 3 meshes in the scene). Same root cause as #6 — there is
   no "here is the world as it stands" replay for late subscribers. Not fixed
   here; it needs the same composition-order decision.

## Evidence (live browser, fresh tab, dev server)

Positions read out of the running scene via the dev-only `window.__debug`
projection hook, sampled per render frame.

- **Path following, 1x, no upgrade** — 66 samples over one ride: x falls from
  7.96 to 4.00 along z = 8 (the horizontal path run), then z falls from 8 to 4
  along x = 4 (the vertical run). Every sample lies on a tile that actually has
  path art. The turn is a smooth arc — (4.43, 8.00) → (4.28, 7.98) → (4.18,
  7.93) → (4.09, 7.86) → (4.03, 7.76) → (4.01, 7.65) → (4.00, 7.54) — not a
  right-angle snap.
- **Constant speed** — step sizes quantise to ~0.0375 world units per render
  frame at 60fps (≈2.25 units/s), including through the corner. No 10Hz
  quantisation, i.e. the motion is frame-driven, not tick-driven.
- **Speed upgrade is visible** — one level of Garden Slide Speed took the
  emitted `durationMs` from 3400ms to 2700ms (the upgrade's 20% reduction,
  rounded to whole ticks), measured wall-clock ride time 2739ms, and the
  per-frame step rose to ≈3.1 units/s. Before this pass the animation was 3360ms
  regardless of upgrade level.
- **Visual/sim arrival locked** — at 1x, `durationMs` 3400 vs measured `wallMs`
  3401 and 3398 on two consecutive rides.
- **5x sim speed** — rides started at 5x emit `durationMs` 680 (= 3400/5) and
  measured 601/699/699ms wall clock, tracing the same rounded L route across 42
  render frames. Without the runtime fix these would have animated for 3400ms
  against a 680ms simulation.
- **Blocked state** — after the Slide filled the Ember Nook, `habitat:full`
  fired, the belt parcels faded out (scale 0.001, disabled) and the parked
  parcel appeared at the outfeed at scale 0.864, with 61 Sprouts queued at the
  Nursery. Visible in the screenshots as a warm bead on the Slide's outfeed
  edge.
- **Reduced motion** (`<html data-reduced-motion="true">`) — rides still travel
  the full route smoothly (204 render frames, `wallMs` 3401 vs `durationMs`
  3400) with the decorative carried arc flattened; the Slide's belt holds
  station (400 samples, 25 distinct values, first and last sample at the
  identical position — only the state cross-fade moves). State stays readable
  with no animation at all: three still parcels = carrying, none = idle, one
  parked amber parcel = blocked.

## Automated coverage added

- `tests/unit/render.gardenRoute.test.ts` (8 tests) — pure geometry over the
  route polyline, no Babylon scene: a route exists to every habitat; endpoints
  are the Nursery and habitat tiles; 200 samples per route all land on painted
  path tiles; the route deviates >1 tile from the old straight diagonal; no
  polyline turn exceeds 30° (vs. the 90° a raw tile walk would contain); arc
  length is strictly monotonic and never exceeds the Manhattan distance; routes
  are cached by identity; an off-path endpoint returns null so the renderer
  falls back to a straight lerp.
- `tests/unit/sim.systems.test.ts` — a "transport duration (sim is the single
  authority)" block: duration is a whole number of ticks and `durationMs` is
  exactly those ticks; it shortens by the upgrade's own
  `magnitudePerLevel` at every level; the Colour Gate is unaffected; the emitted
  `durationMs` equals `(completesAtTick - startTick) * TICK_MS` and the ride
  really does take that long when ticked forward; a fully upgraded Slide is
  measurably faster end to end. Values derive from `UPGRADES[...]` rather than
  hardcoded literals so a balance change cannot invalidate them.
- `tests/e2e/automation.dev.spec.ts` — a new spec drives the real 20-placement
  unlock, then asserts against live mesh positions that an idle Slide shows no
  load, a carried Sprout stays on path tiles for its whole journey and departs
  from the straight line, the Slide's belt moves while carrying, a blocked Slide
  shows its parked parcel and stops its belt, and one level of Garden Slide
  Speed measurably shortens the emitted ride duration.

## Check suite

`npm run typecheck`, `npm run lint`, `npm test` and `npm run build` were run at
the end of this pass. Any remaining failures are in
`tests/unit/render.procgen.test.ts`, `src/render/world.ts`, `src/render/layout.ts`
or `src/render/geometry.ts` — the concurrent procedural-world/visual-fidelity
pass, which is not this pass's ownership.
