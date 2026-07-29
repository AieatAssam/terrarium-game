// Composition root for gameplay: owns the one live SimState, drives the
// fixed-step tick loop via requestAnimationFrame (independent of Babylon's
// own render loop — docs/CONTRACTS.md: "deterministic simulation layer that
// is independent from rendering and UI"), reacts immediately to player
// intent (`sprout:dropped`, upgrade purchases) rather than waiting for the
// next tick, and owns load/autosave. This module — not src/render or
// src/ui — is the only place SimState is mutated.

import type { UpgradeId } from '../core/ids';
import type { EventBus } from '../events/bus';
import type { GameEvent } from '../events/types';
import { computeOfflineProgress } from '../data/offlineProgress';
import { clearSave, loadGame, saveGame } from '../persistence';
import { advanceClock, createSimClock } from './loop';
import { createInitialSimState, type SimState } from './state';
import { adjudicatePlacement, checkAchievements, purchaseUpgrade as purchaseUpgradeSystem, TICK_SYSTEMS } from './systems';
import { runTick } from './tick';

const AUTOSAVE_INTERVAL_MS = 15_000;

export interface SimRuntime {
  purchaseUpgrade: (upgradeId: UpgradeId) => void;
  resetSave: () => Promise<void>;
  getState: () => SimState;
  dispose: () => void;
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
    bus.emit({
      type: 'save:loaded',
      offlineSeconds: Math.round(offline.creditedMs / 1000),
      offlineDewdrops: offline.dewdropsEarned,
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

  const step = (now: number): void => {
    if (disposed) return;
    const realDeltaMs = now - lastFrameTime;
    lastFrameTime = now;
    const advanced = advanceClock(clock, realDeltaMs);
    clock = advanced.clock;

    for (let i = 0; i < advanced.ticksToRun; i += 1) {
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
    resetSave: async () => {
      await clearSave();
    },
    getState: () => state,
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
