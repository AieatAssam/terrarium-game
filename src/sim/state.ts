// SimState is a plain, JSON-serializable object — it IS the save format
// (see src/persistence). No classes, no hidden mutable internals beyond this
// object itself, no functions/Maps/Sets as fields. Phase 2+ gameplay systems
// extend this shape (and bump the save envelope version when they do); this
// file only establishes the shell so downstream agents compile against
// something stable.

import type { AchievementId, AutomationId, HabitatId, MoodId, SproutTypeId, UpgradeId } from '../core/ids';
import { INITIAL_SPAWN_ACCUMULATOR_MS, type NurseryRhythm } from '../data/spawning';
import type { TileCoord } from './grid';
import { defaultColourGateLanes, HABITAT_TILES, type ColourGateLanes } from './layout';

export type SproutInstanceState = 'idle' | 'walking' | 'transporting' | 'settled';

export interface SproutInstance {
  id: string;
  sproutType: SproutTypeId;
  /** Second, orthogonal attribute (Mood Bell feature, 2026-08-01) — never affects which habitat is correct for this Sprout. */
  mood: MoodId;
  tile: TileCoord;
  state: SproutInstanceState;
}

/**
 * One concrete habitat standing in the garden (Phase 2 — buildable habitats,
 * the INSTANCE model: `HabitatId` stays the closed 3-kind union, and this
 * layer sits under it the same way `AutomationInstance` sits under
 * `AutomationId`). The three original homes are the first instance of each
 * kind (`emberNook-1`, `dewPond-1`, `sunflowerMeadow-1`, `builtAtTick: 0`),
 * seeded by `createInitialSimState`; a player builds further instances via
 * `placeHabitat` (src/sim/systems.ts).
 *
 * `capacity` is deliberately NOT stored: it is always derived live from the
 * instance's KIND via `getEffectiveHabitatCapacity`, so the garden-wide
 * habitatCapacity upgrade can never go stale against a stored number.
 */
export interface HabitatInstance {
  /** `${habitatId}-${n}` — n is 1 for the original, then 2/3/… per kind in build order. */
  id: string;
  /** The kind — the art/data/balance tables key on this, never on the instance. */
  habitatId: HabitatId;
  /** Where the structure stands. Originals sit at `HABITAT_TILES[kind]`; player-built ones on a path tile the player chose. */
  tile: TileCoord;
  /** Sprouts currently settled here. */
  count: number;
  /** Tick this instance was built — 0 for the garden's original three. */
  builtAtTick: number;
}

export interface AutomationInstance {
  id: string;
  automationId: AutomationId;
  /**
   * Where the physical structure stands (2026-08-01, manual placement —
   * plan.yaml Phase 1.2). Player-chosen at placement time, constrained by
   * `isValidAutomationSite` (src/sim/layout.ts). Distinct from
   * fromTile/toTile below, which describe the RIDE, not the structure.
   */
  siteTile: TileCoord;
  fromTile: TileCoord;
  toTile: TileCoord;
  /** Tick this instance was built — `singleHabitatFeedTicks` (unlocks.ts) is derived as `tickCount - builtAtTick`. */
  builtAtTick: number;
  /** gardenSlide only: the one habitat it feeds. colourGate routes dynamically per-sprout and leaves this undefined. */
  targetHabitatId?: HabitatId;
  /** Sprout currently riding this automation, if any — one in flight at a time per instance. */
  carryingSproutId: string | null;
  /** Tick at which the in-flight transport completes, if carrying. */
  completesAtTick: number | null;
}

/**
 * Garden Transit (GameRules §9.3, plan.yaml Phase 7 — 2026-08-02) domain
 * types. N-instance by design; the Colour Gate and Mood Bell stay ordinary
 * single `AutomationInstance`s (plan.yaml 7.2 non_goals). This is the shape
 * the v6→v7 save migration produces; 7.3+ wires it into the sim.
 *
 * Ports (entry/exit, §9.13) and route state are deliberately NOT stored:
 * ports are derived from artifact position + kind on load (plan.yaml 7.5),
 * and route state is a pure function of state (7.8). Mid-ride persistence is
 * 7.13's concern and has no fields here yet.
 */

/** The §9.14 accepted-kind filter: one Sprout kind, or `'any'` (the safe default). */
export type TransitAcceptedKind = SproutTypeId | 'any';

