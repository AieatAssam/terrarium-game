# Tiny Terrarium Works — Integration Contracts

Authoritative shared interfaces. Any agent needing a change here must report it back for integration, not silently redefine it elsewhere.

> **GARDEN TRANSIT — shipped 2026-08-03 (GameRules 2026-08-02 revision).**
> The live contract is multiple purchaseable Garden Slides with per-Slide
> Sprout-kind filters, buildable Sprout Conveyor segments, derived connection
> ports, route-state events, and save shape/version 8. The old one-Slide model
> is retained below only where it explains migration history; it is not the
> current runtime contract. GameRules §9.3 and §9.12–§9.17 remain authoritative
> for the player-facing design.

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
/public/assets/   -> C: original SVG/vector sources + generated textures, organized by category (Vite publicDir, served at `/assets/...`; see "Asset manifest" below — NOT a top-level `assets/`, which Vite never copies into `dist/`)
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

`src/sim/layout.ts` owns the authored gameplay tile positions and the garden's
backdrop topology: a shared trunk and Colour Gate fork, a southern run to
Sunflower Meadow, and the Mood Bell spur. The painted path remains the
compatibility route for a garden with no owned Conveyor segments. Once a save
contains player-built Conveyors, `findConveyorRoute` composes those occupied
tiles with the authored path plus the requested endpoints, with deterministic
adjacency BFS. Players can own up to four Slides and an open-ended number of
Conveyor segments; Slide placement and
configuration are separate from unlock permission.

`COLOUR_GATE_LANE_HABITATS` maps each lane to the home it leads to; that mapping
is a fact about the authored fork and is never player-editable (the player
chooses which *kind* each lane invites, not where a lane goes).
`src/render/layout.ts` re-exports the authored backdrop and derives its painted
path tiles from the same four runs. Dynamic Slide/Conveyor artifacts are
rendered from the state-backed transit collections, so the road art and the
active owned route remain separate, explicit layers. `tileDistance(Nursery,
Gate) + tileDistance(Gate, home)` equals
`tileDistance(Nursery, home)` for both northern homes, so travelling *through*
the Gate costs a Sprout nothing.

### Garden Transit ports (Phase 7.5)

Ports are derived attachment points, never saved fields and never inferred from
mesh overlap. The sim contract is:

```ts
type TransitPortKind = 'entry' | 'exit' | 'dock' | 'lane';
type TransitPortFacing = 'north' | 'east' | 'south' | 'west';
type TransitPortCompatibility = 'transit' | 'nursery' | 'habitat' | 'junction';
interface Port {
  ownerId: string;
  kind: TransitPortKind;
  tile: TileCoord;
  facing: TransitPortFacing;
  compatibility: TransitPortCompatibility;
}
```

`src/sim/ports.ts` declares the port sets: the Nursery has one north-facing
outbound dock; each Slide and Conveyor has south-facing entry and north-facing
exit ports; the Colour Gate has a south-facing inbound dock plus west/east lane
outputs; each habitat has one approach dock facing its serving route. The
ordered kind matrix is exhaustive:

```ts
const PORT_KIND_COMPATIBILITY = {
  entry: { entry: false, exit: true, dock: true, lane: true },
  exit:  { entry: true, exit: false, dock: true, lane: false },
  dock:  { entry: true, exit: true, dock: false, lane: true },
  lane:  { entry: true, exit: false, dock: true, lane: false },
};
```

`portsCompatible` additionally requires distinct owners and matching
compatibility roles. `portsJoined` adds opposite facings and orthogonally
adjacent tiles. `hasTransitTileClearance` rejects occupied tiles; physical
footprints and anchor height remain renderer-owned. `src/render/propDims.ts`
resolves a port through `portWorldPosition(port, body)`: the body dimensions
derive its ground-level height and socket inset, while opposite adjacent ports
share the exact half-tile seam within `PORT_ANCHOR_TOLERANCE`.

