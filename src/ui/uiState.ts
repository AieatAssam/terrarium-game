// Mirrors relevant GameEvent traffic into plain UI-facing state. UI
// components read this instead of reaching into sim/render internals —
// "No system reaches into another system's internal state" (CONTRACTS.md).
// Levels/counts here start at sensible zero defaults and are only ever
// advanced by the corresponding bus event, never optimistically by a click
// handler — so the UI can never show progress the sim hasn't confirmed.

import type { AchievementId, AutomationId, HabitatId, MoodId, SproutTypeId, UpgradeId } from '../core/ids';
import type { PricedTransitKind } from '../data/transit';
import type { EventBus, GameEvent } from '../events';

export interface OfflineReturnInfo {
  offlineSeconds: number;
  offlineDewdrops: number;
}

/** Mirrors SimState.colourGateLanes — which Sprout kind each Gate lane invites. */
export interface ColourGateLaneState {
  west: SproutTypeId | null;
  east: SproutTypeId | null;
}

export interface UiState {
  dewdropTotal: number;
  unlockedAutomations: Set<AutomationId>;
  /**
   * Automations that are actually PLACED (2026-08-01, manual placement —
   * GameRules §9.8), a strict subset of `unlockedAutomations`. Distinct
   * because unlocking no longer builds: an automation can sit unlocked
   * but unplaced. The build menu (src/ui/components/buildMenu.ts) uses
   * this to stop offering a "place me" button for something already built.
   */
  placedAutomations: Set<AutomationId>;
  /** Counts of paid Transit artifacts currently owned, used by the build menu. */
  transitCounts: Record<PricedTransitKind, number>;
  upgradeLevels: Partial<Record<UpgradeId, number>>;
  unlockedAchievements: Set<AchievementId>;
  journalDiscovered: Set<SproutTypeId>;
  lastOfflineReturn: OfflineReturnInfo | undefined;
  lastAchievementUnlocked: AchievementId | undefined;
  lastBuiltAutomation: AutomationId | undefined;
  /** The Colour Gate's active rule (GameRules §9.4: it must visibly show it). */
  colourGateLanes: ColourGateLaneState;
  /** The Mood Bell's active rule — which mood it currently welcomes. */
  moodBellRule: MoodId;
  /**
   * Standing habitat INSTANCES per kind (Phase 2 — the three originals plus
   * any the player built). The build menu reads this to show the escalating
   * cost of a kind's NEXT home (habitatBuildCost). Seeded at 1 per kind by
   * `createInitialState` because the originals always exist, then advanced by
   * `habitat:built` and hydrated from the save:loaded snapshot.
   */
  habitatInstanceCounts: Partial<Record<HabitatId, number>>;
  /**
   * Kinds with at least one instance CURRENTLY at capacity — the full-now
   * gate GameRules §10.0 and `placeHabitat` (src/sim/systems.ts) require
   * before a second home of that kind may be built. The build menu shows a
   * "build another" button per kind in this set. Tracked from `habitat:full`
   * events plus the save:loaded snapshot's `fullHabitatInstances`; cleared
   * when the habitatCapacity upgrade reopens room in every instance of a
   * kind (a capacity upgrade can turn a formerly-full home un-full again).
   */
  habitatFullKinds: Set<HabitatId>;
  /** How briskly the Nursery pod is opening, and how many little ones are waiting. */
  nurseryRhythm: 'lively' | 'easing' | 'resting';
  waitingSproutCount: number;
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
    placedAutomations: new Set(),
    transitCounts: { gardenSlide: 0, sproutConveyor: 0 },
    upgradeLevels: {},
    unlockedAchievements: new Set(),
    journalDiscovered: new Set(),
    lastOfflineReturn: undefined,
    lastAchievementUnlocked: undefined,
    lastBuiltAutomation: undefined,
    // Matches the Gate's own safe default (src/sim/layout.ts) so the panel
    // never flashes an empty rule between mount and the first event.
    colourGateLanes: { west: 'ember', east: 'dew' },
    // Matches the Bell's own safe default (src/sim/state.ts) so the panel
    // never flashes a wrong rule between mount and the first event.
    moodBellRule: 'sunny',
    // The three originals always stand (seeded in createInitialSimState).
    habitatInstanceCounts: { emberNook: 1, dewPond: 1, sunflowerMeadow: 1 },
    habitatFullKinds: new Set(),
    nurseryRhythm: 'lively',
    waitingSproutCount: 0,
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
    on('automation:built', (prev, event) => ({
      ...prev,
      lastBuiltAutomation: event.automationId,
      placedAutomations: new Set(prev.placedAutomations).add(event.automationId),
    })),
    on('transit:slideBuilt', (prev) => ({
      ...prev,
      lastBuiltAutomation: 'gardenSlide',
      placedAutomations: new Set(prev.placedAutomations).add('gardenSlide'),
      transitCounts: { ...prev.transitCounts, gardenSlide: prev.transitCounts.gardenSlide + 1 },
    })),
    on('transit:conveyorBuilt', (prev) => ({
      ...prev,
      transitCounts: { ...prev.transitCounts, sproutConveyor: prev.transitCounts.sproutConveyor + 1 },
    })),
    on('transit:artifactRemoved', (prev, event) => ({
      ...prev,
      transitCounts: {
        ...prev.transitCounts,
        [event.artifactKind]: Math.max(0, prev.transitCounts[event.artifactKind] - 1),
      },
    })),
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
    on('automation:colourGateRuleChanged', (prev, event) => ({
      ...prev,
      colourGateLanes: { ...event.lanes },
    })),
    on('automation:moodBellRuleChanged', (prev, event) => ({
      ...prev,
      moodBellRule: event.mood,
    })),
    on('habitat:built', (prev, event) => ({
      ...prev,
      habitatInstanceCounts: {
        ...prev.habitatInstanceCounts,
        [event.habitatId]: (prev.habitatInstanceCounts[event.habitatId] ?? 0) + 1,
      },
    })),
    on('habitat:full', (prev, event) => ({
      ...prev,
      habitatFullKinds: new Set(prev.habitatFullKinds).add(event.habitatId),
    })),
    // habitatCapacity is garden-wide and strictly additive, so a purchase
    // reopens room in EVERY instance of EVERY kind at once — the full-now
    // gate goes false for all of them together (no instance can have a count
    // that still exceeds the enlarged capacity).
    on('upgrade:purchased', (prev, event) =>
      event.upgradeId === 'habitatCapacity' && prev.habitatFullKinds.size > 0
        ? { ...prev, habitatFullKinds: new Set() }
        : prev,
    ),
    on('nursery:rhythmChanged', (prev, event) => ({
      ...prev,
      nurseryRhythm: event.rhythm,
      waitingSproutCount: event.waitingCount,
    })),
    on('save:loaded', (prev, event) => ({
      ...prev,
      colourGateLanes: event.snapshot.colourGateLanes ? { ...event.snapshot.colourGateLanes } : prev.colourGateLanes,
      moodBellRule: event.snapshot.moodBellRule ?? prev.moodBellRule,
      nurseryRhythm: event.snapshot.nurseryRhythm ?? prev.nurseryRhythm,
      waitingSproutCount: event.snapshot.waitingSproutCount ?? prev.waitingSproutCount,
      // Silent hydration from the restored save — deliberately does NOT
      // touch lastAchievementUnlocked/lastBuiltAutomation, so old history
      // doesn't replay a toast/SFX on load (see the GameEvent doc comment
      // on save:loaded's snapshot field).
      dewdropTotal: event.snapshot.dewdrops,
      unlockedAutomations: new Set(event.snapshot.unlockedAutomations),
      placedAutomations: new Set(Object.keys(event.snapshot.automationSites ?? {}) as AutomationId[]),
      transitCounts: {
        gardenSlide: event.snapshot.slides?.length ?? 0,
        sproutConveyor: event.snapshot.conveyors?.length ?? 0,
      },
      upgradeLevels: { ...event.snapshot.upgradeLevels },
      unlockedAchievements: new Set(event.snapshot.unlockedAchievements),
      journalDiscovered: new Set(event.snapshot.journalDiscovered),
      // Rebuild instance counts + full-now gate from the restored save's own
      // authoritative lists (the sim computed fullHabitatInstances against the
      // same capacity level this save carries, so no capacity math here).
      habitatInstanceCounts: instanceCountsOf(event.snapshot.habitatInstances),
      habitatFullKinds: fullKindsOf(event.snapshot.habitatInstances, event.snapshot.fullHabitatInstances),
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

type SnapshotHabitatInstance = {
  id: string;
  habitatId: HabitatId;
  count: number;
};

/** Per-kind standing instance counts from the save:loaded snapshot list. */
function instanceCountsOf(instances: SnapshotHabitatInstance[] | undefined): Partial<Record<HabitatId, number>> {
  const counts: Partial<Record<HabitatId, number>> = {};
  for (const instance of instances ?? []) {
    counts[instance.habitatId] = (counts[instance.habitatId] ?? 0) + 1;
  }
  return counts;
}

/** Kinds with at least one currently-full instance, from the snapshot's own
 * full-instance list mapped back through its instance records. */
function fullKindsOf(
  instances: SnapshotHabitatInstance[] | undefined,
  fullInstanceIds: string[] | undefined,
): Set<HabitatId> {
  const fullIds = new Set(fullInstanceIds ?? []);
  const kinds = new Set<HabitatId>();
  for (const instance of instances ?? []) {
    if (fullIds.has(instance.id)) kinds.add(instance.habitatId);
  }
  return kinds;
}
