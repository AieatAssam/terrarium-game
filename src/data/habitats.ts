// Real balance values (Subagent B, Phase 2). See docs/GAME_DESIGN.md
// ("Progression math") for how baseCapacity/baseDewdropRate were derived and
// how they interact with the habitatCapacity and dewdropMultiplier upgrades.

import type { HabitatId, SproutTypeId } from '../core/ids';
import { UPGRADES } from './upgrades';

export interface HabitatDefinition {
  id: HabitatId;
  displayName: string;
  /** Max Sprouts this habitat can hold before "full", before upgrades. */
  baseCapacity: number;
  /** Dewdrops produced per occupied (settled) Sprout per 100ms sim tick. */
  baseDewdropRate: number;
  /** The one Sprout type that correctly belongs here. */
  matchSproutType: SproutTypeId;
}

// All three habitats share the same capacity/rate on purpose — Phase 1 has
// no reason to make one biome objectively better than another; asymmetry
// would just bias which corner of the garden players rush toward first.
// Three habitats x this is the hard ceiling on lifetime correct placements
// before every home is full, so it must stay above
// UNLOCK_THRESHOLDS.gardenSlide.requiredCorrectPlacements (20) or the Garden
// Slide becomes unreachable by play — see the note there.
const BASE_CAPACITY = 8;
/**
 * Per settled Sprout per tick. Income is deliberately a pure multiple of how
 * many Sprouts the player has actually settled in their correct home (see
 * dewdropSystem), so caring for the garden is the only thing that earns —
 * GameRules.md §4.4 "Dewdrops are healthy magical care made visible".
 *
 * This was 0.02 (12/min per Sprout), which put the entire upgrade tree at
 * roughly nine minutes of full-garden income and left real saves holding
 * multiples of everything purchasable, so no purchase was a decision. At
 * 0.008 (4.8/min per Sprout) a first upgrade lands a few minutes in and the
 * tree spans a long session, while the early game — where only a handful of
 * Sprouts are settled — stays genuinely lean without ever stalling, since
 * income rises as a direct reward for settling more. Balanced against the
 * cost curves in data/upgrades.ts; changing one without the other reopens the
 * problem.
 */
const BASE_DEWDROP_RATE = 0.008;

export const HABITATS: Record<HabitatId, HabitatDefinition> = {
  emberNook: {
    id: 'emberNook',
    displayName: 'Ember Nook',
    baseCapacity: BASE_CAPACITY,
    baseDewdropRate: BASE_DEWDROP_RATE,
    matchSproutType: 'ember',
  },
  dewPond: {
    id: 'dewPond',
    displayName: 'Dew Pond',
    baseCapacity: BASE_CAPACITY,
    baseDewdropRate: BASE_DEWDROP_RATE,
    matchSproutType: 'dew',
  },
  sunflowerMeadow: {
    id: 'sunflowerMeadow',
    displayName: 'Sunflower Meadow',
    baseCapacity: BASE_CAPACITY,
    baseDewdropRate: BASE_DEWDROP_RATE,
    matchSproutType: 'sun',
  },
};

export const HABITAT_LIST: HabitatDefinition[] = Object.values(HABITATS);

/**
 * Effective capacity for a habitat once the (single, garden-wide)
 * habitatCapacity upgrade is factored in. The upgrade applies uniformly to
 * all three habitats — Phase 1 has no per-habitat upgrade instances.
 */
export function getEffectiveHabitatCapacity(habitatId: HabitatId, habitatCapacityLevel: number): number {
  const base = HABITATS[habitatId].baseCapacity;
  return base + habitatCapacityLevel * UPGRADES.habitatCapacity.effect.magnitudePerLevel;
}

// ---------------------------------------------------------------------------
// Buildable habitats (Phase 2 — plan.yaml Phase 2.2, GameRules §10.0)
// ---------------------------------------------------------------------------
// A player builds an ADDITIONAL habitat of an existing kind for a Dewdrop
// cost, gated on that kind already being full (see placeHabitat,
// src/sim/systems.ts). The cost grows geometrically per instance of that
// kind, rounded to the nearest 5 to match the upgrade tree's own cost idiom
// (src/data/upgrades.ts): 2nd = 500, 3rd = 950, 4th = 1805. Checked against
// the real income rate of 4.8 Dewdrops/min per settled Sprout, same as the
// upgrade tree — see docs/GAME_DESIGN.md.
const HABITAT_BUILD_COST_BASE = 500;
const HABITAT_BUILD_COST_GROWTH = 1.9;

function roundTo5(value: number): number {
  return Math.round(value / 5) * 5;
}

/**
 * What the NEXT habitat of an existing kind costs, given how many instances
 * of that kind already stand (Phase 2). `existingInstanceCount` includes the
 * original (always ≥ 1), so the first player-built one is the 2nd overall
 * and costs `round5(base * growth^(count - 1))` with count = 1. The curve is
 * the same for every kind — Phase 2 gives no biome a cheaper second home.
 */
export function habitatBuildCost(existingInstanceCount: number): number {
  return roundTo5(HABITAT_BUILD_COST_BASE * HABITAT_BUILD_COST_GROWTH ** Math.max(0, existingInstanceCount - 1));
}