Transit artifact ids are stable save identifiers: Slides are `slide-1`,
`slide-2`, … in ownership order; Conveyor segments are
`conveyor-<x>-<z>`, unique because a tile can hold only one segment. Ports and
route state are derived from the saved artifact kind and tile; they are not
persisted fields.

### Build-mode transit placement (Phase 7.6)

`SimRuntime.placeSlide` and `placeConveyor` spend the configured build cost and
emit `transit:slideBuilt` or `transit:conveyorBuilt`. `moveSlide` and `moveConveyor` relocate an
existing artifact without charging or refunding and emit
`transit:artifactMoved`; `removeSlide` and `removeConveyor` refund and emit
`transit:artifactRemoved`. Placement and removal persist immediately after a
successful mutation. The build menu and input layer share the same selected
artifact kind, tile-clearance rules, port preview, keyboard placement, and
pointer/touch placement path. Transit positions are compact save snapshot
fields (`slides` and `conveyors`) so UI counts and world markers hydrate after
load.

## Core string ids (do not rename)

```ts
type SproutTypeId = 'ember' | 'dew' | 'sun' | 'star';
type HabitatId = 'emberNook' | 'dewPond' | 'sunflowerMeadow';
/** A second, orthogonal Sprout attribute (GameRules §7.3) — never affects which habitat is correct for a Sprout. */
type MoodId = 'sunny' | 'sleepy';
type AutomationId = 'gardenSlide' | 'colourGate' | 'moodBell';
type TransitArtifactKind = 'gardenSlide' | 'sproutConveyor' | 'colourGate' | 'moodBell';
type UpgradeId =
  | 'podRhythm'
  | 'habitatCapacity'
  | 'gardenSlideSpeed'
  | 'dewdropMultiplier'
  | 'decorativeExpansion1'
  | 'colourGateUnlock'
  | 'moodBellUnlock';
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
  | { type: 'sprout:spawned'; sproutId: string; sproutType: SproutTypeId; mood: MoodId; podId: string }
  | { type: 'sprout:pickedUp'; sproutId: string }
  | { type: 'sprout:dropped'; sproutId: string; overHabitat: HabitatId | null; overHabitatInstance?: string | null; overAutomation?: AutomationId | null }
  | { type: 'sprout:placed:correct'; sproutId: string; habitatId: HabitatId; habitatInstanceId: string }
  | { type: 'sprout:placed:incorrect'; sproutId: string; habitatId: HabitatId; habitatInstanceId: string }
  | { type: 'sprout:settled'; sproutId: string; habitatId: HabitatId; habitatInstanceId: string }
  | { type: 'sprout:automationDeclined'; sproutId: string; automationId: AutomationId; reason: 'notBuilt' | 'busy' | 'noRoute' | 'wrongKind' | 'destinationFull' }
  | { type: 'habitat:dewdropTick'; habitatId: HabitatId; habitatInstanceId: string; amount: number }
  | { type: 'habitat:full'; habitatId: HabitatId; habitatInstanceId: string }
  | { type: 'habitat:built'; habitatId: HabitatId; habitatInstanceId: string; tile: TileCoord; cost: number }
  | { type: 'currency:dewdropsChanged'; total: number; delta: number }
  | { type: 'sprout:transportStarted'; sproutId: string; automationId: AutomationId; instanceId: string; fromTile: TileCoord; toTile: TileCoord; durationMs: number }
  | { type: 'sprout:transportCompleted'; sproutId: string; automationId: AutomationId; instanceId: string }
  | { type: 'sprout:transportReturned'; sproutId: string; automationId: AutomationId; instanceId: string; tile: TileCoord; reason: 'removed' | 'disabled' | 'destinationFull' | 'invalidTarget' | 'saveRepair' }
  | { type: 'automation:built'; automationId: AutomationId; instanceId: string; siteTile: TileCoord; targetHabitatId?: HabitatId }
  | { type: 'transit:slideBuilt'; slide: SlideInstance; entryPort: Port; exitPort: Port }
  | { type: 'transit:slideConfigured'; slide: SlideInstance; entryPort: Port; exitPort: Port }
  | { type: 'transit:conveyorBuilt'; conveyor: ConveyorSegment; entryPort: Port; exitPort: Port }
  | { type: 'transit:artifactMoved'; artifactId: string; artifactKind: 'gardenSlide' | 'sproutConveyor'; tile: TileCoord }
  | { type: 'transit:artifactRemoved'; artifactId: string; artifactKind: 'gardenSlide' | 'sproutConveyor'; refund: number }
  | { type: 'transit:routeStateChanged'; artifactId: string; artifactKind: TransitArtifactKind; state: RouteState }
  | { type: 'automation:unlocked'; automationId: AutomationId }
  | { type: 'automation:colourGateRuleChanged'; lanes: { west: SproutTypeId | null; east: SproutTypeId | null } }
  | { type: 'automation:moodBellRuleChanged'; mood: MoodId }
  | { type: 'nursery:rhythmChanged'; rhythm: 'lively' | 'easing' | 'resting'; waitingCount: number }
  | { type: 'upgrade:purchased'; upgradeId: UpgradeId; level: number }
  | { type: 'achievement:unlocked'; achievementId: AchievementId }
  | { type: 'journal:entryDiscovered'; sproutType: SproutTypeId }
  | { type: 'save:loaded'; offlineSeconds: number; offlineDewdrops: number; snapshot: SaveLoadedSnapshot }
  | { type: 'save:written' };

interface SaveLoadedSnapshot {
  dewdrops: number;
  unlockedAutomations: AutomationId[];
  upgradeLevels: Partial<Record<UpgradeId, number>>;
  unlockedAchievements: AchievementId[];
  journalDiscovered: SproutTypeId[];
  fullHabitatInstances?: string[];
  automationTargets?: Partial<Record<AutomationId, HabitatId>>;
  automationSites?: Partial<Record<AutomationId, TileCoord>>;
  habitatInstances?: { id: string; habitatId: HabitatId; tile: TileCoord; count: number }[];
  sprouts?: { id: string; sproutType: SproutTypeId; mood: MoodId; tile: TileCoord; settled: boolean; habitatId?: HabitatId; habitatInstanceId?: string }[];
  colourGateLanes?: { west: SproutTypeId | null; east: SproutTypeId | null };
  moodBellRule?: MoodId;
  nurseryRhythm?: 'lively' | 'easing' | 'resting';
  waitingSproutCount?: number;
  slides?: { id: string; tile: TileCoord; acceptedKind?: SproutTypeId | 'any'; destination?: HabitatId; enabled?: boolean }[];
  conveyors?: { id: string; tile: TileCoord }[];
}
```

