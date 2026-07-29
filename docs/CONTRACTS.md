# Tiny Terrarium Works — Integration Contracts

Authoritative shared interfaces. Any agent needing a change here must report it back for integration, not silently redefine it elsewhere.

## Project layout (file ownership)

```
/package.json, /tsconfig.json, /vite.config.ts, /eslint*, /.prettierrc, /playwright.config.ts, /vitest.config.ts   -> Subagent A owns. NOBODY ELSE edits these directly; report needed deps back instead.
/src/core/        -> A: app bootstrap, error boundary, loading state, dev flag plumbing
/src/sim/         -> A: fixed-step simulation loop, deterministic state, systems
/src/events/      -> A: typed event bus
/src/data/        -> B: data-driven definitions (sprout types, habitats, upgrades, achievements, unlocks)
/src/render/      -> E: Babylon scene, camera, meshes, sprites, particles, drag/drop, picking
/src/input/       -> E: pointer/touch/keyboard input handling
/src/ui/          -> F: onboarding, HUD, build menu, journal, upgrades, achievements, settings, credits, dialogs
/src/audio/       -> F: music/SFX synthesis + playback + volume/mute
/src/persistence/ -> A: IndexedDB save/load, offline calc hook (data-driven values come from B)
/assets/          -> C: original SVG/vector sources + generated textures, organized by category
/tests/unit/      -> owned by whoever writes the system (A for sim, B for progression, F for persistence helpers)
/tests/e2e/       -> G: Playwright specs
/docs/            -> each doc owned by the agent named in the brief; QA docs by D and G
```

## World grid (single shared coordinate model)

Sim owns tile positions; renderer must map through the same function, never invent its own.

```ts
type TileCoord = { x: number; z: number }; // integer logical grid, 16x16 fixed for Phase 1
// src/sim/grid.ts
function tileToWorld(tile: TileCoord): { x: number; y: number; z: number }; // single shared mapping, consumed by E
```
Nursery, habitats, paths, slides, gates all place via `TileCoord`. Automation routing in sim references tiles only — no screen-space math in sim.

## Core string ids (do not rename)

```ts
type SproutTypeId = 'ember' | 'dew' | 'sun' | 'star';
type HabitatId = 'emberNook' | 'dewPond' | 'sunflowerMeadow';
type AutomationId = 'gardenSlide' | 'colourGate';
type UpgradeId =
  | 'podRhythm'
  | 'habitatCapacity'
  | 'gardenSlideSpeed'
  | 'dewdropMultiplier'
  | 'decorativeExpansion1'
  | 'colourGateUnlock';
type AchievementId =
  | 'firstPlacement'
  | 'firstAutomation'
  | 'firstFullHabitat'
  | 'firstRareSprout'
  | 'firstExpansion';
```

## Event bus (src/events/) — typed, one flat union

```ts
type GameEvent =
  | { type: 'sprout:spawned'; sproutId: string; sproutType: SproutTypeId; podId: string }
  | { type: 'sprout:pickedUp'; sproutId: string }
  | { type: 'sprout:dropped'; sproutId: string; overHabitat: HabitatId | null }
  | { type: 'sprout:placed:correct'; sproutId: string; habitatId: HabitatId }
  | { type: 'sprout:placed:incorrect'; sproutId: string; habitatId: HabitatId }
  | { type: 'sprout:settled'; sproutId: string; habitatId: HabitatId }
  | { type: 'habitat:dewdropTick'; habitatId: HabitatId; amount: number }
  | { type: 'habitat:full'; habitatId: HabitatId }
  | { type: 'currency:dewdropsChanged'; total: number; delta: number }
  | { type: 'sprout:transportStarted'; sproutId: string; automationId: AutomationId; instanceId: string; fromTile: TileCoord; toTile: TileCoord }
  | { type: 'sprout:transportCompleted'; sproutId: string; automationId: AutomationId; instanceId: string }
  | { type: 'automation:built'; automationId: AutomationId; instanceId: string }
  | { type: 'automation:unlocked'; automationId: AutomationId }
  | { type: 'upgrade:purchased'; upgradeId: UpgradeId; level: number }
  | { type: 'achievement:unlocked'; achievementId: AchievementId }
  | { type: 'journal:entryDiscovered'; sproutType: SproutTypeId }
  | { type: 'save:loaded'; offlineSeconds: number; offlineDewdrops: number }
  | { type: 'save:written' };
```

Simulation emits events; rendering/audio/UI/achievements subscribe. No system reaches into another system's internal state.

## Simulation boundary

- `src/sim/` has zero imports from `src/render`, `src/ui`, `src/audio`. Enforced by an architecture test (A writes it) that fails the build if violated (grep-based or dependency-cruiser-lite, no heavy tool needed).
- Fixed timestep (suggest 100ms tick) drives sim; renderer interpolates. Sim is pure functions over a serializable state object — this state object IS the save format (versioned).

## Garden Journal count

12 total collection slots. Phase 1 fills 4: ember, dew, sun, star. Remaining 8 shown as locked silhouettes (Phase 2 content, not implemented).

## Data-driven definitions (owned by B, consumed by A/E/F)

Each in `src/data/`, plain typed objects/arrays, no class logic:
- `sproutTypes.ts` — id, displayName, primaryColor, silhouetteKey (asset key), habitatId (correct match), rarity
- `habitats.ts` — id, displayName, baseCapacity, baseDewdropRate, matchSproutType
- `upgrades.ts` — id, cost curve fn or table, effect descriptor, maxLevel
- `achievements.ts` — id, triggerEvent, condition, rewardText
- `unlocks.ts` — thresholds (e.g. gardenSlide unlocks after N correct manual placements)

## Asset manifest (owned by C, consumed by E/F)

`assets/manifest.json` — every asset keyed by a stable string the renderer/UI look up by, e.g.:
```json
{
  "sprout.ember.idle": "assets/sprouts/ember/idle.svg",
  "sprout.ember.walk": "assets/sprouts/ember/walk.svg",
  "sprout.ember.happy": "assets/sprouts/ember/happy.svg",
  "sprout.ember.reveal": "assets/sprouts/ember/reveal.svg",
  "sprout.ember.icon": "assets/sprouts/ember/icon.svg",
  "habitat.emberNook.base": "assets/habitats/emberNook/base.svg",
  "ui.icon.gardenSlide": "assets/ui/icons/gardenSlide.svg"
}
```
Same key pattern for dew/sun/star sprouts, all three habitats, garden slide, colour gate, paths, scenery, particles, UI icons. C delivers SVG source; E rasterizes/loads at runtime. Pipeline: SVG source committed under `assets/`, loaded as Babylon dynamic textures / sprite sheets at runtime — no separate build-time raster step required for Phase 1.

## Audio

Original Web Audio synthesis only (no external license risk). F implements a small synth-based music/SFX module in `src/audio/`. Credits panel still lists it truthfully as "original, synthesized in-repo."

## Dev flag / debug panel

`import.meta.env.DEV` gates the debug panel entirely (component not rendered, module not imported in prod path). Verify absence in `dist/` after `npm run build` at integration time — not just conditional render.

## Save format

Versioned JSON object in IndexedDB, top-level `{ version: number, sim: SimState, meta: { lastSavedAt: number } }`. Any sim state shape change bumps `version`; A owns migration stub (no-op for v1).
