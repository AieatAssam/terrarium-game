// Coverage for src/sim/systems.ts — the gameplay layer that was missing
// from the original Phase 1/2 split (see docs/CONTRACTS.md's history: sim
// shipped a fixed-step shell with no gameplay systems; this file is that
// gap being filled during integration).

import { describe, expect, it } from 'vitest';
import { createInitialSimState, type SimState } from '../../src/sim/state';
import {
  adjudicatePlacement,
  automationSystem,
  checkAchievements,
  dewdropSystem,
  purchaseUpgrade,
  spawnSystem,
  unlockSystem,
} from '../../src/sim/systems';
import { TICK_MS } from '../../src/sim/loop';
import { runTick } from '../../src/sim/tick';
import { NURSERY_TILE } from '../../src/sim/layout';
import { BASE_POD_SPAWN_INTERVAL_MS } from '../../src/data/spawning';
import { UNLOCK_THRESHOLDS } from '../../src/data/unlocks';
import { UPGRADES } from '../../src/data/upgrades';

function withSprout(state: SimState, sproutType: 'ember' | 'dew' | 'sun' | 'star', overrides: Partial<SimState['sprouts'][number]> = {}) {
  return {
    ...state,
    sprouts: [...state.sprouts, { id: 'test-sprout', sproutType, tile: NURSERY_TILE, state: 'idle' as const, ...overrides }],
  };
}

describe('spawnSystem', () => {
  it('does not spawn before the pod interval elapses', () => {
    let state = createInitialSimState(1);
    for (let i = 0; i < Math.floor(BASE_POD_SPAWN_INTERVAL_MS / TICK_MS) - 1; i += 1) {
      state = spawnSystem(state).state;
    }
    expect(state.sprouts).toHaveLength(0);
  });

  it('spawns exactly one Sprout once the interval elapses, and carries over remainder', () => {
    let state = createInitialSimState(1);
    let spawnedCount = 0;
    for (let i = 0; i < Math.ceil(BASE_POD_SPAWN_INTERVAL_MS / TICK_MS); i += 1) {
      const result = spawnSystem(state);
      state = result.state;
      spawnedCount += result.events.length;
    }
    expect(spawnedCount).toBe(1);
    expect(state.sprouts).toHaveLength(1);
    expect(state.sprouts[0].tile).toEqual(NURSERY_TILE);
  });

  it('is deterministic: same seed produces the same sequence of sprout types', () => {
    const ticks = Math.ceil(BASE_POD_SPAWN_INTERVAL_MS / TICK_MS) * 5;
    const run = () => {
      let state = createInitialSimState(42);
      const types: string[] = [];
      for (let i = 0; i < ticks; i += 1) {
        const result = spawnSystem(state);
        state = result.state;
        for (const e of result.events) if (e.type === 'sprout:spawned') types.push(e.sproutType);
      }
      return types;
    };
    expect(run()).toEqual(run());
  });
});

describe('adjudicatePlacement', () => {
  it('settles a correctly matched Sprout and counts it toward the unlock threshold', () => {
    const state = withSprout(createInitialSimState(1), 'ember');
    const result = adjudicatePlacement(state, 'test-sprout', 'emberNook');
    expect(result.events.some((e) => e.type === 'sprout:placed:correct')).toBe(true);
    expect(result.events.some((e) => e.type === 'sprout:settled')).toBe(true);
    expect(result.state.correctPlacementCount).toBe(1);
    expect(result.state.habitats.emberNook?.count).toBe(1);
    expect(result.state.sprouts[0].state).toBe('settled');
  });

  it('rejects a mismatched Sprout without settling it, and is a friendly retry (no error, no state loss)', () => {
    const state = withSprout(createInitialSimState(1), 'ember');
    const result = adjudicatePlacement(state, 'test-sprout', 'dewPond');
    expect(result.events).toEqual([{ type: 'sprout:placed:incorrect', sproutId: 'test-sprout', habitatId: 'dewPond' }]);
    expect(result.state.correctPlacementCount).toBe(0);
    expect(result.state.sprouts[0].state).toBe('idle');
  });

  it('lets a Star Sprout settle in any habitat', () => {
    for (const habitat of ['emberNook', 'dewPond', 'sunflowerMeadow'] as const) {
      const state = withSprout(createInitialSimState(1), 'star');
      const result = adjudicatePlacement(state, 'test-sprout', habitat);
      expect(result.events.some((e) => e.type === 'sprout:placed:correct')).toBe(true);
    }
  });

  it('rejects placement into an already-full habitat', () => {
    let state = createInitialSimState(1);
    state = { ...state, habitats: { emberNook: { id: 'emberNook', count: 6, capacity: 6 } } };
    state = withSprout(state, 'ember');
    const result = adjudicatePlacement(state, 'test-sprout', 'emberNook');
    expect(result.events).toEqual([{ type: 'sprout:placed:incorrect', sproutId: 'test-sprout', habitatId: 'emberNook' }]);
  });

  it('ignores a drop for a Sprout that is no longer idle (already mid-transport)', () => {
    const state = withSprout(createInitialSimState(1), 'ember', { state: 'transporting' });
    const result = adjudicatePlacement(state, 'test-sprout', 'emberNook');
    expect(result.events).toEqual([]);
  });

  it('fires a journal discovery event only the first time a species settles', () => {
    const state = withSprout(createInitialSimState(1), 'ember');
    const first = adjudicatePlacement(state, 'test-sprout', 'emberNook');
    expect(first.events.some((e) => e.type === 'journal:entryDiscovered')).toBe(true);

    const secondState = withSprout(first.state, 'ember', { id: 'test-sprout-2' });
    const second = adjudicatePlacement(secondState, 'test-sprout-2', 'emberNook');
    expect(second.events.some((e) => e.type === 'journal:entryDiscovered')).toBe(false);
  });

  it('emits habitat:full exactly on the tick capacity is reached, not before or after', () => {
    let state = createInitialSimState(1);
    state = { ...state, habitats: { emberNook: { id: 'emberNook', count: 5, capacity: 6 } } };
    state = withSprout(state, 'ember');
    const result = adjudicatePlacement(state, 'test-sprout', 'emberNook');
    expect(result.events.some((e) => e.type === 'habitat:full')).toBe(true);
  });
});

