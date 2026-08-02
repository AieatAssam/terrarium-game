// Composition root for gameplay: owns the one live SimState, drives the
// fixed-step tick loop via requestAnimationFrame (independent of Babylon's
// own render loop — docs/CONTRACTS.md: "deterministic simulation layer that
// is independent from rendering and UI"), reacts immediately to player
// intent (`sprout:dropped`, upgrade purchases) rather than waiting for the
// next tick, and owns load/autosave. This module — not src/render or
// src/ui — is the only place SimState is mutated.

import type { AutomationId, HabitatId, MoodId, SproutTypeId, UpgradeId } from '../core/ids';
import { isDev } from '../core/env';
import { getEffectiveHabitatCapacity } from '../data/habitats';
import type { EventBus } from '../events/bus';
import type { GameEvent } from '../events/types';
import { computeOfflineProgress } from '../data/offlineProgress';
import { getNurseryRhythm, pickMood } from '../data/spawning';
import { clearSave, loadGame, saveGame } from '../persistence';
import { NURSERY_TILE, type ColourGateLane, type ColourGateLanes } from './layout';
import { advanceClock, createSimClock } from './loop';
import type { TileCoord } from './grid';
import { createInitialSimState, type SimState } from './state';
import { colourGateLockReason, moodBellLockReason } from '../data/unlocks';
import {
  adjudicateAutomationDrop,
  adjudicatePlacement,
  checkAchievements,
  colourGateBehavioralState,
  colourGateLaneNote,
  countWaitingSprouts,
  habitatInstanceAtTile,
  moodBellBehavioralState,
  placeAutomation as placeAutomationSystem,
  placeHabitat as placeHabitatSystem,
  purchaseUpgrade as purchaseUpgradeSystem,
  setColourGateLane as setColourGateLaneSystem,
  setMoodBellRule as setMoodBellRuleSystem,
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
  /**
   * Player commits a placement for an already-unlocked-but-not-yet-placed
   * automation (2026-08-01, manual placement — GameRules §9.8). Same
   * plain-function reasoning as `purchaseUpgrade`: no player-intent event
   * in the GameEvent union, UI/input must never touch SimState directly.
   * No-ops on an invalid request (see `placeAutomation`, src/sim/systems.ts)
   * — src/input is expected to have already validated via
   * `isValidAutomationSite` for the ghost preview, but this re-validates
   * rather than trusting the caller.
   */
  placeAutomation: (automationId: AutomationId, tile: TileCoord) => void;
  /**
   * Player commits building a NEW habitat of an existing kind (Phase 2,
   * plan.yaml Phase 2.2). Same plain-function reasoning as `placeAutomation`:
   * no player-intent event in the GameEvent union, and the gates (full-now,
   * affordability, valid site) all live in `placeHabitat`,
   * src/sim/systems.ts — no-ops on any unmet gate.
   */
  placeHabitat: (habitatId: HabitatId, tile: TileCoord) => void;
  /**
   * The Colour Gate's control surface, exposed as plain functions for exactly
   * the reason `purchaseUpgrade` is (see docs/ARCHITECTURE.md): the GameEvent
   * union is sim-originated announcements, there is no player-intent event, and
   * the UI must never read or write SimState directly. Changing a lane emits
   * `automation:colourGateRuleChanged`, so everything else still learns about it
   * over the bus in the normal way.
   */
  getColourGateRule: () => { lanes: ColourGateLanes; notes: Record<ColourGateLane, string | null> };
  setColourGateLane: (lane: ColourGateLane, sproutType: SproutTypeId | null) => void;
  /**
   * The Mood Bell's control surface, same reasoning as the Colour Gate's
   * above. Simpler than the Gate's: a single toggle, always deliverable by
   * construction, so there is no per-choice mismatch note to expose.
   */
  getMoodBellRule: () => MoodId;
  setMoodBellRule: (mood: MoodId) => void;
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

/**
 * Habitat INSTANCES sitting at capacity right now (Phase 2 — instance ids,
 * not kinds). Needed in the `save:loaded` snapshot because `habitat:full`
 * only ever fires on the tick a habitat reaches capacity — after a reload
 * nothing downstream would otherwise know a home is already full, and the
 * renderer uses exactly that to show a Garden Slide as blocked instead of
 * idle (GameRules §9.7).
 */
function fullHabitatsOf(state: SimState): string[] {
  const capacityLevel = state.upgradeLevels.habitatCapacity ?? 0;
  return state.habitats.filter((h) => h.count >= getEffectiveHabitatCapacity(h.habitatId, capacityLevel)).map((h) => h.id);
}

/**
 * Where each built automation delivers to. Paired with `fullHabitatsOf` in the
 * `save:loaded` snapshot: a restored save replays no `automation:built`, so
 * without this the renderer would know a Garden Slide exists but not which home
 * it serves, and could not tell whether that home being full is currently
 * blocking it.
 */
function automationTargetsOf(state: SimState): Partial<Record<AutomationId, HabitatId>> {
  const targets: Partial<Record<AutomationId, HabitatId>> = {};
  for (const instance of state.automations) {
    if (instance.targetHabitatId) targets[instance.automationId] = instance.targetHabitatId;
  }
  return targets;
}

/**
 * Where each built automation's structure actually stands (2026-08-01,
 * manual placement — GameRules §9.8). Same reasoning as `automationTargetsOf`
 * above: a restored save replays no `automation:built`, and there is no
 * longer a single fixed default tile per automationId for the renderer to
 * fall back to, so without this a restored save's structures would have
 * nowhere to draw themselves.
 */
function automationSitesOf(state: SimState): Partial<Record<AutomationId, TileCoord>> {
  const sites: Partial<Record<AutomationId, TileCoord>> = {};
  for (const instance of state.automations) sites[instance.automationId] = instance.siteTile;
  return sites;
}

/** Applies a batch of events to `state` via the achievement checker, emits every event (originals + any achievement unlocks) through `emit` in order, and returns the final state. Centralizing this means achievements react identically regardless of whether the batch came from a tick or an immediate player action. */
function commit(emit: (event: GameEvent) => void, state: SimState, events: readonly GameEvent[]): SimState {
  for (const event of events) emit(event);
  if (events.length === 0) return state;
  const achievementResult = checkAchievements(state, events);
  for (const event of achievementResult.events) emit(event);
  return achievementResult.state;
}

/**
 * `announceWhen` gates only the `save:loaded` announcement, never the
 * simulation itself. The sim deliberately starts in parallel with Babylon
 * bootstrap and asset loading, which meant the restored-save events fired as
 * soon as IndexedDB resolved — reliably *before* the renderer had subscribed,
 * since it was still awaiting bootstrap() and loadManifest(). The UI mounts
 * synchronously and caught them; the renderer missed them every time, so a
 * built Garden Slide came back as a translucent "not yet built" ghost and
 * restored Sprouts had no meshes at all. Passing the renderer-ready promise
 * here fixes both at the source. The snapshot payload is computed at load
 * time and only *delivered* late, so its contents still describe the moment
 * the save was restored rather than whenever the renderer happened to finish.
 */
export async function startSimRuntime(
  bus: EventBus,
  seed: number = Date.now(),
  announceWhen?: Promise<unknown>,
): Promise<SimRuntime> {
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
    const loadedEvents: GameEvent[] = [];
    loadedEvents.push({
      type: 'save:loaded',
      offlineSeconds: Math.round(offline.creditedMs / 1000),
      offlineDewdrops: offline.dewdropsEarned,
      snapshot: {
        dewdrops: state.dewdrops,
        unlockedAutomations: state.unlockedAutomations,
        upgradeLevels: state.upgradeLevels,
        unlockedAchievements: state.unlockedAchievements,
        journalDiscovered: state.journalDiscovered,
        fullHabitatInstances: fullHabitatsOf(state),
        automationTargets: automationTargetsOf(state),
        automationSites: automationSitesOf(state),
        habitatInstances: state.habitats.map((h) => ({ id: h.id, habitatId: h.habitatId, tile: h.tile, count: h.count })),
        sprouts: state.sprouts.map((s) => {
          const instance = s.state === 'settled' ? habitatInstanceAtTile(state.habitats, s.tile) : null;
          return {
            id: s.id,
            sproutType: s.sproutType,
            mood: s.mood,
            tile: s.tile,
            settled: s.state === 'settled',
            habitatId: instance?.habitatId,
            habitatInstanceId: instance?.id,
          };
        }),
        colourGateLanes: { ...state.colourGateLanes },
        moodBellRule: state.moodBellRule,
        // Recomputed here rather than read from `nurseryWaitingCount` (which is
        // the last-ANNOUNCED figure, deliberately reset by the v2→v3 migration)
        // so a returning garden's note is accurate from the first frame.
        nurseryRhythm: getNurseryRhythm(countWaitingSprouts(state)),
        waitingSproutCount: countWaitingSprouts(state),
      },
    });
    if (offline.dewdropsEarned > 0) {
      loadedEvents.push({ type: 'currency:dewdropsChanged', total: state.dewdrops, delta: offline.dewdropsEarned });
    }
    const announce = (): void => {
      for (const event of loadedEvents) bus.emit(event);
    };
    if (announceWhen) {
      void announceWhen.then(announce, announce); // announce even if the renderer failed, so the UI still hydrates
    } else {
      announce();
    }
  }

  let clock = createSimClock();
  let lastFrameTime = performance.now();
  let disposed = false;
  let rafHandle = 0;
  // Dev-only "speed up simulation" debug control. Multiplies ticks-per-frame
  // rather than the delta fed into advanceClock, so determinism/replay of
  // the underlying tick sequence is unaffected — it just runs more of them
  // per animation frame.
  let speedMultiplier = 1;

  /**
   * Everything sim emits goes through here, so the one place that knows how sim
   * time maps onto WALL-CLOCK time can say so.
   *
   * `sprout:transportStarted.durationMs` is authored in sim time
   * (`durationTicks * TICK_MS`, from src/sim/systems.ts's `transportDuration`),
   * which is the honest unit for the systems layer and what the unit tests pin.
   * But the renderer animates against `performance.now()`, and the dev speed
   * control deliberately breaks the 1:1 relationship by running N ticks per
   * animation frame — at 5x, a 3.4s ride really does finish in 0.68s of real
   * time. Emitting the unscaled figure would have the animation still gliding
   * along the path a second after the Sprout had already settled, and the ride
   * would then be cut short mid-journey: a visible snap, exactly the kind of
   * jerk this whole pass is about.
   *
   * `speedMultiplier` is always 1 outside dev (`debug.setSpeedMultiplier`
   * no-ops when `isDev` is false), so this is an identity transform in a
   * production build.
   */
  const emit = (event: GameEvent): void => {
    if (event.type === 'sprout:transportStarted' && speedMultiplier !== 1) {
      bus.emit({ ...event, durationMs: event.durationMs / speedMultiplier });
      return;
    }
    bus.emit(event);
  };

  const unsubDropped = bus.subscribe('sprout:dropped', (event) => {
    // A drop lands on at most one of the two — `overAutomation` (a player
    // handing a Sprout straight to a built helper, GameRules §9.1) takes the
    // automation-drop path; everything else (including a habitat, or open
    // ground) keeps going through the existing placement adjudication.
    const result = event.overAutomation
      ? adjudicateAutomationDrop(state, event.sproutId, event.overAutomation)
      : adjudicatePlacement(state, event.sproutId, event.overHabitatInstance ?? null);
    state = commit(emit, result.state, result.events);
  });

  const step = (now: number): void => {
    if (disposed) return;
    const realDeltaMs = now - lastFrameTime;
    lastFrameTime = now;
    const advanced = advanceClock(clock, realDeltaMs);
    clock = advanced.clock;

    const ticksToRun = advanced.ticksToRun * speedMultiplier;
    for (let i = 0; i < ticksToRun; i += 1) {
      const result = runTick(state, TICK_SYSTEMS);
      state = commit(emit, result.state, result.events);
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
      state = commit(emit, result.state, result.events);
    },
    placeAutomation: (automationId, tile) => {
      const result = placeAutomationSystem(state, automationId, tile);
      state = commit(emit, result.state, result.events);
    },
    placeHabitat: (habitatId, tile) => {
      const result = placeHabitatSystem(state, habitatId, tile);
      state = commit(emit, result.state, result.events);
    },
    getUpgradeLockReason: (upgradeId) =>
      upgradeId === 'colourGateUnlock'
        ? colourGateLockReason(colourGateBehavioralState(state))
        : upgradeId === 'moodBellUnlock'
          ? moodBellLockReason(moodBellBehavioralState(state))
          : null,
    getColourGateRule: () => ({
      lanes: { ...state.colourGateLanes },
      notes: {
        west: colourGateLaneNote(state.colourGateLanes, 'west'),
        east: colourGateLaneNote(state.colourGateLanes, 'east'),
      },
    }),
    setColourGateLane: (lane, sproutType) => {
      const result = setColourGateLaneSystem(state, lane, sproutType);
      state = commit(emit, result.state, result.events);
    },
    getMoodBellRule: () => state.moodBellRule,
    setMoodBellRule: (mood) => {
      const result = setMoodBellRuleSystem(state, mood);
      state = commit(emit, result.state, result.events);
    },
    resetSave: async () => {
      // Clearing the stored save is not enough on its own: the live SimState
      // stays in memory and the autosave interval writes it straight back, so
      // a reset appeared to do nothing at all (measured: 810 Sprouts and
      // 12,684 Dewdrops still present after resetting and reloading). Stop the
      // clock, drop the state, then clear — in that order, so no tick can
      // repopulate or re-persist anything between the two steps.
      disposed = true;
      cancelAnimationFrame(rafHandle);
      window.clearInterval(autosave);
      window.removeEventListener('beforeunload', handleUnload);
      state = createInitialSimState(seed);
      await clearSave();
    },
    getState: () => state,
    debug: {
      spawnSprout: (sproutType) => {
        if (!isDev) return;
        // Debug-only: not part of the deterministic tick stream (this whole
        // hook already mutates `state` imperatively, outside runTick), so a
        // plain Math.random() draw for mood is fine here — unlike
        // spawnSystem's own pickMood call, which MUST use the seeded RNG.
        const mood = pickMood(Math.random());
        const sprout = {
          id: `debug-sprout-${state.tickCount}-${state.sprouts.length}`,
          sproutType,
          mood,
          tile: NURSERY_TILE,
          state: 'idle' as const,
        };
        state = { ...state, sprouts: [...state.sprouts, sprout] };
        const event: GameEvent = { type: 'sprout:spawned', sproutId: sprout.id, sproutType, mood, podId: 'debug' };
        state = commit(emit, state, [event]);
      },
      grantDewdrops: (amount) => {
        if (!isDev) return;
        const total = state.dewdrops + amount;
        state = { ...state, dewdrops: total };
        state = commit(emit, state, [{ type: 'currency:dewdropsChanged', total, delta: amount }]);
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
