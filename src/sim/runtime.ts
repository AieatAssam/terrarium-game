// Composition root for gameplay: owns the one live SimState, drives the
// fixed-step tick loop via requestAnimationFrame (independent of Babylon's
// own render loop — docs/CONTRACTS.md: "deterministic simulation layer that
// is independent from rendering and UI"), reacts immediately to player
// intent (`sprout:dropped`, upgrade purchases) rather than waiting for the
// next tick, and owns load/autosave. This module — not src/render or
// src/ui — is the only place SimState is mutated.

import type { SproutTypeId, UpgradeId } from '../core/ids';
import { isDev } from '../core/env';
import type { EventBus } from '../events/bus';
import type { GameEvent } from '../events/types';
import { computeOfflineProgress } from '../data/offlineProgress';
import { clearSave, loadGame, saveGame } from '../persistence';
import { NURSERY_TILE } from './layout';
import { advanceClock, createSimClock } from './loop';
import { createInitialSimState, type SimState } from './state';
import { colourGateLockReason } from '../data/unlocks';
import {
  adjudicatePlacement,
  checkAchievements,
  colourGateBehavioralState,
  purchaseUpgrade as purchaseUpgradeSystem,
  TICK_SYSTEMS,
} from './systems';
import { runTick } from './tick';

const AUTOSAVE_INTERVAL_MS = 15_000;

export interface SimRuntime {
  purchaseUpgrade: (upgradeId: UpgradeId) => void;
  /**
   * Why `upgradeId` can't be bought yet for reasons other than price, or null
   * if nothing behavioral is blocking it. Only the Colour Gate has such a
   * gate today. Exposed as a plain function for the same reason
   * `purchaseUpgrade` is (see docs/ARCHITECTURE.md): there's no
   * player-intent event in the GameEvent union, and the UI must not read
   * SimState directly.
   */
  getUpgradeLockReason: (upgradeId: UpgradeId) => string | null;
  resetSave: () => Promise<void>;
  getState: () => SimState;
  dispose: () => void;
  /** Dev-only debug controls (brief: "spawning each Sprout type, including Star Sprout; granting Dewdrops; speeding simulation; and resetting save data"). No-ops in production — gated by isDev here, not just by whether a debug panel is mounted, so there's no live control surface even if something held a reference to this object in a prod build. */
  debug: {
    spawnSprout: (sproutType: SproutTypeId) => void;
    grantDewdrops: (amount: number) => void;
    setSpeedMultiplier: (multiplier: number) => void;
  };
}

/** Applies a batch of events to `state` via the achievement checker, emits every event (originals + any achievement unlocks) onto the bus in order, and returns the final state. Centralizing this means achievements react identically regardless of whether the batch came from a tick or an immediate player action. */
function commit(bus: EventBus, state: SimState, events: readonly GameEvent[]): SimState {
  for (const event of events) bus.emit(event);
  if (events.length === 0) return state;
  const achievementResult = checkAchievements(state, events);
  for (const event of achievementResult.events) bus.emit(event);
  return achievementResult.state;
}

export async function startSimRuntime(bus: EventBus, seed: number = Date.now()): Promise<SimRuntime> {
  let state = createInitialSimState(seed);

  const saved = await loadGame();
  if (saved) {
    const closedAt = saved.meta.lastSavedAt;
    const elapsedRealMs = Math.max(0, Date.now() - closedAt);
    const offline = computeOfflineProgress(elapsedRealMs, saved.sim);
    state = { ...saved.sim, dewdrops: saved.sim.dewdrops + offline.dewdropsEarned };
    // Always emit save:loaded (with the full snapshot) when a save exists,
    // even with zero offline gain — the UI store's hydration depends on
    // this event firing, not just on there being something to celebrate.
    bus.emit({
      type: 'save:loaded',
      offlineSeconds: Math.round(offline.creditedMs / 1000),
      offlineDewdrops: offline.dewdropsEarned,
      snapshot: {
        dewdrops: state.dewdrops,
        unlockedAutomations: state.unlockedAutomations,
        upgradeLevels: state.upgradeLevels,
        unlockedAchievements: state.unlockedAchievements,
        journalDiscovered: state.journalDiscovered,
      },
    });
    if (offline.dewdropsEarned > 0) {
      bus.emit({ type: 'currency:dewdropsChanged', total: state.dewdrops, delta: offline.dewdropsEarned });
    }
  }

  const unsubDropped = bus.subscribe('sprout:dropped', (event) => {
    const result = adjudicatePlacement(state, event.sproutId, event.overHabitat);
    state = commit(bus, result.state, result.events);
  });

  let clock = createSimClock();
  let lastFrameTime = performance.now();
  let disposed = false;
  let rafHandle = 0;
  // Dev-only "speed up simulation" debug control. Multiplies ticks-per-frame
  // rather than the delta fed into advanceClock, so determinism/replay of
  // the underlying tick sequence is unaffected — it just runs more of them
  // per animation frame.
  let speedMultiplier = 1;

  const step = (now: number): void => {
    if (disposed) return;
    const realDeltaMs = now - lastFrameTime;
    lastFrameTime = now;
    const advanced = advanceClock(clock, realDeltaMs);
    clock = advanced.clock;

    const ticksToRun = advanced.ticksToRun * speedMultiplier;
    for (let i = 0; i < ticksToRun; i += 1) {
      const result = runTick(state, TICK_SYSTEMS);
      state = commit(bus, result.state, result.events);
    }

    rafHandle = requestAnimationFrame(step);
  };
  rafHandle = requestAnimationFrame(step);

  const autosave = window.setInterval(() => {
    void saveGame(state).then(() => bus.emit({ type: 'save:written' }));
  }, AUTOSAVE_INTERVAL_MS);

  const handleUnload = (): void => {
    void saveGame(state);
  };
  window.addEventListener('beforeunload', handleUnload);

  return {
    purchaseUpgrade: (upgradeId) => {
      const result = purchaseUpgradeSystem(state, upgradeId);
      state = commit(bus, result.state, result.events);
    },
    getUpgradeLockReason: (upgradeId) =>
      upgradeId === 'colourGateUnlock' ? colourGateLockReason(colourGateBehavioralState(state)) : null,
    resetSave: async () => {
      await clearSave();
    },
    getState: () => state,
    debug: {
      spawnSprout: (sproutType) => {
        if (!isDev) return;
        const sprout = { id: `debug-sprout-${state.tickCount}-${state.sprouts.length}`, sproutType, tile: NURSERY_TILE, state: 'idle' as const };
        state = { ...state, sprouts: [...state.sprouts, sprout] };
        const event: GameEvent = { type: 'sprout:spawned', sproutId: sprout.id, sproutType, podId: 'debug' };
        state = commit(bus, state, [event]);
      },
      grantDewdrops: (amount) => {
        if (!isDev) return;
        const total = state.dewdrops + amount;
        state = { ...state, dewdrops: total };
        state = commit(bus, state, [{ type: 'currency:dewdropsChanged', total, delta: amount }]);
      },
      setSpeedMultiplier: (multiplier) => {
        if (!isDev) return;
        speedMultiplier = Math.max(1, Math.round(multiplier));
      },
    },
    dispose: () => {
      disposed = true;
      cancelAnimationFrame(rafHandle);
      window.clearInterval(autosave);
      window.removeEventListener('beforeunload', handleUnload);
      unsubDropped();
      void saveGame(state);
    },
  };
}