/** Serializable port vocabulary shared by every Garden Transit artifact. */
export type TransitPortKind = 'entry' | 'exit' | 'dock' | 'lane';
export type TransitPortDirection = 'north' | 'east' | 'south' | 'west';
export type TransitPortCompatibility = 'transit' | 'nursery' | 'habitat' | 'junction';

/** A named attachment point; compatibility is data, never mesh overlap. */
export interface Port {
  ownerId: string;
  kind: TransitPortKind;
  direction: TransitPortDirection;
  compatibility: TransitPortCompatibility;
}

/**
 * One owned, placed Garden Slide. Copied from the HabitatInstance pattern
 * (kind on the instance, tile on the instance, no per-instance price —
 * GameRules §9.12). A migrated legacy Slide is always `slide-1`.
 */
export interface SlideInstance {
  /** `slide-1`, `slide-2`, … per owned Slide in build order. */
  id: string;
  /** Where the structure stands (was `AutomationInstance.siteTile`). */
  tile: TileCoord;
  /** Which Sprout kinds this Slide carries; `'any'` accepts everything (§9.14). */
  acceptedKind: TransitAcceptedKind;
  /** The home this Slide delivers to (§9.14) — preserved from the legacy computed target. */
  destination: HabitatId;
  /** §9.14: a disabled Slide is visibly dormant and holds nothing. */
  enabled: boolean;
  /** Explicit connections. Optional for v7 saves; `getSlidePorts` supplies a deterministic legacy shape. */
  entryPort?: Port;
  exitPort?: Port;
  /** Tick this Slide was built — a migrated legacy Slide keeps its historical value. */
  builtAtTick: number;
}

/**
 * One placed Sprout Conveyor segment — the single buildable route substrate
 * (GameRules §9.9, §9.3.2). Connectivity is derived from which tiles are
 * occupied by segments (adjacency in the tile graph), never stored, so a
 * segment needs no port fields here (plan.yaml 7.5).
 */
export interface ConveyorSegment {
  /** `conveyor-<x>-<z>` — unique per tile; a segment cannot share its tile. */
  id: string;
  /** The tile this segment occupies. */
  tile: TileCoord;
  /** Explicit connections. Optional for v7 saves; `getConveyorPorts` supplies a deterministic legacy shape. */
  entryPort?: Port;
  exitPort?: Port;
  /** Optional simple routing rules; pricing/configuration arrive in later phases. */
  filter?: TransitAcceptedKind;
  destination?: HabitatId;
  /** Tick this segment was built — the migrated fixed network is pre-existing garden infrastructure (0). */
  builtAtTick: number;
}

export function getSlidePorts(slide: SlideInstance): { entryPort: Port; exitPort: Port } {
  return {
    entryPort: slide.entryPort ?? { ownerId: slide.id, kind: 'entry', direction: 'south', compatibility: 'transit' },
    exitPort: slide.exitPort ?? { ownerId: slide.id, kind: 'exit', direction: 'north', compatibility: 'transit' },
  };
}

export function getConveyorPorts(segment: ConveyorSegment): { entryPort: Port; exitPort: Port } {
  return {
    entryPort: segment.entryPort ?? { ownerId: segment.id, kind: 'entry', direction: 'south', compatibility: 'transit' },
    exitPort: segment.exitPort ?? { ownerId: segment.id, kind: 'exit', direction: 'north', compatibility: 'transit' },
  };
}

/** A transit artifact's legible state, matching GameRules §9.15 exactly. Derived, never stored. */
export type RouteState = 'idle' | 'active' | 'waiting' | 'blocked' | 'disabled' | 'invalid';

