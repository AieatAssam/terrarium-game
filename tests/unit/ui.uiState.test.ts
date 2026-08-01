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
