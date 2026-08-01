// Coverage for src/sim/systems.ts — the gameplay layer that was missing
// from the original Phase 1/2 split (see docs/CONTRACTS.md's history: sim
// shipped a fixed-step shell with no gameplay systems; this file is that
// gap being filled during integration).

import { describe, expect, it } from 'vitest';
import { createInitialSimState, type SimState } from '../../src/sim/state';
import {
  adjudicateAutomationDrop,
  adjudicatePlacement,
  automationSystem,
  checkAchievements,
  colourGateBehavioralState,
  dewdropSystem,
  purchaseUpgrade,
  spawnSystem,
  TICK_SYSTEMS,
  transportDuration,
  transportMsPerTile,
  unlockSystem,
} from '../../src/sim/systems';
import { TICK_MS } from '../../src/sim/loop';
import { runTick } from '../../src/sim/tick';
import { COLOUR_GATE_TILE, HABITAT_TILES, NURSERY_TILE, tileDistance } from '../../src/sim/layout';
import { BASE_POD_SPAWN_INTERVAL_MS } from '../../src/data/spawning';
import { colourGateLockReason, isColourGateUnlocked, UNLOCK_THRESHOLDS } from '../../src/data/unlocks';
import { UPGRADES } from '../../src/data/upgrades';
import { HABITATS } from '../../src/data/habitats';

// Derived, never hardcoded: base capacity is coupled to the Garden Slide
// unlock threshold (see src/data/unlocks.ts), so a balance change to either
// must not quietly invalidate these fixtures.
const CAP = HABITATS.emberNook.baseCapacity;

function withSprout(state: SimState, sproutType: 'ember' | 'dew' | 'sun' | 'star', overrides: Partial<SimState['sprouts'][number]> = {}) {
  return {
    ...state,
    sprouts: [
      ...state.sprouts,
      { id: 'test-sprout', sproutType, mood: 'sunny' as const, tile: NURSERY_TILE, state: 'idle' as const, ...overrides },
    ],
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
    state = { ...state, habitats: { emberNook: { id: 'emberNook', count: CAP, capacity: CAP } } };
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
    state = { ...state, habitats: { emberNook: { id: 'emberNook', count: CAP - 1, capacity: CAP } } };
    state = withSprout(state, 'ember');
    const result = adjudicatePlacement(state, 'test-sprout', 'emberNook');
    expect(result.events.some((e) => e.type === 'habitat:full')).toBe(true);
  });
});