Simulation emits events; rendering/audio/UI/achievements subscribe. No system reaches into another system's internal state.

### Fields added after the original contract (and why)

The union above is the live shape in `src/events/types.ts`. Three members carry
fields the first draft of this document did not, each because something
downstream could not do its job without them. See the doc comments in
`src/events/types.ts` for the long form.

- **`sprout:transportStarted.durationMs`** — how long the ride will actually
  take, in ms, as the *simulation* computed it (`durationTicks * TICK_MS`,
  already including the `gardenSlideSpeed` upgrade). **The renderer must animate
  over exactly this interval and must not derive its own.** Both sides used to
  compute a duration independently from the same 420ms-per-tile constant, but
  only sim applied the speed upgrade — so buying Garden Slide Speed changed when
  a Sprout settled without changing how fast it appeared to travel, and the two
  clocks drifted further apart with every level. GameRules §8.3 requires every
  upgrade to visibly affect the garden. `src/sim/systems.ts`'s exported
  `transportDuration()` is the single place this is derived;
  `tests/unit/sim.systems.test.ts` pins `durationMs` against the sim's own
  `completesAtTick`. Consumers should still tolerate its absence at runtime (a
  stale bundle mid-HMR) by falling back to a per-tile default.
- **`automation:built.targetHabitatId`** — the one habitat this instance
  delivers to, when it has one (Garden Slide). Absent for the Colour Gate, which
  routes each Sprout to its own matching habitat. Optional so older
  emitters/tests still typecheck. The renderer needs it to show a built Slide as
  *blocked* (GameRules §9.7) the moment its destination fills — including before
  the Slide has ever run a delivery, which is exactly the case that carries no
  `sprout:transportStarted` to infer a destination from.
