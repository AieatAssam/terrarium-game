# Architecture — Tiny Terrarium Works

This is the as-built architecture, kept in sync with the actual code (not the original design intent — see docs/CONTRACTS.md for the contracts multiple contributors built against, and docs/QA_REPORT.md for where reality diverged from the original plan and why).

## Module boundaries

```
src/core/         bootstrap (engine/scene creation, error boundary, loading state), DEV flag (isDev), shared string ids
src/events/       typed pub/sub bus (EventBus) over the GameEvent union — the ONLY channel simulation uses to talk to everything else
src/sim/          deterministic gameplay: fixed-step loop, gameplay systems, live runtime, tile layout, save-relevant state shape
src/data/         data-driven definitions (sprout types, moods, habitats, upgrades, unlocks, achievements, spawning/offline-progress math) — plain typed tables + pure helper functions, no side effects
src/persistence/  IndexedDB save/load + versioned migration
src/render/       Babylon.js scene: camera, lighting, world geometry, habitats, Sprouts, automation visuals, particles — reacts to bus events, never simulates
src/input/        pointer/touch handling: picking, drag-and-drop, camera pan/zoom — emits `sprout:dropped` onto the bus, nothing else
src/ui/           plain DOM/CSS UI layer: onboarding, HUD, build menu, Journal, Upgrades, Achievements, Settings, Credits, debug panel — mirrors bus events into its own local state store, never reaches into sim internals
src/audio/        Web Audio synthesis (music + SFX) — reacts to bus events
```

**The hard rule, enforced by a test** (`tests/unit/architecture.sim-boundary.test.ts`): nothing under `src/sim/` may import from `src/render`, `src/ui`, `src/audio`, or `src/input`. Simulation is fully testable headless, with no Babylon/DOM/canvas dependency.

## State model

`SimState` (`src/sim/state.ts`) is the single source of gameplay truth: a plain, JSON-serializable object (no classes, no Maps/Sets/functions as fields) covering the tick counter, RNG seed, Dewdrops, every Sprout instance, per-habitat counts/capacity, every automation instance, unlock/upgrade/achievement/journal progress, and small bookkeeping fields (spawn accumulator, per-habitat Dewdrop fraction). `SIM_SHAPE_VERSION` is bumped whenever this shape changes; `src/persistence/save.ts` carries a matching migration in `migrateEnvelope()`. The current version and the exact v1→v2→v3→v4→v5→v6→v7 migration chain are defined in `src/persistence/save.ts` (`CURRENT_SAVE_VERSION`) / `src/sim/state.ts` (`SIM_SHAPE_VERSION`), not duplicated here — this file went stale before by restating them.

