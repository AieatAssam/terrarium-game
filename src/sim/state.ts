// SimState is a plain, JSON-serializable object — it IS the save format
// (see src/persistence). No classes, no hidden mutable internals beyond this
// object itself, no functions/Maps/Sets as fields. Phase 2+ gameplay systems
// extend this shape (and bump the save envelope version when they do); this
// file only establishes the shell so downstream agents compile against
// something stable.

import type { AchievementId, AutomationId, HabitatId, SproutTypeId, UpgradeId } from '../core/ids';
import type { TileCoord } from './grid';

export type SproutInstanceState = 'idle' | 'walking' | 'transporting' | 'settled';

export interface SproutInstance {
  id: string;
  sproutType: SproutTypeId;
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
}

export const SIM_SHAPE_VERSION = 2;

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
    spawnAccumulatorMs: 0,
    correctPlacementCount: 0,
    habitatDewdropFraction: {},
  };
}