describe('dewdropSystem', () => {
  it('accrues Dewdrops from settled sprouts and flushes whole units', () => {
    let state = createInitialSimState(1);
    state = { ...state, habitats: { emberNook: { id: 'emberNook', count: 3, capacity: 6 } } };
    // baseDewdropRate 0.02/tick/sprout * 3 sprouts = 0.06/tick; needs ~17 ticks to cross 1.0
    let totalEmitted = 0;
    for (let i = 0; i < 20; i += 1) {
      const result = dewdropSystem(state);
      state = result.state;
      for (const e of result.events) if (e.type === 'habitat:dewdropTick') totalEmitted += e.amount;
    }
    expect(totalEmitted).toBeGreaterThan(0);
    expect(state.dewdrops).toBe(totalEmitted);
  });

  it('produces nothing when no habitat has settled sprouts', () => {
    const state = createInitialSimState(1);
    const result = dewdropSystem(state);
    expect(result.events).toEqual([]);
    expect(result.state.dewdrops).toBe(0);
  });
});

describe('unlockSystem (Garden Slide auto-build)', () => {
  it('does nothing below the threshold', () => {
    const state = { ...createInitialSimState(1), correctPlacementCount: UNLOCK_THRESHOLDS.gardenSlide.requiredCorrectPlacements - 1 };
    const result = unlockSystem(state);
    expect(result.events).toEqual([]);
  });

  it('unlocks and auto-builds exactly at the threshold, targeting the most-fed habitat', () => {
    const state = {
      ...createInitialSimState(1),
      correctPlacementCount: UNLOCK_THRESHOLDS.gardenSlide.requiredCorrectPlacements,
      habitats: {
        emberNook: { id: 'emberNook' as const, count: 5, capacity: 6 },
        dewPond: { id: 'dewPond' as const, count: 1, capacity: 6 },
      },
    };
    const result = unlockSystem(state);
    expect(result.events).toEqual([
      { type: 'automation:unlocked', automationId: 'gardenSlide' },
      { type: 'automation:built', automationId: 'gardenSlide', instanceId: 'gardenSlide-1' },
    ]);
    expect(result.state.automations[0].targetHabitatId).toBe('emberNook');
  });

  it('never fires twice', () => {
    let state = { ...createInitialSimState(1), correctPlacementCount: UNLOCK_THRESHOLDS.gardenSlide.requiredCorrectPlacements };
    state = unlockSystem(state).state;
    const second = unlockSystem(state);
    expect(second.events).toEqual([]);
  });
});