describe('dewdropSystem', () => {
  it('accrues Dewdrops from settled sprouts and flushes whole units', () => {
    let state = createInitialSimState(1);
    const settled = 3;
    state = { ...state, habitats: { emberNook: { id: 'emberNook', count: settled, capacity: CAP } } };
    // Derived, not hardcoded: the accrual rate is a balance value that has
    // already changed once, and pinning a literal tick count here silently
    // turned this assertion into "expected 0 to be greater than 0" rather than
    // reporting a real regression. Run comfortably past the first whole unit.
    const ticksPerWholeDewdrop = 1 / (HABITATS.emberNook.baseDewdropRate * settled);
    const ticks = Math.ceil(ticksPerWholeDewdrop * 2);
    let totalEmitted = 0;
    for (let i = 0; i < ticks; i += 1) {
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

  it('unlocks and auto-builds exactly at the threshold, always targeting Sunflower Meadow', () => {
    // Fed counts on the OTHER two habitats deliberately vary (and outweigh
    // Sunflower Meadow's own 0) to prove the target is fixed, not picked by
    // whichever habitat has been fed most (design decision 2026-07-31: the
    // Colour Gate's fork structurally can't reach Sunflower Meadow, so the
    // Slide always covers it — see unlockSystem's own doc comment).
    const state = {
      ...createInitialSimState(1),
      correctPlacementCount: UNLOCK_THRESHOLDS.gardenSlide.requiredCorrectPlacements,
      habitats: {
        emberNook: { id: 'emberNook' as const, count: CAP - 1, capacity: CAP },
        dewPond: { id: 'dewPond' as const, count: 1, capacity: CAP },
      },
    };
    const result = unlockSystem(state);
    expect(result.events).toEqual([
      { type: 'automation:unlocked', automationId: 'gardenSlide' },
      // targetHabitatId rides along so the renderer can show this Slide as
      // blocked the moment its destination is full — including before it has
      // ever run a delivery (see src/events/types.ts).
      { type: 'automation:built', automationId: 'gardenSlide', instanceId: 'gardenSlide-1', targetHabitatId: 'sunflowerMeadow' },
    ]);
    expect(result.state.automations[0].targetHabitatId).toBe('sunflowerMeadow');
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
      habitats: { emberNook: { id: 'emberNook', count: CAP, capacity: CAP } },
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

// Player report: automation only ever pulled from the Nursery on its own —
// there was no way to hand a Sprout to a built Garden Slide/Colour Gate
// directly. adjudicateAutomationDrop is the immediate (non-tick) reaction to
// a manual drop onto one, called from src/sim/runtime.ts exactly like
// adjudicatePlacement is for a habitat drop.
describe('adjudicateAutomationDrop', () => {
  const slideState = (targetHabitatId: SimState['automations'][number]['targetHabitatId'] = 'emberNook'): SimState => ({
    ...createInitialSimState(1),
    automations: [
      {
        id: 'gardenSlide-1',
        automationId: 'gardenSlide',
        fromTile: NURSERY_TILE,
        toTile: NURSERY_TILE,
        builtAtTick: 0,
        targetHabitatId,
        carryingSproutId: null,
        completesAtTick: null,
      },
    ],
  });

  it('boards a matching Sprout immediately, exactly like the automation would on its own next tick', () => {
    const state = withSprout(slideState(), 'ember');
    const result = adjudicateAutomationDrop(state, 'test-sprout', 'gardenSlide');
    expect(result.events).toEqual([
      expect.objectContaining({ type: 'sprout:transportStarted', sproutId: 'test-sprout', automationId: 'gardenSlide' }),
    ]);
    expect(result.state.automations[0].carryingSproutId).toBe('test-sprout');
    expect(result.state.sprouts[0].state).toBe('transporting');
  });

  it('declines a wrong-kind Sprout without moving it, never punitive', () => {
    const state = withSprout(slideState(), 'dew');
    const result = adjudicateAutomationDrop(state, 'test-sprout', 'gardenSlide');
    expect(result.events).toEqual([
      { type: 'sprout:automationDeclined', sproutId: 'test-sprout', automationId: 'gardenSlide', reason: 'wrongKind' },
    ]);
    expect(result.state.sprouts[0].state).toBe('idle'); // untouched — still exactly where it was, still pickable
    expect(result.state.automations[0].carryingSproutId).toBeNull();
  });

  it('declines when the destination habitat is already full', () => {
    let state = withSprout(slideState(), 'ember');
    state = { ...state, habitats: { emberNook: { id: 'emberNook', count: CAP, capacity: CAP } } };
    const result = adjudicateAutomationDrop(state, 'test-sprout', 'gardenSlide');
    expect(result.events).toEqual([
      { type: 'sprout:automationDeclined', sproutId: 'test-sprout', automationId: 'gardenSlide', reason: 'destinationFull' },
    ]);
  });

  it('declines when the automation is already carrying someone', () => {
    let state = withSprout(slideState(), 'ember', { id: 'other-sprout' });
    state = withSprout(state, 'ember');
    state = { ...state, automations: [{ ...state.automations[0], carryingSproutId: 'other-sprout' }] };
    const result = adjudicateAutomationDrop(state, 'test-sprout', 'gardenSlide');
    expect(result.events).toEqual([
      { type: 'sprout:automationDeclined', sproutId: 'test-sprout', automationId: 'gardenSlide', reason: 'busy' },
    ]);
  });

  it('declines onto a Garden Slide with no route yet (targetHabitatId unset)', () => {
    let state = withSprout(slideState(), 'ember');
    state = { ...state, automations: [{ ...state.automations[0], targetHabitatId: undefined }] };
    const result = adjudicateAutomationDrop(state, 'test-sprout', 'gardenSlide');
    expect(result.events).toEqual([
      { type: 'sprout:automationDeclined', sproutId: 'test-sprout', automationId: 'gardenSlide', reason: 'noRoute' },
    ]);
  });

  it('no-ops (no event) for a Sprout that is not idle — a stray/late drop cannot double-board it', () => {
    const state = withSprout(slideState(), 'ember', { state: 'transporting' });
    const result = adjudicateAutomationDrop(state, 'test-sprout', 'gardenSlide');
    expect(result.events).toEqual([]);
    expect(result.state).toBe(state); // untouched
  });

  it('declines a drop onto an automation that was never built', () => {
    const state = withSprout(createInitialSimState(1), 'ember');
    const result = adjudicateAutomationDrop(state, 'test-sprout', 'gardenSlide');
    expect(result.events).toEqual([
      { type: 'sprout:automationDeclined', sproutId: 'test-sprout', automationId: 'gardenSlide', reason: 'notBuilt' },
    ]);
  });

  it('boards a Colour Gate drop onto leg 1 (Nursery -> Gate) for a Sprout waiting anywhere but the Gate', () => {
    let state = createInitialSimState(1);
    state = {
      ...state,
      colourGateLanes: { west: 'ember', east: null },
      automations: [
        {
          id: 'colourGate-1',
          automationId: 'colourGate',
          fromTile: NURSERY_TILE,
          toTile: COLOUR_GATE_TILE,
          builtAtTick: 0,
          carryingSproutId: null,
          completesAtTick: null,
        },
      ],
    };
    state = withSprout(state, 'ember');
    const result = adjudicateAutomationDrop(state, 'test-sprout', 'colourGate');
    expect(result.events).toEqual([
      expect.objectContaining({
        type: 'sprout:transportStarted',
        sproutId: 'test-sprout',
        automationId: 'colourGate',
        toTile: COLOUR_GATE_TILE,
      }),
    ]);
  });

  it('boards a Colour Gate drop onto leg 2 (Gate -> home) for a Sprout already standing at the signpost', () => {
    let state = createInitialSimState(1);
    state = {
      ...state,
      colourGateLanes: { west: 'ember', east: null },
      automations: [
        {
          id: 'colourGate-1',
          automationId: 'colourGate',
          fromTile: NURSERY_TILE,
          toTile: COLOUR_GATE_TILE,
          builtAtTick: 0,
          carryingSproutId: null,
          completesAtTick: null,
        },
      ],
    };
    state = withSprout(state, 'ember', { tile: COLOUR_GATE_TILE });
    const result = adjudicateAutomationDrop(state, 'test-sprout', 'colourGate');
    expect(result.events).toEqual([
      expect.objectContaining({
        type: 'sprout:transportStarted',
        sproutId: 'test-sprout',
        automationId: 'colourGate',
        toTile: HABITAT_TILES.emberNook,
      }),
    ]);
  });

  it('declines a Colour Gate drop for a kind no lane invites', () => {
    let state = createInitialSimState(1);
    state = {
      ...state,
      colourGateLanes: { west: null, east: null },
      automations: [
        {
          id: 'colourGate-1',
          automationId: 'colourGate',
          fromTile: NURSERY_TILE,
          toTile: COLOUR_GATE_TILE,
          builtAtTick: 0,
          carryingSproutId: null,
          completesAtTick: null,
        },
      ],
    };
    state = withSprout(state, 'sun');
    const result = adjudicateAutomationDrop(state, 'test-sprout', 'colourGate');
    expect(result.events).toEqual([
      { type: 'sprout:automationDeclined', sproutId: 'test-sprout', automationId: 'colourGate', reason: 'wrongKind' },
    ]);
  });
});

// The renderer used to derive its own ride duration from its own copy of the
// 420ms-per-tile constant, so the Garden Slide Speed upgrade (applied only
// here, in sim) changed WHEN a Sprout settled without changing how fast it
// looked like it was travelling — the upgrade had no visible effect and the
// two clocks drifted apart with every level (GameRules §8.3 forbids an upgrade
// that doesn't visibly affect the garden). The fix makes sim the single
// authority by putting the resolved duration on `sprout:transportStarted`;
// these tests pin that contract.
describe('transport duration (sim is the single authority)', () => {
  const slide = (): SimState['automations'][number] => ({
    id: 'gardenSlide-1',
    automationId: 'gardenSlide',
    fromTile: NURSERY_TILE,
    toTile: HABITAT_TILES.emberNook,
    builtAtTick: 0,
    targetHabitatId: 'emberNook',
    carryingSproutId: null,
    completesAtTick: null,
  });

  it('reports a whole number of ticks, and a durationMs that is exactly those ticks', () => {
    const distance = tileDistance(NURSERY_TILE, HABITAT_TILES.emberNook);
    const { durationTicks, durationMs } = transportDuration(slide(), {}, distance);
    expect(Number.isInteger(durationTicks)).toBe(true);
    expect(durationTicks).toBeGreaterThanOrEqual(1);
    expect(durationMs).toBe(durationTicks * TICK_MS);
  });

  it('shortens with every gardenSlideSpeed level, by the upgrade’s own magnitude', () => {
    const distance = tileDistance(NURSERY_TILE, HABITAT_TILES.emberNook);
    const base = transportMsPerTile(slide(), {});
    const magnitude = UPGRADES.gardenSlideSpeed.effect.magnitudePerLevel;
    let previous = transportDuration(slide(), {}, distance).durationMs;
    for (let level = 1; level <= UPGRADES.gardenSlideSpeed.maxLevel; level += 1) {
      expect(transportMsPerTile(slide(), { gardenSlideSpeed: level })).toBeCloseTo(base * (1 - magnitude) ** level, 6);
      const current = transportDuration(slide(), { gardenSlideSpeed: level }, distance).durationMs;
      expect(current).toBeLessThan(previous);
      previous = current;
    }
  });

  it('leaves the Colour Gate alone — the speed upgrade is the Slide’s', () => {
    const gate: SimState['automations'][number] = { ...slide(), id: 'colourGate-1', automationId: 'colourGate', targetHabitatId: undefined };
    expect(transportMsPerTile(gate, { gardenSlideSpeed: 3 })).toBe(transportMsPerTile(gate, {}));
  });

  it('emits a durationMs on sprout:transportStarted that matches when the sim will actually settle the Sprout', () => {
    for (const level of [0, UPGRADES.gardenSlideSpeed.maxLevel]) {
      let state: SimState = {
        ...createInitialSimState(1),
        upgradeLevels: { gardenSlideSpeed: level },
        automations: [slide()],
      };
      state = withSprout(state, 'ember');

      // Started through runTick, exactly as the live loop does, so the tick
      // accounting below is the real thing rather than an off-by-one fixture.
      const startedAtTick = state.tickCount;
      const result = runTick(state, [automationSystem]);
      const started = result.events.find((e) => e.type === 'sprout:transportStarted');
      expect(started).toBeDefined();
      if (started?.type !== 'sprout:transportStarted') throw new Error('unreachable');

      const completesAtTick = result.state.automations[0].completesAtTick;
      expect(completesAtTick).not.toBeNull();
      // The renderer animates over exactly `durationMs`; the sim settles at
      // `completesAtTick`. If these ever disagree the animation and the
      // gameplay drift apart again.
      expect(started.durationMs).toBe(((completesAtTick as number) - startedAtTick) * TICK_MS);

      // And the ride really does take that long when ticked forward.
      let ticksRun = 0;
      let done = false;
      let ticking = result.state;
      while (!done && ticksRun < 500) {
        const tick = runTick(ticking, [automationSystem]);
        ticking = tick.state;
        ticksRun += 1;
        if (tick.events.some((e) => e.type === 'sprout:transportCompleted')) done = true;
      }
      expect(done).toBe(true);
      expect(ticksRun * TICK_MS).toBe(started.durationMs);
    }
  });

  it('makes the fully upgraded Slide measurably faster end-to-end, not just on paper', () => {
    const distance = tileDistance(NURSERY_TILE, HABITAT_TILES.emberNook);
    const slow = transportDuration(slide(), {}, distance).durationMs;
    const fast = transportDuration(slide(), { gardenSlideSpeed: UPGRADES.gardenSlideSpeed.maxLevel }, distance).durationMs;
    expect(fast).toBeLessThan(slow * 0.7);
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
    const common = [
      { type: 'sprout:spawned' as const, sproutId: 'a', sproutType: 'ember' as const, mood: 'sunny' as const, podId: 'nursery' },
    ];
    expect(checkAchievements(state, common).events).toEqual([]);
    const rare = [
      { type: 'sprout:spawned' as const, sproutId: 'b', sproutType: 'star' as const, mood: 'sunny' as const, podId: 'nursery' },
    ];
    expect(checkAchievements(state, rare).events).toEqual([{ type: 'achievement:unlocked', achievementId: 'firstRareSprout' }]);
  });
});

// Reachability of the whole Phase 1 automation chain. GameRules.md §16
// ("Definition of Done") requires a player to unlock, place and observe both
// the Garden Slide and the Colour Gate; §9 requires each automation to unlock
// only after the player has felt the problem it solves. Those two pull in
// opposite directions, and the Colour Gate's gate is behavioral rather than a
// simple price, so "can this actually be reached by playing?" is not obvious
// from reading the thresholds. This drives the real systems forward and
// asserts it, rather than reasoning about it.
describe('automation chain reachability (GameRules.md §9, §16)', () => {
  it('reaches the Garden Slide by settling Sprouts, then the Colour Gate by playing on', () => {
    let state = createInitialSimState(7);

    // Manual placements unlock the Garden Slide, which then auto-builds.
    // Spread across all three homes the way a player must: one habitat alone
    // fills long before the threshold, which is the whole point of the
    // capacity-vs-threshold coupling documented in data/unlocks.ts.
    const needed = UNLOCK_THRESHOLDS.gardenSlide.requiredCorrectPlacements;
    const homes = [
      ['emberNook', 'ember'],
      ['dewPond', 'dew'],
      ['sunflowerMeadow', 'sun'],
    ] as const;
    for (let i = 0; i < needed; i += 1) {
      const [habitat, type] = homes[i % homes.length];
      state = withSprout(state, type, { id: `manual-${i}` });
      state = adjudicatePlacement(state, `manual-${i}`, habitat).state;
    }
    expect(state.correctPlacementCount).toBe(needed); // no placement silently refused by a full home
    state = unlockSystem(state).state;

    expect(state.unlockedAutomations).toContain('gardenSlide');
    const slide = state.automations.find((a) => a.automationId === 'gardenSlide');
    expect(slide).toBeDefined();
    // Without a target the Colour Gate's pile check divides the world into
    // "fed type" vs "everything else" against `undefined`, and can never arm.
    expect(slide?.targetHabitatId).toBeDefined();

    // Now just let the garden run: pods keep spawning mixed types, the Slide
    // only carries its one type, so the others accumulate unsorted.
    state = { ...state, dewdrops: 10_000 };
    let becameUnlockable = false;
    for (let tick = 0; tick < 6_000 && !becameUnlockable; tick += 1) {
      state = runTick(state, TICK_SYSTEMS).state;
      becameUnlockable = isColourGateUnlocked(colourGateBehavioralState(state));
    }

    expect(becameUnlockable).toBe(true);
    expect(colourGateLockReason(colourGateBehavioralState(state))).toBeNull();

    // And the purchase must actually go through once it is unlockable.
    const purchased = purchaseUpgrade(state, 'colourGateUnlock').state;
    expect(purchased.upgradeLevels.colourGateUnlock).toBe(1);
    expect(purchased.unlockedAutomations).toContain('colourGate');
    expect(purchased.automations.some((a) => a.automationId === 'colourGate')).toBe(true);
  });

  it('explains the Colour Gate lock instead of silently refusing, until it is armed', () => {
    const fresh = createInitialSimState(3);
    // No Slide yet: must be both locked and explained.
    expect(isColourGateUnlocked(colourGateBehavioralState(fresh))).toBe(false);
    expect(colourGateLockReason(colourGateBehavioralState(fresh))).toBeTruthy();
    // And a purchase attempt must not silently consume Dewdrops.
    const attempted = purchaseUpgrade({ ...fresh, dewdrops: 10_000 }, 'colourGateUnlock').state;
    expect(attempted.dewdrops).toBe(10_000);
    expect(attempted.upgradeLevels.colourGateUnlock ?? 0).toBe(0);
  });
});
