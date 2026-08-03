// src/ui/uiState.ts mirrors bus events into the plain state object every UI
// panel reads from — HUD, Upgrades, Journal, Achievements, and the "welcome
// back" return dialog all trust this reducer to be correct. It had no direct
// unit test; the risk worth covering is the `save:loaded` -> lastOfflineReturn
// conditional (returnDialog.ts deliberately never opens for a 0-Dewdrop
// offline return, per its own top-of-file comment — this is where that
// guarantee actually lives) plus the accumulating Set fields.
import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/events/bus';
import { createUiStateStore } from '../../src/ui/uiState';

describe('uiState store', () => {
  it('starts with sensible empty defaults', () => {
    const store = createUiStateStore(new EventBus());
    const state = store.getState();
    expect(state.dewdropTotal).toBe(0);
    expect(state.correctPlacementCount).toBe(0);
    expect(state.unlockedAutomations.size).toBe(0);
    expect(state.unlockedAchievements.size).toBe(0);
    expect(state.journalDiscovered.size).toBe(0);
    expect(state.lastOfflineReturn).toBeUndefined();
  });

  it('mirrors currency:dewdropsChanged into dewdropTotal', () => {
    const bus = new EventBus();
    const store = createUiStateStore(bus);
    bus.emit({ type: 'currency:dewdropsChanged', total: 42, delta: 42 });
    expect(store.getState().dewdropTotal).toBe(42);
  });

  it('tracks correct-placement progress for the Garden Slide unlock', () => {
    const bus = new EventBus();
    const store = createUiStateStore(bus);
    bus.emit({ type: 'sprout:placed:correct', sproutId: 'sprout-1', habitatId: 'emberNook', habitatInstanceId: 'emberNook-1' });
    bus.emit({ type: 'sprout:placed:correct', sproutId: 'sprout-2', habitatId: 'dewPond', habitatInstanceId: 'dewPond-1' });
    expect(store.getState().correctPlacementCount).toBe(2);
  });

  it('accumulates unlockedAutomations, upgradeLevels, unlockedAchievements, and journalDiscovered', () => {
    const bus = new EventBus();
    const store = createUiStateStore(bus);

    bus.emit({ type: 'automation:unlocked', automationId: 'gardenSlide' });
    bus.emit({ type: 'automation:unlocked', automationId: 'colourGate' });
    bus.emit({ type: 'upgrade:purchased', upgradeId: 'podRhythm', level: 1 });
    bus.emit({ type: 'achievement:unlocked', achievementId: 'firstPlacement' });
    bus.emit({ type: 'journal:entryDiscovered', sproutType: 'ember' });
    bus.emit({ type: 'journal:entryDiscovered', sproutType: 'star' });

    const state = store.getState();
    expect([...state.unlockedAutomations].sort()).toEqual(['colourGate', 'gardenSlide']);
    expect(state.upgradeLevels.podRhythm).toBe(1);
    expect(state.unlockedAchievements.has('firstPlacement')).toBe(true);
    expect(state.lastAchievementUnlocked).toBe('firstPlacement');
    expect([...state.journalDiscovered].sort()).toEqual(['ember', 'star']);
  });

  it('tracks lastBuiltAutomation on automation:built', () => {
    const bus = new EventBus();
    const store = createUiStateStore(bus);
    bus.emit({ type: 'automation:built', automationId: 'gardenSlide', instanceId: 'gardenSlide-1', siteTile: { x: 8, z: 7 } });
    expect(store.getState().lastBuiltAutomation).toBe('gardenSlide');
  });

  it('tracks paid transit counts, refunds, and save hydration', () => {
    const bus = new EventBus();
    const store = createUiStateStore(bus);
    bus.emit({ type: 'transit:slideBuilt', slide: { id: 'slide-1', tile: { x: 8, z: 7 }, acceptedKind: 'any', destination: 'sunflowerMeadow', enabled: true, builtAtTick: 0 }, entryPort: { ownerId: 'slide-1', kind: 'entry', tile: { x: 8, z: 7 }, facing: 'south', compatibility: 'transit' }, exitPort: { ownerId: 'slide-1', kind: 'exit', tile: { x: 8, z: 7 }, facing: 'north', compatibility: 'transit' } });
    expect(store.getState().transitSlides).toEqual([
      { id: 'slide-1', tile: { x: 8, z: 7 }, acceptedKind: 'any', destination: 'sunflowerMeadow', enabled: true },
    ]);
    bus.emit({ type: 'transit:slideConfigured', slide: { id: 'slide-1', tile: { x: 8, z: 7 }, acceptedKind: 'dew', destination: 'dewPond', enabled: false, builtAtTick: 0 }, entryPort: { ownerId: 'slide-1', kind: 'entry', tile: { x: 8, z: 7 }, facing: 'south', compatibility: 'transit' }, exitPort: { ownerId: 'slide-1', kind: 'exit', tile: { x: 8, z: 7 }, facing: 'north', compatibility: 'transit' } });
    expect(store.getState().transitSlides[0]).toMatchObject({ acceptedKind: 'dew', destination: 'dewPond', enabled: false });
    bus.emit({ type: 'transit:conveyorBuilt', conveyor: { id: 'conveyor-1', tile: { x: 7, z: 8 }, builtAtTick: 0 }, entryPort: { ownerId: 'conveyor-1', kind: 'entry', tile: { x: 7, z: 8 }, facing: 'south', compatibility: 'transit' }, exitPort: { ownerId: 'conveyor-1', kind: 'exit', tile: { x: 7, z: 8 }, facing: 'north', compatibility: 'transit' } });
    expect(store.getState().transitCounts).toEqual({ gardenSlide: 1, sproutConveyor: 1 });
    bus.emit({ type: 'transit:artifactRemoved', artifactId: 'conveyor-1', artifactKind: 'sproutConveyor', refund: 15 });
    expect(store.getState().transitCounts.sproutConveyor).toBe(0);

    bus.emit({
      type: 'save:loaded',
      offlineSeconds: 0,
      offlineDewdrops: 0,
      snapshot: {
        dewdrops: 100,
        unlockedAutomations: ['gardenSlide'],
        upgradeLevels: {},
        unlockedAchievements: [],
        journalDiscovered: [],
        slides: [{ id: 'slide-2', tile: { x: 7, z: 6 } }, { id: 'slide-3', tile: { x: 9, z: 6 } }],
        conveyors: [{ id: 'conveyor-2', tile: { x: 7, z: 9 } }],
      },
    });
    expect(store.getState().transitCounts).toEqual({ gardenSlide: 2, sproutConveyor: 1 });
  });

  it('keeps the latest transit recovery visible to the configuration panel', () => {
    const bus = new EventBus();
    const store = createUiStateStore(bus);
    bus.emit({
      type: 'sprout:transportReturned',
      sproutId: 'ember-1',
      automationId: 'gardenSlide',
      instanceId: 'slide-1',
      tile: { x: 8, z: 8 },
      reason: 'disabled',
    });
    expect(store.getState().lastTransitRecovery).toEqual({ sproutId: 'ember-1', tile: { x: 8, z: 8 }, reason: 'disabled' });
  });

  it('starts with the three original habitat instances and no full kind', () => {
    const store = createUiStateStore(new EventBus());
    const state = store.getState();
    expect(state.habitatInstanceCounts).toEqual({ emberNook: 1, dewPond: 1, sunflowerMeadow: 1 });
    expect(state.habitatFullKinds.size).toBe(0);
  });

  it('increments the kind count on habitat:built and marks the kind buildable on habitat:full', () => {
    const bus = new EventBus();
    const store = createUiStateStore(bus);
    bus.emit({ type: 'habitat:full', habitatId: 'emberNook', habitatInstanceId: 'emberNook-1' });
    expect([...store.getState().habitatFullKinds]).toEqual(['emberNook']);

    bus.emit({ type: 'habitat:built', habitatId: 'emberNook', habitatInstanceId: 'emberNook-2', tile: { x: 5, z: 6 }, cost: 500 });
    expect(store.getState().habitatInstanceCounts.emberNook).toBe(2);
  });

  it('clears the full-now gate for every kind when habitatCapacity is purchased (a capacity upgrade reopens room in all instances at once)', () => {
    const bus = new EventBus();
    const store = createUiStateStore(bus);
    bus.emit({ type: 'habitat:full', habitatId: 'emberNook', habitatInstanceId: 'emberNook-1' });
    bus.emit({ type: 'upgrade:purchased', upgradeId: 'habitatCapacity', level: 1 });
    expect(store.getState().habitatFullKinds.size).toBe(0);
  });

  it('keeps the full-now gate across an unrelated upgrade purchase', () => {
    const bus = new EventBus();
    const store = createUiStateStore(bus);
    bus.emit({ type: 'habitat:full', habitatId: 'dewPond', habitatInstanceId: 'dewPond-1' });
    bus.emit({ type: 'upgrade:purchased', upgradeId: 'podRhythm', level: 1 });
    expect([...store.getState().habitatFullKinds]).toEqual(['dewPond']);
  });

  it('hydrates habitat instance counts and full kinds from the save:loaded snapshot', () => {
    const bus = new EventBus();
    const store = createUiStateStore(bus);
    bus.emit({
      type: 'save:loaded',
      offlineSeconds: 0,
      offlineDewdrops: 0,
      snapshot: {
        dewdrops: 0,
        unlockedAutomations: [],
        upgradeLevels: {},
        unlockedAchievements: [],
        journalDiscovered: [],
        habitatInstances: [
          { id: 'emberNook-1', habitatId: 'emberNook', tile: { x: 4, z: 4 }, count: 8 },
          { id: 'emberNook-2', habitatId: 'emberNook', tile: { x: 5, z: 6 }, count: 3 },
          { id: 'dewPond-1', habitatId: 'dewPond', tile: { x: 12, z: 4 }, count: 0 },
        ],
        fullHabitatInstances: ['emberNook-1'],
      },
    });
    const state = store.getState();
    expect(state.habitatInstanceCounts.emberNook).toBe(2);
    expect(state.habitatInstanceCounts.dewPond).toBe(1);
    expect([...state.habitatFullKinds]).toEqual(['emberNook']);
  });

  it('sets lastOfflineReturn when save:loaded reports positive offline Dewdrops', () => {
    const bus = new EventBus();
    const store = createUiStateStore(bus);
    const emptySnapshot = { dewdrops: 0, unlockedAutomations: [], upgradeLevels: {}, unlockedAchievements: [], journalDiscovered: [] };
    bus.emit({ type: 'save:loaded', offlineSeconds: 120, offlineDewdrops: 30, snapshot: emptySnapshot });
    expect(store.getState().lastOfflineReturn).toEqual({ offlineSeconds: 120, offlineDewdrops: 30 });
  });

  it('does NOT set lastOfflineReturn when save:loaded reports zero offline Dewdrops (a fresh save has nothing to welcome back from)', () => {
    const bus = new EventBus();
    const store = createUiStateStore(bus);
    const emptySnapshot = { dewdrops: 0, unlockedAutomations: [], upgradeLevels: {}, unlockedAchievements: [], journalDiscovered: [] };
    bus.emit({ type: 'save:loaded', offlineSeconds: 0, offlineDewdrops: 0, snapshot: emptySnapshot });
    expect(store.getState().lastOfflineReturn).toBeUndefined();
  });

  it('does not clobber a previous positive lastOfflineReturn with a later zero-Dewdrop save:loaded', () => {
    const bus = new EventBus();
    const store = createUiStateStore(bus);
    const emptySnapshot = { dewdrops: 0, unlockedAutomations: [], upgradeLevels: {}, unlockedAchievements: [], journalDiscovered: [] };
    bus.emit({ type: 'save:loaded', offlineSeconds: 60, offlineDewdrops: 10, snapshot: emptySnapshot });
    bus.emit({ type: 'save:loaded', offlineSeconds: 5, offlineDewdrops: 0, snapshot: emptySnapshot });
    expect(store.getState().lastOfflineReturn).toEqual({ offlineSeconds: 60, offlineDewdrops: 10 });
  });

  it('hydrates dewdropTotal/unlocks/upgrades/achievements/journal silently from save:loaded snapshot, without replaying celebratory fields', () => {
    const bus = new EventBus();
    const store = createUiStateStore(bus);
    bus.emit({
      type: 'save:loaded',
      offlineSeconds: 0,
      offlineDewdrops: 0,
      snapshot: {
        dewdrops: 250,
        unlockedAutomations: ['gardenSlide'],
        upgradeLevels: { podRhythm: 2 },
        unlockedAchievements: ['firstPlacement', 'firstAutomation'],
        journalDiscovered: ['ember', 'star'],
      },
    });
    const state = store.getState();
    expect(state.dewdropTotal).toBe(250);
    expect([...state.unlockedAutomations]).toEqual(['gardenSlide']);
    expect(state.upgradeLevels.podRhythm).toBe(2);
    expect([...state.unlockedAchievements].sort()).toEqual(['firstAutomation', 'firstPlacement']);
    expect([...state.journalDiscovered].sort()).toEqual(['ember', 'star']);
    // Hydration must not look like a fresh event — no toast/build-flash for old history.
    expect(state.lastAchievementUnlocked).toBeUndefined();
    expect(state.lastBuiltAutomation).toBeUndefined();
  });

  it('notifies subscribers on every mirrored event and stops after unsubscribe', () => {
    const bus = new EventBus();
    const store = createUiStateStore(bus);
    let calls = 0;
    const unsubscribe = store.subscribe(() => {
      calls += 1;
    });
    bus.emit({ type: 'currency:dewdropsChanged', total: 1, delta: 1 });
    expect(calls).toBe(1);
    unsubscribe();
    bus.emit({ type: 'currency:dewdropsChanged', total: 2, delta: 1 });
    expect(calls).toBe(1);
  });

  it('dispose() detaches from the bus so further events no longer update state', () => {
    const bus = new EventBus();
    const store = createUiStateStore(bus);
    store.dispose();
    bus.emit({ type: 'currency:dewdropsChanged', total: 99, delta: 99 });
    expect(store.getState().dewdropTotal).toBe(0);
  });
});