- **`save:loaded.snapshot`** — full restored-state snapshot so UI-side stores can
  hydrate on load rather than only mirroring live events going forward (see
  docs/QA_REPORT.md finding #8). `snapshot.fullHabitatInstances` was added
  alongside `targetHabitatId`: `habitat:full` fires only on the exact tick a habitat
  *reaches* capacity, so after a reload nothing downstream would otherwise know a
  home is already full. It is carried in the snapshot rather than by replaying
  `habitat:full` on load, because replaying it would also replay its SFX and
  celebratory reactions. `snapshot.sprouts` and `snapshot.automationTargets`
  followed for the same reason. `snapshot.colourGateLanes`,
  `snapshot.nurseryRhythm` and `snapshot.waitingSproutCount` are the same pattern
  again for the two members added below — both announce only on *change*, so
  without them a reload would show a Colour Gate with no rule and a
  lively-looking Nursery that is in fact resting under a crowd.

### Members added when the Colour Gate was given a real fork to govern

- **`automation:colourGateRuleChanged`** — the Gate's active rule: which Sprout
  kind each lane of the fork currently invites (`null` = nobody). GameRules §9.4
  requires the Gate to "visibly show its active rule", and that rule is
  player-authored state living in `SimState.colourGateLanes`. Both the Gate's own
  panel (`src/ui/components/colourGate.ts`) and the structure in the world
  (`src/render/automation.ts`, which lights a lamp over each lane in that lane's
  colour) must show it without reaching into SimState — which this document
  forbids — so it is announced rather than read. Emitted on every player change
  **and** once when the Gate is built, carrying its safe default (Ember west, Dew
  east), so a listener that subscribed before the build still learns the rule.
  The *inbound* half — the player setting a lane — stays a plain function on
  `SimRuntime` (`setColourGateLane`), exactly like `purchaseUpgrade`: the union
  is sim-originated announcements and holds no player-intent members.
- **`nursery:rhythmChanged`** — the Nursery pod changed how briskly it opens,
  because of how many Sprouts are waiting for a home
  (`src/data/spawning.ts`'s "Nursery rhythm" section). Pods used to spawn on a
  fixed cadence regardless, so once all three habitats filled every further
  Sprout became permanent clutter — a measured save held 768 live Sprouts, which
  GameRules §7.4 (no visual chaos or selection frustration) and §9.7 (a
  bottleneck must be kind and legible, shown through world state, with a simple
  recommended solution) both rule out. The pod now eases off and finally rests;
  nothing is ever deleted, and it resumes the moment the player settles Sprouts
  or buys Habitat Room. This event is how the UI knows to show that in warm
  language (`src/ui/components/nurseryNote.ts`). Fired on a change of rhythm,
  **and** on a change of `waitingCount` while the pod is not `'lively'` — the
  note quotes that number, and announcing on rhythm alone froze it at whatever it
  was when the pod dozed off while the real figure kept dropping (a stale number
  is worse than no number; caught in browser QA against a real 814-Sprout
  garden). While lively the note is hidden, so ordinary spawns do not
  re-announce.

### Members added so a player can hand a Sprout to a helper directly

Player report: automation only ever picked from the Nursery on its own —
`src/input/index.ts`'s only drop-target lookup was `habitats.nearestWithin`,
so a Sprout dropped directly on a built Garden Slide or Colour Gate landed
nowhere and simply returned to idle. GameRules §9.1 wants automation to feel
like garden infrastructure the player can also work *with*, not only observe.

- **`sprout:dropped.overAutomation`** — the built automation site (if any) a
  drop landed on, alongside the existing `overHabitat`. A drop lands on at
  most one of the two. `src/render/automation.ts` gained a
  `nearestBuiltWithin` query (mirroring `habitats.ts`'s `nearestWithin`) so
  `src/input/index.ts` can offer automation sites as drop targets the same way
  it already offers habitats.
- **`sprout:automationDeclined`** — a drop onto a built site did not board the
  Sprout: the site is already carrying someone, has no route yet, the Sprout's
  kind does not match what it carries, or its destination is full. Mirrors
  `sprout:placed:incorrect`'s "never punitive" rule (GameRules §5.3, §11) for
  this new drop target: the Sprout is left exactly where it was, still idle,
  still pickable. `reason` is a short code rather than prose — sim stays
  decoupled from copywriting, matching `nursery:rhythmChanged`'s `rhythm`
  field. `src/sim/systems.ts`'s `adjudicateAutomationDrop` is the immediate
  (non-tick) reaction, called from `src/sim/runtime.ts` alongside
  `adjudicatePlacement` — and is deliberately routed through the exact same
  `beginRide` helper the tick-based `automationSystem` dispatcher itself now
  uses, so a manual drop can never start a ride the automation would have
  refused on its own next tick.

### Members added for the Mood Bell (Phase 2's first feature, 2026-08-01)

- **`sprout:spawned.mood`** — every Sprout now carries a second, independent
  attribute (`MoodId`) alongside `sproutType`, assigned via its own RNG draw
  at spawn (never derived from the type roll — see `src/data/spawning.ts`).
  Added to the event because the render layer only ever learns a Sprout's
  attributes from this event; without it there is no way to pick a mood
  badge or validate a Mood Bell hover/drop.
- **`automation:moodBellRuleChanged`** — mirrors
  `automation:colourGateRuleChanged`'s reasoning exactly, for the Bell's own
  single-mood toggle (`SimState.moodBellRule`) instead of the Gate's two-lane
  map. Emitted on every player change and once when the Bell is built,
  carrying its safe default (`'sunny'`).
- **`save:loaded.snapshot.moodBellRule`** — same reasoning as
  `snapshot.colourGateLanes`: the rule only announces on change, so a reload
  needs it restored from the snapshot rather than re-derived.

Mood is deliberately **not** a fourth `SproutTypeId` and never changes
`sproutMatchesHabitat` — it is a second, orthogonal routing dimension
(GameRules §9.6 stage 4, "multi-attribute routes"). The Mood Bell is a
Slide-shaped single-leg automation (one rule, one destination computed
per-sprout from its own type), not Gate-shaped — see
`src/sim/systems.ts`'s `planRide` doc comments for the dispatch mechanics,
including why building the Bell also changes what the Slide/Gate do (a
Sprout matching the Bell's current mood is excluded from their own pickup
eligibility once the Bell exists — a real routing partition, not a race
between automations checking in build order).

### Members added for manual placement (2026-08-01 GameRules revision)

Player asked for a much deeper building layer; the request conflicted with
GameRules as it stood, was surfaced per this doc's own authority chain, and
the user chose to revise the design (see `docs/_scratch/GameRules.md`'s own
Revision Log, §9.8-§9.11, §10.0). Phase 1 of that revision (plan.yaml) is: every
automation is now player-PLACED, not auto-built the moment it unlocks.

- **`automation:built.siteTile`** — where the player actually placed the
  structure. Newly REQUIRED (not optional): under the old model every
  automation had exactly one fixed default tile per `automationId`
  (`AUTOMATION_SITE_TILES`), so the renderer never needed the build event to
  say where; under manual placement there is no fixed default left to fall
  back to, so every `automation:built` must carry it.
- **`save:loaded.snapshot.automationSites`** — same "a restored save replays
  no `automation:built`" reasoning as `automationTargets` above, but for
  position instead of destination: without this the renderer would know an
  automation is unlocked but have nowhere to draw its structure. Only
  automations that are actually PLACED appear here — an unlocked-but-
  unplaced automation appears in `unlockedAutomations` but not this map.
- **`placeAutomation(automationId, tile)`** — new plain function on
  `SimRuntime`, same "no player-intent event in the union" reasoning as
  `purchaseUpgrade`/`setColourGateLane`. Validates via
  `isValidAutomationSite` (`src/sim/layout.ts`: on the path network, not the
  Nursery/a habitat/another automation's site, and — for the Colour Gate
  only — a genuine junction) and, for a destination-having automation
  (Garden Slide), computes it from the site tile itself via
  `nearestReachableHabitat` — the nearest habitat reachable over the real
  path network from wherever the player put it, replacing the old hardcoded
  "always Sunflower Meadow" rule.
- **`purchaseUpgrade`/`unlockSystem` no longer auto-build.** Purchasing
  `colourGateUnlock`/`moodBellUnlock`, and reaching the Garden Slide's
  placement threshold, now only add to `unlockedAutomations` and emit
  `automation:unlocked` — placing the structure is a separate player action
  via `placeAutomation`.
- **`SIM_SHAPE_VERSION`/`CURRENT_SAVE_VERSION` 4 -> 5**: `AutomationInstance`
  gained a required `siteTile: TileCoord` field. `src/persistence/save.ts`'s
  v4->v5 migration backfills it from the OLD fixed `AUTOMATION_SITE_TILES`
  default — the true historical value, since a v4 save's automations were
  always built there.

### Members added for buildable habitats (2026-08-02 GameRules §10.0, plan.yaml Phase 2)

Phase 2 lets the player build an ADDITIONAL habitat of an existing kind
(originals stay `HABITAT_TILES`, player-built copies are placed anywhere valid
on the path network). This adopts the same instance model automations already
use: `HabitatId` stays the closed 3-kind union ("what kind is it?"), and each
standing home is a `HabitatInstance` (id `'<kind>-<n>'`, tile, count, builtAtTick).

- **`habitat:built`** — player committed a new habitat of an existing kind.
  `habitatId` is the kind; `habitatInstanceId` is the concrete new home at
  `tile`, starting empty; `cost` is what was deducted. The renderer creates a
  fresh habitat visual here. Rides from already-built automations begin serving
  the new instance on their next dispatch.
- **`sprout:dropped.overHabitatInstance`** — which concrete home a drop landed
  on. With player-built copies, the kind alone is ambiguous, so the sim
  adjudicates against the exact instance. **`sprout:placed:correct` /
  `sprout:placed:incorrect` / `sprout:settled` / `habitat:dewdropTick` /
  `habitat:full`** all likewise gained a `habitatInstanceId` field.
- **`save:loaded.snapshot.habitatInstances`** — every standing instance in the
  restored save (originals + player-built). A restored save replays no
  `habitat:built` and the originals' meshes are created at startup, so without
  this the renderer would not know WHERE player-built copies stand. Carried
  alongside `fullHabitatInstances` (instance ids, replacing the old
  `fullHabitats` kind list so the sim can rebuild the full-now gate per kind).
- **`placeHabitat(habitatId, tile)`** — new plain function on `SimRuntime`,
  mirroring `placeAutomation`. Single source of truth for the gates (never the
  client): (1) FULL-NOW — at least one existing instance of the kind is
  currently at capacity; (2) AFFORDABLE — `state.dewdrops >= habitatBuildCost`,
  an escalating curve (2nd = 500, 3rd = 950, 4th = 1805, see
  `src/data/habitats.ts`); (3) VALID SITE — `isValidHabitatSite`. Cost is
  deducted in full on commit. The build menu (src/ui/components/buildMenu.ts)
  shows a button per full kind with the live cost; the input layer's habitat
  build mode drives the ghost preview (valid/invalid per `isValidHabitatSite`)
  and click-to-commit.
- **`SIM_SHAPE_VERSION`/`CURRENT_SAVE_VERSION` 5 -> 6**: `SimState.habitats`
  is now `HabitatInstance[]` (was `Record<HabitatId, { count: number }>`).
  `src/persistence/save.ts`'s v5->v6 migration rebuilds the array from the old
  kind-keyed record plus `HABITAT_TILES` (counts preserved, originals at their
  fixed tiles, `builtAtTick: 0`).

## Simulation boundary

- `src/sim/` has zero imports from `src/render`, `src/ui`, `src/audio`. Enforced by an architecture test (A writes it) that fails the build if violated (grep-based or dependency-cruiser-lite, no heavy tool needed).
- Fixed timestep (suggest 100ms tick) drives sim; renderer interpolates. Sim is pure functions over a serializable state object — this state object IS the save format (versioned).

## Garden Journal count

12 total collection slots. Phase 1 fills 4: ember, dew, sun, star. Remaining 8 shown as locked silhouettes (Phase 2 content, not implemented).

## Data-driven definitions (owned by B, consumed by A/E/F)

Each in `src/data/`, plain typed objects/arrays, no class logic:
- `sproutTypes.ts` — id, displayName, primaryColor, silhouetteKey (asset key), habitatId (correct match), rarity
- `moods.ts` — id, displayName, primaryColor, silhouetteKey (badge asset key). Purely descriptive: mood never determines habitat correctness.
- `habitats.ts` — id, displayName, baseCapacity, baseDewdropRate, matchSproutType
- `upgrades.ts` — id, cost curve fn or table, effect descriptor, maxLevel
- `achievements.ts` — id, triggerEvent, condition, rewardText
- `unlocks.ts` — thresholds (e.g. gardenSlide unlocks after N correct manual placements)

## Asset manifest (owned by C, consumed by E/F)

Source SVGs live under `public/assets/` (Vite's publicDir — served at `/assets/...` in both dev and the production build; NOT top-level `assets/`, which Vite never copies into `dist/`). `public/assets/manifest.json` keys every asset by a stable string the renderer/UI look up by, e.g.:
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
Same key pattern for dew/sun/star sprouts, all three habitats, garden slide, colour gate, paths, scenery, particles, UI icons. C delivers SVG source; E rasterizes it at runtime (`src/render/assets.ts`: `<img>` decode -> canvas -> Babylon `DynamicTexture`, NOT Babylon's plain `Texture` loader — Chromium's `createImageBitmap`, which Babylon's WebGPU path uses internally, cannot decode SVG and throws `InvalidStateError`; `<img>` decodes the same SVG fine). No separate build-time raster step is needed — rasterization happens client-side on first use.

## Audio

Original Web Audio synthesis only (no external license risk). F implements a small synth-based music/SFX module in `src/audio/`. Credits panel still lists it truthfully as "original, synthesized in-repo."

## Dev flag / debug panel

`import.meta.env.DEV` gates the debug panel entirely (component not rendered, module not imported in prod path). Verify absence in `dist/` after `npm run build` at integration time — not just conditional render.

## Save format

Versioned JSON object in IndexedDB, top-level `{ version: number, sim: SimState, meta: { lastSavedAt: number } }`. Any sim state shape change bumps `version`; A owns migration stub (no-op for v1).

Current version is **8**, matching `SIM_SHAPE_VERSION`. The migration chain is
explicit and non-mutating: v2→v3 adds the Colour Gate rule and Nursery rhythm;
v3→v4 adds deterministic Sprout moods and the Mood Bell rule; v4→v5 adds
manual-placement `siteTile`; v5→v6 converts kind-keyed habitats to concrete
habitat instances; v6→v7 converts the legacy Garden Slide and painted path into
`slides` plus owned `conveyors`; and v7→v8 backfills idle/in-flight Slide ride
fields (`carryingSproutId`, endpoints, and `completesAtTick`).

`normaliseEnvelope()` only additively fills missing top-level fields on a save
already labelled current; per-item repair belongs in an explicit migration.
After load, `repairTransitRides()` clears stale or duplicate Slide claims before
the first tick, returning any affected Sprout to a recoverable waiting tile.
