// Real balance values (Subagent B, Phase 2). Not one of the five files named
// explicitly in docs/CONTRACTS.md's "Data-driven definitions" list, but still
// squarely src/data content (pod spawn cadence + Star Sprout rarity) per
// IMPLEMENTATION_PLAN.yaml's phase-2 B task list. See docs/GAME_DESIGN.md
// ("Progression math", "Star Sprout rarity") for the reasoning.

import type { SproutTypeId } from '../core/ids';
import { UPGRADES } from './upgrades';

/** Baseline time between nursery pod spawns, before the podRhythm upgrade. */
export const BASE_POD_SPAWN_INTERVAL_MS = 12_000;

/** Chance a spawned pod is a Star Sprout; the rest split evenly across the 3 common types. */
export const STAR_SPROUT_SPAWN_CHANCE = 0.06;

const COMMON_SPROUT_SHARE = (1 - STAR_SPROUT_SPAWN_CHANCE) / 3;

/** Spawn weights over the 4 sprout types; sums to exactly 1 by construction. */
export const SPAWN_WEIGHTS: Record<SproutTypeId, number> = {
  ember: COMMON_SPROUT_SHARE,
  dew: COMMON_SPROUT_SHARE,
  sun: COMMON_SPROUT_SHARE,
  star: STAR_SPROUT_SPAWN_CHANCE,
};

const SPAWN_ORDER: SproutTypeId[] = ['ember', 'dew', 'sun', 'star'];

/**
 * Picks a Sprout type for a newly spawned pod from a uniform random value in
 * [0, 1). Callers must source `random01` from the deterministic sim PRNG
 * (src/sim/rng.ts `nextRandom`), never Math.random(), to keep sim
 * reproducible per docs/CONTRACTS.md.
 */
export function pickSproutType(random01: number): SproutTypeId {
  let acc = 0;
  for (const id of SPAWN_ORDER) {
    acc += SPAWN_WEIGHTS[id];
    if (random01 < acc) return id;
  }
  // Floating point tail safety net; SPAWN_ORDER's last entry is 'star'.
  return 'star';
}

/** Pod spawn interval after the podRhythm upgrade (multiplicative reduction per level). */
export function getPodSpawnIntervalMs(podRhythmLevel: number): number {
  const factor = (1 - UPGRADES.podRhythm.effect.magnitudePerLevel) ** podRhythmLevel;
  return BASE_POD_SPAWN_INTERVAL_MS * factor;
}
