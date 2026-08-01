// SimState is a plain, JSON-serializable object — it IS the save format
// (see src/persistence). No classes, no hidden mutable internals beyond this
// object itself, no functions/Maps/Sets as fields. Phase 2+ gameplay systems
// extend this shape (and bump the save envelope version when they do); this
// file only establishes the shell so downstream agents compile against
// something stable.

import type { AchievementId, AutomationId, HabitatId, MoodId, SproutTypeId, UpgradeId } from '../core/ids';
import { INITIAL_SPAWN_ACCUMULATOR_MS, type NurseryRhythm } from '../data/spawning';
import type { TileCoord } from './grid';
import { defaultColourGateLanes, type ColourGateLanes } from './layout';

export type SproutInstanceState = 'idle' | 'walking' | 'transporting' | 'settled';

export interface SproutInstance {
  id: string;
  sproutType: SproutTypeId;
  /** Second, orthogonal attribute (Mood Bell feature, 2026-08-01) — never affects which habitat is correct for this Sprout. */
  mood: MoodId;
  tile: TileCoord;
  state: SproutInstanceState;
}

export interface HabitatState {
  id: HabitatId;
  count: number;
  capacity: number;
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

export interface SimState {
  /** Bumped whenever this shape changes; mirrors the save envelope version. */
  shapeVersion: number;
  tickCount: number;
  /** mulberry32 seed/state — the sole source of "randomness" in sim. */
  rngSeed: number;
  dewdrops: number;
  sprouts: SproutInstance[];
  habitats: Partial<Record<HabitatId, HabitatState>>;
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
  /** Fractional Dewdrop remainder per habitat not yet flushed into `dewdrops` as a whole unit. */
  habitatDewdropFraction: Partial<Record<HabitatId, number>>;
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

export const SIM_SHAPE_VERSION = 5;

export function createInitialSimState(seed: number): SimState {
  return {
    shapeVersion: SIM_SHAPE_VERSION,
    tickCount: 0,
    rngSeed: seed,
    dewdrops: 0,
    sprouts: [],
    habitats: {},
    automations: [],
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
