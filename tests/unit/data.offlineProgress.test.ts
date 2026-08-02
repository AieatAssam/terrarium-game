import { describe, expect, it } from 'vitest';
import {
  computeOfflineProgress,
  OFFLINE_CAP_MS,
  OFFLINE_DEWDROP_CEILING,
} from '../../src/data/offlineProgress';
import { createInitialSimState, type SimState } from '../../src/sim/state';
import { HABITAT_TILES } from '../../src/sim/layout';
import { UPGRADES } from '../../src/data/upgrades';

function stateWithSettledHabitats(counts: Partial<Record<'emberNook' | 'dewPond' | 'sunflowerMeadow', number>>): SimState {
  const base = createInitialSimState(1);
  return {
    ...base,
    habitats: (Object.keys(HABITAT_TILES) as (keyof typeof HABITAT_TILES)[]).map((habitatId) => ({
      id: `${habitatId}-1`,
      habitatId,
      tile: HABITAT_TILES[habitatId],
      count: counts[habitatId] ?? 0,
      builtAtTick: 0,
    })),
  };
}

describe('computeOfflineProgress', () => {
  it('never credits more real time than OFFLINE_CAP_MS, however long the player was away', () => {
    const state = stateWithSettledHabitats({ emberNook: 6, dewPond: 6, sunflowerMeadow: 6 });
    const tenHoursMs = 10 * 60 * 60 * 1000;

    const result = computeOfflineProgress(tenHoursMs, state);

    expect(result.creditedMs).toBe(OFFLINE_CAP_MS);
    expect(result.creditedMs).toBeLessThan(tenHoursMs);
  });

  it('credits identical progress for elapsed times at and far beyond the cap (clamped, not scaled)', () => {
    const state = stateWithSettledHabitats({ emberNook: 6, dewPond: 6, sunflowerMeadow: 6 });

    const atCap = computeOfflineProgress(OFFLINE_CAP_MS, state);
    const wayBeyondCap = computeOfflineProgress(OFFLINE_CAP_MS * 100, state);

    expect(wayBeyondCap).toEqual(atCap);
  });

  it('never exceeds the absolute Dewdrop ceiling, even for a fully-settled max-occupancy garden', () => {
    const state = stateWithSettledHabitats({ emberNook: 6, dewPond: 6, sunflowerMeadow: 6 });

    const result = computeOfflineProgress(10 * 60 * 60 * 1000, state);

    expect(result.dewdropsEarned).toBeLessThanOrEqual(OFFLINE_DEWDROP_CEILING);
    expect(result.dewdropsEarned).toBe(OFFLINE_DEWDROP_CEILING);
  });

  it('the ceiling is roughly one mid-tier upgrade, never the whole upgrade tree', () => {
    // A full 2-hour absence should buy at most the cheaper end of the
    // upgrade list, never colourGateUnlock (the most expensive single
    // purchase) outright.
    expect(OFFLINE_DEWDROP_CEILING).toBeLessThan(UPGRADES.colourGateUnlock.costForLevel(1));
  });

  it('earns nothing for zero or negative elapsed time', () => {
    const state = stateWithSettledHabitats({ emberNook: 3 });
    expect(computeOfflineProgress(0, state).dewdropsEarned).toBe(0);
    expect(computeOfflineProgress(-1000, state).dewdropsEarned).toBe(0);
  });

  it('earns nothing when no Sprouts were settled at close', () => {
    const state = stateWithSettledHabitats({});
    const result = computeOfflineProgress(60 * 60 * 1000, state);
    expect(result.dewdropsEarned).toBe(0);
  });

  it('respects a custom tickMs for deterministic testing', () => {
    const state = stateWithSettledHabitats({ emberNook: 1 });
    const result = computeOfflineProgress(10_000, state, 100);
    expect(result.creditedTicks).toBe(100);
  });
});
