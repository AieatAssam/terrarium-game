// Mirrors relevant GameEvent traffic into plain UI-facing state. UI
// components read this instead of reaching into sim/render internals —
// "No system reaches into another system's internal state" (CONTRACTS.md).
// Levels/counts here start at sensible zero defaults and are only ever
// advanced by the corresponding bus event, never optimistically by a click
// handler — so the UI can never show progress the sim hasn't confirmed.

import type { AchievementId, AutomationId, SproutTypeId, UpgradeId } from '../core/ids';
import type { EventBus, GameEvent } from '../events';

export interface OfflineReturnInfo {
  offlineSeconds: number;
  offlineDewdrops: number;
}

export interface UiState {
  dewdropTotal: number;
  unlockedAutomations: Set<AutomationId>;
  upgradeLevels: Partial<Record<UpgradeId, number>>;
  unlockedAchievements: Set<AchievementId>;
  journalDiscovered: Set<SproutTypeId>;
  lastOfflineReturn: OfflineReturnInfo | undefined;
  lastAchievementUnlocked: AchievementId | undefined;
  lastBuiltAutomation: AutomationId | undefined;
}

export type UiStateListener = (state: UiState) => void;

export interface UiStateStore {
  getState(): UiState;
  subscribe(listener: UiStateListener): () => void;
  dispose(): void;
}

function createInitialState(): UiState {
  return {
    dewdropTotal: 0,
    unlockedAutomations: new Set(),
    upgradeLevels: {},
    unlockedAchievements: new Set(),
    journalDiscovered: new Set(),
    lastOfflineReturn: undefined,
    lastAchievementUnlocked: undefined,
    lastBuiltAutomation: undefined,
  };
}

export function createUiStateStore(bus: EventBus): UiStateStore {
  let state = createInitialState();
  const listeners = new Set<UiStateListener>();

  function notify(): void {
    for (const listener of listeners) listener(state);
  }

  function on<T extends GameEvent['type']>(
    type: T,
    reducer: (prev: UiState, event: Extract<GameEvent, { type: T }>) => UiState,
  ): () => void {
    return bus.subscribe(type, (event) => {
      state = reducer(state, event);
      notify();
    });
  }

  const unsubscribers: Array<() => void> = [
    on('currency:dewdropsChanged', (prev, event) => ({ ...prev, dewdropTotal: event.total })),
    on('automation:unlocked', (prev, event) => ({
      ...prev,
      unlockedAutomations: new Set(prev.unlockedAutomations).add(event.automationId),
    })),
    on('automation:built', (prev, event) => ({ ...prev, lastBuiltAutomation: event.automationId })),
    on('upgrade:purchased', (prev, event) => ({
      ...prev,
      upgradeLevels: { ...prev.upgradeLevels, [event.upgradeId]: event.level },
    })),
    on('achievement:unlocked', (prev, event) => ({
      ...prev,
      unlockedAchievements: new Set(prev.unlockedAchievements).add(event.achievementId),
      lastAchievementUnlocked: event.achievementId,
    })),
    on('journal:entryDiscovered', (prev, event) => ({
      ...prev,
      journalDiscovered: new Set(prev.journalDiscovered).add(event.sproutType),
    })),
    on('save:loaded', (prev, event) => ({
      ...prev,
      // Silent hydration from the restored save — deliberately does NOT
      // touch lastAchievementUnlocked/lastBuiltAutomation, so old history
      // doesn't replay a toast/SFX on load (see the GameEvent doc comment
      // on save:loaded's snapshot field).
      dewdropTotal: event.snapshot.dewdrops,
      unlockedAutomations: new Set(event.snapshot.unlockedAutomations),
      upgradeLevels: { ...event.snapshot.upgradeLevels },
      unlockedAchievements: new Set(event.snapshot.unlockedAchievements),
      journalDiscovered: new Set(event.snapshot.journalDiscovered),
      lastOfflineReturn:
        event.offlineDewdrops > 0
          ? { offlineSeconds: event.offlineSeconds, offlineDewdrops: event.offlineDewdrops }
          : prev.lastOfflineReturn,
    })),
  ];

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      for (const unsubscribe of unsubscribers) unsubscribe();
      listeners.clear();
    },
  };
}
