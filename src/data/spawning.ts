// Real balance values (Subagent B, Phase 2). Not one of the five files named
// explicitly in docs/CONTRACTS.md's "Data-driven definitions" list, but still
// squarely src/data content (pod spawn cadence + Star Sprout rarity) per
// IMPLEMENTATION_PLAN.yaml's phase-2 B task list. See docs/GAME_DESIGN.md
// ("Progression math", "Star Sprout rarity") for the reasoning.

import type { MoodId, SproutTypeId } from '../core/ids';
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

/**
 * Picks a Sprout's mood (Mood Bell feature, 2026-08-01) from a uniform
 * random value in [0, 1) — a simple 50/50 split, independent of type.
 *
 * MUST be called with its OWN `nextRandom` draw, never the same `random01`
 * passed to `pickSproutType` for the same spawn. Mood is deliberately a
 * second, orthogonal attribute (GameRules §7.3/§9.6 stage 4) — reusing the
 * type roll's random value would make mood a pure function of type (e.g.
 * ember always sunny), silently collapsing the entire point of a second
 * attribute and leaving the Mood Bell unable to ever carry a mixed set of
 * types.
 */
export function pickMood(random01: number): MoodId {
  return random01 < 0.5 ? 'sunny' : 'sleepy';
}

/** Pod spawn interval after the podRhythm upgrade (multiplicative reduction per level). */
export function getPodSpawnIntervalMs(podRhythmLevel: number): number {
  const factor = (1 - UPGRADES.podRhythm.effect.magnitudePerLevel) ** podRhythmLevel;
  return BASE_POD_SPAWN_INTERVAL_MS * factor;
}

// ---------------------------------------------------------------------------
// Nursery rhythm — how the pod responds to a queue of unclaimed Sprouts
// ---------------------------------------------------------------------------
// The pod used to spawn on a fixed cadence no matter what, while the three
// habitats cap at 8 each (24 total). Once every home filled, every subsequent
// spawn was permanent clutter waiting at the Nursery forever — a measured save
// held 768 live Sprouts. GameRules §7.4 forbids Sprouts creating "visual chaos
// or selection frustration" (and equally forbids ever despawning them for
// player inaction), and §9.7 requires a bottleneck to be a KIND, LEGIBLE
// opportunity to solve a problem, shown through world state, with a simple
// recommended solution.
//
// So the pod reads the room instead. It stays lively while the waiting area is
// comfortable, EASES OFF as the queue grows, and finally RESTS — it keeps
// breathing, it just doesn't open. Nothing is ever deleted, nothing is lost,
// there is no failure state and no punishment: the moment the player settles a
// few Sprouts or buys Habitat Room, the queue shrinks and the pod picks straight
// back up. That recovery is always available, which is why this can never
// permanently stall progress.
//
// The thresholds are deliberately generous compared with the moments the game
// needs a queue to exist for: the Colour Gate's behavioural unlock wants only
// 3 unsorted Sprouts waiting at once (src/data/unlocks.ts), well under
// NURSERY_EASE_THRESHOLD, so easing never blocks the automation chain. Covered
// by the reachability tests in tests/unit/sim.systems.test.ts.

/** How the Nursery pod is currently behaving. Player-facing wording lives in src/ui. */
export type NurseryRhythm = 'lively' | 'easing' | 'resting';

/** Waiting Sprouts the Nursery is perfectly happy about; below this it spawns at full pace. */
export const NURSERY_EASE_THRESHOLD = 6;

/** Waiting Sprouts at which the Nursery rests entirely rather than adding to the crowd. */
export const NURSERY_REST_THRESHOLD = 12;

export function getNurseryRhythm(waitingCount: number): NurseryRhythm {
  if (waitingCount >= NURSERY_REST_THRESHOLD) return 'resting';
  if (waitingCount > NURSERY_EASE_THRESHOLD) return 'easing';
  return 'lively';
}

/**
 * Multiplier applied to the pod interval as the queue grows: 1 while lively,
 * rising smoothly to NURSERY_MAX_PACE_MULTIPLIER just before the pod rests. The
 * ramp matters — a hard cliff from "normal" to "stopped" reads as a bug,
 * whereas a pod that visibly slows down first is the world-state warning §9.7
 * asks for.
 */
export const NURSERY_MAX_PACE_MULTIPLIER = 6;

export function getNurseryPaceMultiplier(waitingCount: number): number {
  if (waitingCount <= NURSERY_EASE_THRESHOLD) return 1;
  const span = NURSERY_REST_THRESHOLD - NURSERY_EASE_THRESHOLD;
  const over = Math.min(waitingCount - NURSERY_EASE_THRESHOLD, span);
  return 1 + (over / span) * (NURSERY_MAX_PACE_MULTIPLIER - 1);
}