describe('purchaseUpgrade', () => {
  it('rejects a purchase with insufficient Dewdrops (no charge, no level change)', () => {
    const state = { ...createInitialSimState(1), dewdrops: 0 };
    const result = purchaseUpgrade(state, 'podRhythm');
    expect(result.events).toEqual([]);
    expect(result.state.dewdrops).toBe(0);
    expect(result.state.upgradeLevels.podRhythm).toBeUndefined();
  });

  it('applies a normal upgrade purchase when affordable', () => {
    const cost = UPGRADES.podRhythm.costForLevel(1);
    const state = { ...createInitialSimState(1), dewdrops: cost };
    const result = purchaseUpgrade(state, 'podRhythm');
    expect(result.state.dewdrops).toBe(0);
    expect(result.state.upgradeLevels.podRhythm).toBe(1);
    expect(result.events.some((e) => e.type === 'upgrade:purchased')).toBe(true);
  });

  it('rejects colourGateUnlock until its behavioral condition is met, even if affordable', () => {
    const cost = UPGRADES.colourGateUnlock.costForLevel(1);
    const state = { ...createInitialSimState(1), dewdrops: cost }; // no gardenSlide built yet
    const result = purchaseUpgrade(state, 'colourGateUnlock');
    expect(result.events).toEqual([]);
    expect(result.state.dewdrops).toBe(cost); // not charged
  });

  it('allows colourGateUnlock once gardenSlide has fed long enough with a real unsorted pile', () => {
    const cost = UPGRADES.colourGateUnlock.costForLevel(1);
    const feedTicks = UNLOCK_THRESHOLDS.colourGate.requiredSingleHabitatFeedTicks ?? 0;
    let state: SimState = {
      ...createInitialSimState(1),
      dewdrops: cost,
      tickCount: feedTicks,
      automations: [
        {
          id: 'gardenSlide-1',
          automationId: 'gardenSlide',
          fromTile: NURSERY_TILE,
          toTile: NURSERY_TILE,
          builtAtTick: 0,
          targetHabitatId: 'emberNook',
          carryingSproutId: null,
          completesAtTick: null,
        },
      ],
    };
    const pileSize = UNLOCK_THRESHOLDS.colourGate.requiredUnsortedPileSize ?? 0;
    for (let i = 0; i < pileSize; i += 1) {
      state = withSprout(state, 'dew', { id: `pile-${i}` });
    }
    const result = purchaseUpgrade(state, 'colourGateUnlock');
    expect(result.events.some((e) => e.type === 'automation:built' && e.automationId === 'colourGate')).toBe(true);
    expect(result.state.dewdrops).toBe(0);
  });
});

describe('automationSystem', () => {
  it('dispatches a matching idle Sprout toward the target habitat and settles it on arrival', () => {
    let state: SimState = {
      ...createInitialSimState(1),
      automations: [
        {
          id: 'gardenSlide-1',
          automationId: 'gardenSlide',
          fromTile: NURSERY_TILE,
          toTile: NURSERY_TILE,
          builtAtTick: 0,
          targetHabitatId: 'emberNook',
          carryingSproutId: null,
          completesAtTick: null,
        },
      ],
    };
    state = withSprout(state, 'ember');

    const started = automationSystem(state);
    expect(started.events.some((e) => e.type === 'sprout:transportStarted')).toBe(true);
    state = started.state;
    expect(state.automations[0].carryingSproutId).toBe('test-sprout');

    let settled = false;
    for (let i = 0; i < 200 && !settled; i += 1) {
      const result = runTick(state, [automationSystem]);
      state = result.state;
      if (result.events.some((e) => e.type === 'sprout:transportCompleted')) settled = true;
    }
    expect(settled).toBe(true);
    expect(state.sprouts[0].state).toBe('settled');
    expect(state.habitats.emberNook?.count).toBe(1);
  });

  it('does not dispatch toward an already-full habitat', () => {
    let state: SimState = {
      ...createInitialSimState(1),
      habitats: { emberNook: { id: 'emberNook', count: 6, capacity: 6 } },
      automations: [
        {
          id: 'gardenSlide-1',
          automationId: 'gardenSlide',
          fromTile: NURSERY_TILE,
          toTile: NURSERY_TILE,
          builtAtTick: 0,
          targetHabitatId: 'emberNook',
          carryingSproutId: null,
          completesAtTick: null,
        },
      ],
    };
    state = withSprout(state, 'ember');
    const result = automationSystem(state);
    expect(result.events).toEqual([]);
    expect(result.state.automations[0].carryingSproutId).toBeNull();
  });
});

describe('checkAchievements', () => {
  it('unlocks firstPlacement exactly once', () => {
    const state = createInitialSimState(1);
    const events = [{ type: 'sprout:placed:correct' as const, sproutId: 'a', habitatId: 'emberNook' as const }];
    const first = checkAchievements(state, events);
    expect(first.events).toEqual([{ type: 'achievement:unlocked', achievementId: 'firstPlacement' }]);
    const second = checkAchievements(first.state, events);
    expect(second.events).toEqual([]);
  });

  it('only unlocks firstRareSprout for a star spawn, not a common one', () => {
    const state = createInitialSimState(1);
    const common = [{ type: 'sprout:spawned' as const, sproutId: 'a', sproutType: 'ember' as const, podId: 'nursery' }];
    expect(checkAchievements(state, common).events).toEqual([]);
    const rare = [{ type: 'sprout:spawned' as const, sproutId: 'b', sproutType: 'star' as const, podId: 'nursery' }];
    expect(checkAchievements(state, rare).events).toEqual([{ type: 'achievement:unlocked', achievementId: 'firstRareSprout' }]);
  });
});