`src/ui/uiState.ts` holds a *separate*, UI-only mirror (`UiState`) built purely by reducing over bus events — it never reads `SimState` directly. On a restored save, `save:loaded` carries a `snapshot` of the relevant `SimState` fields specifically so this mirror can hydrate correctly on load (see docs/QA_REPORT.md, finding #8, for why this needed fixing).

## Event model

`src/events/types.ts` defines one flat `GameEvent` union — every state change simulation cares to announce (`sprout:spawned` (carries both `sproutType` and `mood`), `sprout:placed:correct/incorrect`, `sprout:settled`, `sprout:transportStarted/Completed`, `habitat:dewdropTick`, `habitat:full`, `currency:dewdropsChanged`, `automation:unlocked/built`, `automation:colourGateRuleChanged`, `automation:moodBellRuleChanged`, `nursery:rhythmChanged`, `upgrade:purchased`, `achievement:unlocked`, `journal:entryDiscovered`, `save:loaded/written`). `src/events/bus.ts` is a small typed pub/sub (`EventBus`): `subscribe`/`unsubscribe`/`emit`, snapshotting listeners on emit so mid-emit unsubscribes can't affect delivery order.

Inbound player intent (a drop, a purchase) also flows over this same bus/direct-call boundary: `src/input/` emits `sprout:dropped` for `src/sim/runtime.ts` to adjudicate; UI purchase/debug actions call plain functions the runtime exposes (`SimRuntime.purchaseUpgrade`, `SimRuntime.setColourGateLane`, `SimRuntime.getColourGateRule`, `SimRuntime.getUpgradeLockReason`, `SimRuntime.debug.*`) since there's no dedicated "player wants to buy X" event in the union (a gap noted during integration; the plain-function-call path was the pragmatic choice over expanding the union further).

## Simulation loop

`src/sim/loop.ts` is a fixed-step accumulator (100ms tick): feed it a real elapsed frame delta, it returns how many 100ms ticks to run so gameplay never drifts with frame rate (clamped to a max single delta so a backgrounded tab can't produce a huge synchronous tick burst on resume — offline progress is handled separately, see below). `src/sim/tick.ts`'s `runTick` composes an ordered list of pure `SimSystem` functions (`(state) => { state, events }`) and advances the tick counter/RNG exactly once per tick regardless of how many systems ran.

`src/sim/systems.ts` holds the actual gameplay systems, run in this order every tick: `spawnSystem` (pod cadence, respects the podRhythm upgrade, governs the Nursery rhythm that eases the pod off and then rests it while a large queue of Sprouts is unclaimed — Sprouts are never deleted, the cap comes purely from not spawning — and assigns each spawned Sprout its `sproutType` AND `mood` via two independent RNG draws, 2026-08-01), `dewdropSystem` (per-habitat accrual, flushes whole Dewdrop units as they cross 1.0), `unlockSystem` (Garden Slide's auto-unlock once the placement threshold is hit — 2026-08-01: unlocking no longer builds it, see the manual-placement paragraph below), `automationSystem` (advances in-flight transports, starts new ones for whichever automation is free and has an eligible Sprout waiting — now three automations: Garden Slide, Colour Gate, and the Mood Bell, whose `planRide` branch excludes any Sprout the Bell has already claimed from the other two, a real traffic partition rather than a build-order race — see `isMoodBellClaimed`'s doc comment). Two more functions are called directly (not part of the tick composition) for immediate player-intent reactions: `adjudicatePlacement` (a drop) and `purchaseUpgrade` (a purchase, including Colour Gate's and the Mood Bell's own behavioral gates). `checkAchievements` runs after every batch of events, from either source, so achievements react uniformly regardless of what triggered them.

`src/sim/runtime.ts` is the composition root: owns the one live `SimState`, drives the loop via its own `requestAnimationFrame` (deliberately independent of Babylon's render loop), subscribes to `sprout:dropped` for immediate adjudication, exposes `purchaseUpgrade`/`debug.*`/`resetSave`, and owns load (including offline-progress calculation) and periodic autosave.

## World grid and coordinates

`src/sim/layout.ts` (not `src/render/`) owns the canonical tile positions for the Nursery, the three habitats, the three automation sites (Garden Slide, Colour Gate, and the Mood Bell's own decorative spur), and the shared trunk-and-fork path topology (Nursery -> Garden Slide -> Colour Gate, then west/east lanes to the two northern habitats with the separate southern run to Sunflower Meadow), plus the lane->habitat map the Colour Gate routes against. The fork exists so the Gate has something to actually govern: the routes previously shared only the Nursery tile and fanned out immediately, leaving no junction anywhere, and neither automation site even sat on a path — simulation needs these to compute transport distance/duration, and simulation must never import from render, so the positions live on the sim side and `src/render/layout.ts` re-exports them for the renderer's own path/scenery-scatter concerns. `src/sim/grid.ts`'s `tileToWorld()` is the single shared coordinate mapping; the renderer never invents its own screen-space placement.

The Colour Gate's fork physically cannot reach Sunflower Meadow (its two lanes leave from the northern fork; the Meadow sits on the separate southern run) — this made the 2026-07-31 Garden Slide "always target Sunflower Meadow" rule the only way to reach it via automation. **Superseded 2026-08-01 (manual placement, GameRules §9.8, plan.yaml Phase 1):** every automation is now player-PLACED rather than auto-built the instant it unlocks, via the new `placeAutomation` (`src/sim/systems.ts`), constrained to a legal site by `isValidAutomationSite` (`src/sim/layout.ts`: on the path network, not the Nursery/a habitat/another automation's site, and — for the Colour Gate only — a genuine junction, `isJunctionTile`). A placed automation's destination is no longer hardcoded: `nearestReachableHabitat` computes it from the site tile itself — the nearest habitat reachable over the real path network without routing through another automation's site — so wherever the player puts the Garden Slide is what it actually serves. This is also what fixes the structure-vs-route visual incoherence a player reported (the Slide's structure standing north of the Nursery while its forced-Meadow ride went south, never touching it): the player now chooses where it stands, and its destination always matches. `GARDEN_PATH_TILES` and the path-search BFS moved from `src/render/layout.ts` to `src/sim/layout.ts` (as `findPathRoute`) so sim can run this computation without importing render — `src/render/sprouts.ts`'s `gardenRouteBetween` now calls the shared function instead of keeping its own copy. Sunflower Meadow remains reachable by hand-drag exactly as before, independent of where any automation is placed.

**Partially superseded in design 2026-08-02 (Garden Transit, GameRules §9.3/§9.12–§9.17, `plan.yaml` Phase 7).** Phases 7.2–7.8 now provide N-instance configured Slides, explicit derived ports, per-Slide filters/destinations/enabled state, and v7→v8 save hydration. The remaining replacement is staged: Conveyors will replace the fixed path substrate in 7.10, while ride animation, safety, in-world configuration labels, and final material integration remain in 7.9 and 7.11–7.16. The audit below still records the pre-phase assumptions for traceability until 7.16 performs the final document reconciliation.

## Rendering notes

Babylon's `CreateCylinder`/`CreateBox` apply one UV rect across every face by default, which is wrong for the flat, top-down illustrations this game uses throughout (Nursery, habitats, automation sites, scenery). `src/render/flatArt.ts` provides `attachDiscCap`/`attachPlaneCap`: a plain untextured "volume" mesh plus a separate flat disc/plane child mesh carrying the actual texture, whose default UV is already a clean, unwrapped rect. SVG source is rasterized to a Babylon `DynamicTexture` via `<img>` → `<canvas>`, not Babylon's plain `Texture` loader — Chromium's `createImageBitmap` (which Babylon's WebGPU path uses internally) cannot decode SVG, throwing `InvalidStateError`, even though `<img>` decodes the same SVG fine.

## Save format

`src/persistence/save.ts`: a versioned envelope `{ version, sim: SimState, meta: { lastSavedAt } }` in a single IndexedDB object store (`src/persistence/db.ts`, hand-rolled, no `idb` dependency). `loadGame()` runs the persisted envelope through `migrateEnvelope()` (the v1 → v2 → v3 → v4 → v5 → v6 → v7 chain), then `normaliseEnvelope()`, which additively backfills any field missing from an envelope already *labelled* current — a real failure mode, since no migration case ever revisits a current-version envelope, and one written mid-development came back with an empty Colour Gate rule routing nobody. It can add a missing key, never overwrite a saved value. Offline progress is a **separate closed-form calculation** (`src/data/offlineProgress.ts`), not a huge delta fed through the normal tick loop (which would be silently clamped by the loop's max-delta guard) — it estimates Dewdrops earned from the settled-Sprout counts and rates at close time, capped both by elapsed real time (2 hours) and an absolute ceiling (200 Dewdrops).

## Test strategy

- **Unit (Vitest)**: everything under `src/sim/`, `src/data/`, `src/persistence/`, `src/events/`, plus the UI state store and audio graph, is tested headless with no Babylon/DOM dependency beyond what jsdom provides.
- **Architecture**: a dependency-free grep-based test enforces the sim import boundary.
- **Balance coupling**: several values are load-bearing against each other and are covered so a change to one cannot silently break the other — habitat capacity against the Garden Slide's unlock threshold (the Slide was literally unreachable when the threshold exceeded total capacity), and Dewdrop income against the upgrade cost curves. Tests derive these from the data tables rather than hardcoding literals, after a hardcoded rate turned one assertion into "expected 0 to be greater than 0" instead of reporting the regression.
- **End-to-end (Playwright)**: two projects, `dev` (against the Vite dev server, using the dev-only debug panel and console hook to drive real gameplay scenarios against the live sim) and `preview` (against a production build, confirming debug affordances are genuinely absent). See docs/QA_REPORT.md for full coverage details.

---

# Garden Transit audit (plan.yaml Phase 7.1 — 2026-08-02)

Desk audit produced before any Phase 7 code, per plan.yaml 7.1: map every
existing assumption Garden Transit must change, classify each
preserve / generalise / replace, and leave a record from which a reader can
plan 7.2 (save migration) and 7.3 (transit domain model) without re-reading
`src/`. Every claim cites `file:line` against HEAD `52a0c98`. This section is
a snapshot, not a living contract; plan.yaml task 7.16 owns the post-ship
rewrite of the rest of this document.

Design authority for the phase (read before planning 7.2/7.3):
`docs/_scratch/GameRules.md` §9.3 (Garden Transit), §9.12 (cost/refund/caps),
§9.13 (ports/anchors/validity), §9.14 (configuration), §9.15 (route states),
§9.16 (art/readability acceptance), §9.17 (rejected old Slide), §9.9 (Conveyors
= the single buildable route substrate). `plan.yaml` Phase 7 steps 7.2–7.16
own the implementation; this audit only maps the terrain.

### Incremental as-built note — Phase 7.7 (2026-08-02)

The first Garden Slide visual slice is now shipped in `src/render/automation.ts`:
`buildGardenSlideRig` builds the south-entry/north-exit channel from bevelled
segments, a contrasting inset, edge rails, an entry frame, grounded supports,
and an exit lip. Its dimensions and local path live in
`src/render/propDims.ts` (`GARDEN_SLIDE_BASE_BODY`/`GARDEN_SLIDE`) and reuse
the existing wood/stone material families. The rig is parented to each placed
Slide marker and its preview; 7.8 now feeds the same rig from the N-instance
Slide collection and restored save snapshot.

### Incremental as-built note — Phase 7.8 (2026-08-02)

Garden Slides are now a paid, configured N-instance lifecycle rather than the
legacy one-per-automation path. `placeSlide` validates explicit port joins and
the selected destination, `slideAutomationSystem` dispatches one deterministic
ride per enabled Slide, and the runtime exposes configuration/toggle actions.
Accepted kind, destination, enabled state, and idle/in-flight ride fields are
persisted through save version 8, with v7 migration backfilling safe idle
values. The build menu exposes text selects for filter and destination; the
renderer keeps the authored 7.7 silhouette while listening to configured Slide
events. Conveyors, in-world filter labels, route-state safety, and ride
animation remain the later 7.9–7.14 work.

## The two core shapes Phase 7 changes

1. **`AutomationInstance` (src/sim/state.ts:50-70) is currently one-per-
   `AutomationId`.** `placeAutomation` hard-codes the id `\`${automationId}-1\``
   (src/sim/systems.ts:276) and refuses a second instance of the same kind
   outright (src/sim/systems.ts:272). `SimState.automations` is a flat array
   (src/sim/state.ts:82), and the only model precedent for *multiple owned
   instances of one kind* is **`HabitatInstance`** (Phase 2): a kind-keyed
   `id`, kind as a field, tile as a field, `count` derived live — see
   src/sim/state.ts:37-48 and `placeHabitat`'s `\`${habitatId}-${n}\`` id at
   src/sim/systems.ts:348. **7.3 should copy the HabitatInstance pattern for
   Slides/Conveyors, not invent a parallel one.** The Colour Gate and Mood Bell
   stay one-per-garden (plan.yaml 7.2 non_goals) and can remain ordinary
   `AutomationInstance`s.

2. **`GARDEN_PATH_TILES` is a compile-time constant, not state.** Defined as an
   IIFE at src/sim/layout.ts:193-212 from `pathBetween` runs, frozen into
   `PATH_TILE_KEY_SET` at src/sim/layout.ts:218, and consumed by every routing
   and rendering path. Phase 7 replaces it with player-placed Conveyor segments
   in `SimState` (plan.yaml 7.10); 7.2's migration must backfill the fixed
   network into that new state so existing gardens keep their paths. Consumers
   are enumerated in the "replace" table below.

## One-instance-per-automation assumptions (map of what must generalise)

Every place that assumes a `gardenSlide`/`colourGate`/`moodBell` automationId
maps to at most one live instance:

| Where (file:line) | What it assumes | Classification |
|---|---|---|
| src/sim/systems.ts:272 | `placeAutomation` no-ops if any instance of the kind exists | **replace** — multiple Slides per §9.3.1; id counting like `placeHabitat` |
| src/sim/systems.ts:276 | instance id is always `\`${automationId}-1\`` | **replace** — derive next count per kind (see 7.3) |
| src/sim/systems.ts:277 | destination computed once at build time, `nearestReachableHabitat(tile, occupied)` | **generalise** — becomes a player-chosen destination + accepted-kind filter (§9.14); default `Any` / nearest |
| src/sim/systems.ts:284-294 | the built instance carries `fromTile`/`toTile`/`targetHabitatId` fields meaning "the one ride it runs" | **replace** — transit slides need entry/exit ports, accepted kind, enabled flag (see 7.3 shapes) |
| src/sim/systems.ts:517-576 | `planRide` dispatches per `automationId` with kind-specific branches | **generalise** — the gardenSlide branch keys off the instance's config, not the singleton |
| src/sim/systems.ts:618-622 | `transportMsPerTile` applies `gardenSlideSpeed` only when `automationId === 'gardenSlide'` | **generalise** — every owned Slide benefits (§9.3.1, §8.3) |
| src/sim/systems.ts:871-923 | `adjudicateAutomationDrop` finds the instance by `automationId` (`.find(a => a.automationId === automationId)`) | **replace** — must resolve the *specific* site/instance under the pointer (drop target already carries `overAutomation`; needs an instance id too) |
| src/sim/systems.ts:880 | `automations.find(a => a.automationId === automationId)` for the drop | **replace** — same as above |
| src/sim/systems.ts:926-938 | `colourGateBehavioralState` reads the *single* slide's `builtAtTick` + `targetHabitatId` | **generalise** — its "single-habitat feed" condition must survive N slides (aggregate over all built Slides; see plan.yaml 7.4) |
| src/sim/runtime.ts:120-126 | `automationTargetsOf` builds a `Partial<Record<AutomationId, HabitatId>>` (one target per kind) | **replace** — snapshot must carry per-instance config once Slides are N |
| src/sim/runtime.ts:136-140 | `automationSitesOf` builds a `Partial<Record<AutomationId, TileCoord>>` (one site per kind) | **replace** — must carry per-instance sites |
| src/events/types.ts:104-125 | `automation:built` carries `automationId` + single `siteTile` + optional `targetHabitatId` | **generalise** — add instance id + config (accepted kind, enabled, ports) for slides; keep kind for art |
| src/events/types.ts:190-284 | `save:loaded.snapshot` mirrors the singleton shape (`automationTargets`/`automationSites` keyed by kind) | **replace** — snapshot the transit instances array instead |
| src/render/automation.ts:559 | `sites = {} as Record<AutomationId, SiteMarker>` — one visual site per kind | **replace** — one SiteMarker per *instance*; meshes currently built in a loop over `AUTOMATION_SITE_TILES` (src/render/automation.ts:603) and keyed by kind everywhere below it (markBuilt at :822, `sites[e.automationId]` at :882, preview at :1090) |
| src/render/automation.ts:1129-1146 | `nearestBuiltWithin` returns an `AutomationId` (kind), not an instance | **replace** — return instance id; drop adjudication needs the concrete site |
| src/render/automation.ts:1148-1158 | `matchesSprout` checks one target kind per automationId | **generalise** — consult the instance's accepted-kind filter |
| src/ui/uiState.ts:24,32 | `unlockedAutomations: Set<AutomationId>` / `placedAutomations: Set<AutomationId>` | **generalise** — "placed" becomes a per-instance/count concept; unlocked stays per-kind |
| src/ui/components/buildMenu.ts:118-120 | "placeable = unlocked minus already-placed" — one button per kind, gone once placed | **generalise** — Slides offer a button while owned count < cap (4); Conveyors get their own entry (7.11) |
| src/sim/layout.ts:99-103 | `AUTOMATION_SITE_TILES: Record<AutomationId, TileCoord>` — one default site per kind | **generalise** — keep as the list of AutomationIds + fallback, but real sites come from state (already true since Phase 1.2 manual placement) |

## Unlock / threshold path (plan.yaml 7.4 must not break it)

- `src/data/unlocks.ts:40-76` `UNLOCK_THRESHOLDS`: gardenSlide unlocks on
  `requiredCorrectPlacements: 20` (:58); colourGate requires gardenSlide built,
  a `requiredSingleHabitatFeedTicks: 300` (30s) feed window, and an unsorted
  pile of 3 (:63-65); moodBell requires both prior automations built (:73-74).
- `src/sim/systems.ts:247-256` `unlockSystem` flips `gardenSlide` into
  `unlockedAutomations` once the count is reached. 2026-08-01 decoupling: an
  unlock no longer *builds* the instance — the player places it (see the
  comment at src/sim/systems.ts:234-246).
- `src/sim/systems.ts:971-1011` `purchaseUpgrade` applies effects and adds
  `colourGate`/`moodBell` to `unlockedAutomations` only past their behavioral
  gates (:976-981), charging `costForLevel(level+1)` (:986).
- **Classification: generalise, not replace.** The milestone for the *first*
  Slide is unchanged. What 7.4 adds is the Slide *price* (150 Dewdrops for
  slide #1, escalating per owned count, capped at 2400 — GameRules §9.12) and
  per-Slide config; it must keep the existing "earn permission, then pay to
  place" split, and must keep the Colour Gate's behavioral conditions defined
  against a *built* slide (not merely unlocked) — a distinction the codebase
  already enforces (`isMoodBellClaimed` keyed off an actual instance,
  src/sim/systems.ts:484-486).

## Currency paths (deduction + the missing refund)

There is **no refund path today** — nothing in `src/` removes a built
automation or a habitat. 7.4 must introduce one (GameRules §9.12: full refunds;
Slide refunds at the price of slide N at current owned count — which is why the
save must store **no per-instance purchase price**, see plan.yaml 7.2/7.4).

- Deduction sites:
  - `src/sim/systems.ts:342-343` `placeHabitat` checks `state.dewdrops < cost`.
  - `src/sim/systems.ts:358` deducts on commit and emits
    `currency:dewdropsChanged` with negative `delta` (:361).
  - `src/sim/systems.ts:986-989` `purchaseUpgrade` same pattern for upgrades.
  - `src/data/habitats.ts:105-106` `habitatBuildCost` — the one existing
    geometric-cost function (`round5(500 × 1.9^(n-1))`); 7.4's
    `round5(150 × 1.8^(n-1))` capped at 2400 is the same idiom.
  - `src/data/upgrades.ts:60-132` upgrade costs; `colourGateUnlock` flatCost
    700, `moodBellUnlock` flatCost 1500.
- **Classification: generalise.** Reuse `round5`/geometric-curve idiom and the
  "sim is the single source of truth; UI offers, sim re-checks" discipline from
  `placeHabitat`. The refund must be sim-side too, exposed the way
  `purchaseUpgrade`/`setColourGateLane` are (plain function on SimRuntime —
  there is no GameEvent member for "player removed X").

## Save shape and the migration seam (plan.yaml 7.2 — the risky part)

- `CURRENT_SAVE_VERSION = 7` (src/persistence/save.ts:10), matching
  `SIM_SHAPE_VERSION = 7` (src/sim/state.ts:183). Envelope is
  `{ version, sim, meta: { lastSavedAt } }` (src/persistence/save.ts:14-20).
- `migrateEnvelope` (src/persistence/save.ts:78-260) upgrades v1→v7 with
  **explicit cases, never mutating the input envelope in place** (each case
  builds a fresh object and falls through). 7.2 adds the v6→v7 case.
- `normaliseEnvelope` (src/persistence/save.ts:56-67) is the last line of
  defence for saves *labelled* current but missing fields. **It can only add
  missing TOP-LEVEL `SimState` keys — it cannot reach into `automations[]`,
  `sprouts[]`, or `habitats[]`.** This limitation is documented twice
  (src/persistence/save.ts:130-135 for per-sprout `mood`, and :159-162 for
  per-automation `siteTile`), and both were the reason those backfills became
  explicit migration cases. **7.2's Conveyor backfill is an explicit v6→v7
  migration case for the same reason** — `normaliseEnvelope` cannot
  synthesise Conveyor segments or a transit config inside an existing
  `automations[]`.
- The `v4→v5` case (src/persistence/save.ts:151-172) shows the precedent for a
  per-instance backfill: it reconstructed `siteTile` from
  `AUTOMATION_SITE_TILES[automationId]` because every pre-existing instance was
  *provably* at that default. 7.2's Slide conversion has a similar invariant: a
  v6 gardenSlide instance's `targetHabitatId`/`siteTile` are the true
  historical values, so the migrated Transit Slide's destination and site are
  not guesses.
- Offline progress (`src/data/offlineProgress.ts`) reads only settled-Sprout
  counts/rates, not automation state — **preserve untouched**; a shape change
  to `AutomationInstance` doesn't affect it.
- **Classification: generalise (v6→v7 case) + preserve (envelope discipline).**

## Fixed path network consumers (plan.yaml 7.10/7.11 — the replace surface)

`GARDEN_PATH_TILES` (src/sim/layout.ts:193) and its derived `PATH_TILE_KEY_SET`
(:218) are the substrate. Consumers to move onto a state-backed network:

| Consumer | What it uses it for |
|---|---|
| src/sim/layout.ts:235-267 `findPathRoute` | BFS routing; both ends must be on the network (:238). **The seam** — 7.10 makes this read from SimState Conveyors instead of the constant. |
| src/sim/layout.ts:285-295 `nearestReachableHabitat` | site→destination resolution at build time; also the Colour Gate's lane reachability in `planRide` via `nearestReachableHabitatInstance` (src/sim/systems.ts:86-100, uses `findPathRoute`) |
| src/sim/layout.ts:323-330 `isValidAutomationSite` / :342-346 `isValidHabitatSite` | legality checks gated on `PATH_TILE_KEY_SET` |
| src/render/layout.ts:278-312 `GARDEN_PATH_PIECES` | per-tile piece art + conveyor flow directions (drives world.ts chevron animation) |
| src/render/layout.ts:314-323 `RESERVED_TILE_KEYS` / `isReservedTile` | scenery/terrain exclusion zones (:468-473, :488-495) |
| src/render/layout.ts:773, :1071 | path-verge scatter weighting + lantern spacing |
| src/render/sprouts.ts:341, gardenRouteBetween | renderer-side ride animation route |
| tests/unit/sim.layout.test.ts, render.pathPieces.test.ts, render.gardenRoute.test.ts, render.procgen.test.ts, e2e/automation.dev.spec.ts:213, e2e/habitatBuild.dev.spec.ts:30 | pinned identities / path tile assumptions |

## Pinned topology identities (plan.yaml 7.2 must rewrite these carefully)

- **`tests/unit/sim.layout.test.ts`** pins `nearestReachableHabitat` results
  for the fixed network: Nursery→SunflowerMeadow (:51-53), Gate fork→dewPond
  (:55-60), Slide site→SunflowerMeadow (:62-64). These are *facts about the
  current static network*, not laws — 7.2 re-expresses them as properties of
  the default seeded Conveyor network.
- **`tests/unit/sim.colourGate.test.ts:120-121`** pins the exact
  `tileDistance(Nursery, Gate) + tileDistance(Gate, home) == tileDistance(Nursery, home)`
  identity that keeps a Gate ride equal in length to a direct ride. This is a
  *consequence of the network's Manhattan shape* — it must be asserted against
  the default network (7.2), and transport duration must derive from the
  *placed* route length, not from a hardcoded distance (plan.yaml 7.2).
- `tests/unit/render.pathPieces.test.ts:61,81` pins piece counts/length against
  `GARDEN_PATH_TILES`; `render.gardenRoute.test.ts` and `render.procgen.test.ts`
  pin path/scenery layout. **Classification: generalise** — they must keep
  testing the *shape* (piece typing, flow direction, scenery clearance) against
  whatever the default network is, not against the literal tile list.

## Classification summary (what 7.2/7.3 actually touch)

- **Preserve untouched:** the tick system composition (src/sim/systems.ts:1032
  `TICK_SYSTEMS`), `dewdropSystem`, `spawnSystem`, envelope/normalise
  discipline, the sim-boundary test (tests/unit/architecture.sim-boundary.test.ts
  — 7.3's model must stay pure, no Babylon/DOM types), offline progress, the
  Colour Gate + Mood Bell singletons, habitat instance model (already the
  template to copy).
- **Generalise (behaviour kept, shape widened):** unlock thresholds, upgrade
  cost/effect application, `transportMsPerTile`/`transportDuration`,
  `placeAutomation` → count-based N instances, buildMenu/UI "placeable" logic,
  `automation:built`/snapshot events, renderer keying where it can stay kind-
  based (art lookup, lane lamps), and the pinned topology *tests* (as
  properties of the default network).
- **Replace:** the "one instance per automationId" gate + id scheme for Slides,
  per-kind `automationTargets`/`automationSites` snapshot keys, per-kind
  `SiteMarker`/`nearestBuiltWithin`/`matchesSprout` in render, and the fixed
  `GARDEN_PATH_TILES`→Conveyor-in-state switch (7.10) with its 7.2 backfill
  migration. Nothing in this list is art; 7.7/7.9/7.16 own the visual pass.
