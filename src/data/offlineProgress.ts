// Real balance values + the offline-progress formula (Subagent B, Phase 2).
//
// docs/CONTRACTS.md's src/persistence owns the *hook* that calls this on
// load ("offline calc hook (data-driven values come from B)"); this module
// is the actual "data-driven" closed-form calculation A's hook should call.
//
// IMPORTANT (flagged by Subagent A in src/sim/loop.ts): advanceClock() caps
// any single real-time delta at 1000ms and cannot correctly process a
// multi-hour "player was away" gap — feeding a large elapsed time through it
// would silently truncate to ~10 ticks. computeOfflineProgress is therefore
// a SEPARATE closed-form estimate over elapsed real time and the sim state
// at the moment the game was closed; it must never be implemented by calling
// advanceClock/runTick with a huge delta.
//
// See docs/GAME_DESIGN.md ("Offline progress") for the reasoning behind the
// cap, efficiency, and ceiling below.

import type { HabitatId } from '../core/ids';
import { TICK_MS } from '../sim/loop';
import type { SimState } from '../sim/state';
import { HABITATS } from './habitats';
import { getDewdropMultiplier } from './upgrades';

/** Real-world time cap: no more than 2 hours of absence is ever credited. */
export const OFFLINE_CAP_MS = 2 * 60 * 60 * 1000;

/**
 * Offline production runs at half the active-play rate: no new pods to sort,
 * no habitat swaps, no upgrade purchases mid-session — just the Sprouts that
 * were already settled when the game closed, ticking over quietly.
 */
export const OFFLINE_EFFICIENCY = 0.5;

/**
 * Absolute ceiling on Dewdrops credited from a single offline gap, regardless
 * of elapsed time or how many Sprouts/habitats/upgrades the player has. This
 * is the real "conservative cap": OFFLINE_CAP_MS alone is not enough, because
 * a well-upgraded garden (more habitat capacity, higher baseDewdropRate
 * multiplier) times 2 full hours would otherwise dwarf the entire upgrade
 * tree (colourGateUnlock, the most expensive single purchase, costs 700 —
 * see src/data/upgrades.ts). 200 is roughly one mid-tier upgrade's worth: a
 * welcome-back nudge, never a replacement for playing.
 */
export const OFFLINE_DEWDROP_CEILING = 200;

export interface OfflineProgressResult {
  /** Real elapsed time actually credited, after the OFFLINE_CAP_MS clamp. */
  creditedMs: number;
  creditedTicks: number;
  dewdropsEarned: number;
}

/**
 * Estimates Dewdrops earned while the game was closed, directly from the
 * habitats' settled-Sprout counts and rates at close time — NOT by running
 * the real tick loop. `tickMs` defaults to the sim's fixed step (see
 * src/sim/loop.ts TICK_MS) but is an explicit param so this stays a pure,
 * independently testable closed-form function.
 */
export function computeOfflineProgress(
  elapsedRealMs: number,
  simStateAtClose: SimState,
  tickMs: number = TICK_MS,
): OfflineProgressResult {
  const creditedMs = Math.max(0, Math.min(elapsedRealMs, OFFLINE_CAP_MS));
  const creditedTicks = creditedMs / tickMs;

  let dewdropsPerTick = 0;
  for (const habitatId of Object.keys(simStateAtClose.habitats) as HabitatId[]) {
    const habitatState = simStateAtClose.habitats[habitatId];
    if (!habitatState) continue;
    dewdropsPerTick += habitatState.count * HABITATS[habitatId].baseDewdropRate;
  }

  const multiplier = getDewdropMultiplier(simStateAtClose.upgradeLevels);
  const rawEarned = dewdropsPerTick * creditedTicks * OFFLINE_EFFICIENCY * multiplier;
  const dewdropsEarned = Math.floor(Math.max(0, Math.min(rawEarned, OFFLINE_DEWDROP_CEILING)));

  return { creditedMs, creditedTicks, dewdropsEarned };
}