export interface SimState {
  /** Bumped whenever this shape changes; mirrors the save envelope version. */
  shapeVersion: number;
  tickCount: number;
  /** mulberry32 seed/state — the sole source of "randomness" in sim. */
  rngSeed: number;
  dewdrops: number;
  sprouts: SproutInstance[];
  /** Every habitat standing in the garden — the three originals plus any the player built (Phase 2). */
  habitats: HabitatInstance[];
  /** Owned, placed Garden Slides (Garden Transit, §9.3.1) — N-instance; empty for a fresh garden. */
  slides: SlideInstance[];
  /** Placed Sprout Conveyor segments (§9.3.2/§9.9) — the buildable route substrate; empty for a fresh garden. */
  conveyors: ConveyorSegment[];
  /** The Colour Gate, Mood Bell and any future single-instance helpers. A migrated legacy Slide is REMOVED from here (it becomes a `slides` entry). */
  automations: AutomationInstance[];
  unlockedAutomations: AutomationId[];
  /** Level per purchased upgrade; absent key = not yet purchased. */
  upgradeLevels: Partial<Record<UpgradeId, number>>;
  unlockedAchievements: AchievementId[];
  journalDiscovered: SproutTypeId[];
  /** Accumulated ms toward the next nursery pod spawn (podRhythm-adjusted). */
  spawnAccumulatorMs: number;
  /** Correct manual-or-automated placements ever made; gates gardenSlide's unlock. */
  correctPlacementCount: number;
  /** Fractional Dewdrop remainder per habitat INSTANCE not yet flushed into `dewdrops` as a whole unit. */
  habitatDewdropFraction: Partial<Record<string, number>>;
  /**
   * The Colour Gate's active rule: which Sprout kind each lane of the fork
   * currently invites (`null` = "nobody yet"). Set by the player through the
   * Gate's pictorial lane cards; the lane→habitat mapping itself is a fixed
   * fact about the garden's shape (src/sim/layout.ts) and is never edited.
   * Lives here rather than on the AutomationInstance so the rule survives even
   * if the instance is ever rebuilt, and so it is trivially serializable.
   */
  colourGateLanes: ColourGateLanes;
  /**
   * The Mood Bell's active rule: which mood it currently welcomes. Unlike
   * `colourGateLanes`, this has no "nobody yet" null state — it is always
   * populated (defaults `'sunny'`), since the value is simply inert until
   * the Bell is actually built (`unlockedAutomations` gates whether it has
   * any effect, not this field itself).
   */
  moodBellRule: MoodId;
  /**
   * The Nursery pod's last-announced rhythm, and the waiting-Sprout count that
   * went with it. Both are purely derived from how many Sprouts are waiting
   * (see src/data/spawning.ts) — they are stored only so
   * `nursery:rhythmChanged` fires once per CHANGE instead of every tick, and so
   * a restored save knows whether it is already resting.
   *
   * The count is cached as well as the rhythm because the player-facing note
   * quotes it ("814 little ones are waiting"). Announcing only on a change of
   * RHYTHM left that number frozen at whatever it was when the pod went to
   * sleep, while the real figure kept dropping as the player settled Sprouts —
   * a stale number is worse than no number (caught in browser QA).
   */
  nurseryRhythm: NurseryRhythm;
  nurseryWaitingCount: number;
}

export const SIM_SHAPE_VERSION = 7;

export function createInitialSimState(seed: number): SimState {
  return {
    shapeVersion: SIM_SHAPE_VERSION,
    tickCount: 0,
    rngSeed: seed,
    dewdrops: 0,
    sprouts: [],
    // The garden's three original homes, one instance per kind, standing at
    // their canonical tiles (Phase 2 instance model). Seeded here rather than
    // created lazily on first settle so "does this kind have a home at all"
    // never depends on whether a Sprout has ever arrived, and so the v5→v6
    // migration can rely on every kind always having at least one instance.
    habitats: (Object.keys(HABITAT_TILES) as HabitatId[]).map((habitatId) => ({
      id: `${habitatId}-1`,
      habitatId,
      tile: HABITAT_TILES[habitatId],
      count: 0,
      builtAtTick: 0,
    })),
    automations: [],
    slides: [],
    conveyors: [],
    unlockedAutomations: [],
    upgradeLevels: {},
    unlockedAchievements: [],
    journalDiscovered: [],
    // Pre-elapsed on purpose so the first pod opens ~2s in, per GameRules
    // §6.1. See INITIAL_SPAWN_ACCUMULATOR_MS for the full reasoning.
    spawnAccumulatorMs: INITIAL_SPAWN_ACCUMULATOR_MS,
    correctPlacementCount: 0,
    habitatDewdropFraction: {},
    colourGateLanes: defaultColourGateLanes(),
    moodBellRule: 'sunny',
    nurseryRhythm: 'lively',
    nurseryWaitingCount: 0,
  };
}
