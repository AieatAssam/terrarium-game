// Phase 1 gameplay systems — the piece docs/CONTRACTS.md's Phase 2 split
// never assigned to anyone (see tick.ts's original "extension seam nobody
// owns" comment). Pure functions over SimState, composed by runTick
// (tick-based systems) or called directly (immediate reactions to player
// intent: a drop, a purchase) from src/sim/runtime.ts, the one module
// allowed to hold live mutable state and talk to the event bus.

import type { AchievementId, AutomationId, HabitatId, UpgradeId } from '../core/ids';
import type { GameEvent } from '../events/types';
import { ACHIEVEMENT_LIST } from '../data/achievements';
import { sproutMatchesHabitat, SPROUT_TYPES } from '../data/sproutTypes';
import { getEffectiveHabitatCapacity, HABITATS } from '../data/habitats';
import { getDewdropMultiplier, UPGRADES } from '../data/upgrades';
import { getPodSpawnIntervalMs, pickSproutType } from '../data/spawning';
import { isColourGateUnlocked, isGardenSlideUnlocked, type ColourGateUnlockState } from '../data/unlocks';
import { nextRandom } from './rng';
import { TICK_MS } from './loop';
import { AUTOMATION_SITE_TILES, HABITAT_TILES, NURSERY_TILE, tileDistance } from './layout';
import type { AutomationInstance, HabitatState, SimState, SproutInstance } from './state';
import type { TickResult } from './tick';

const HABITAT_ORDER: HabitatId[] = ['emberNook', 'dewPond', 'sunflowerMeadow'];
const BASE_TRANSPORT_MS_PER_TILE = 420; // matches src/render/sprouts.ts's own per-tile animation duration

/** Deterministic id — never Date.now()/Math.random(), so sim stays reproducible per docs/CONTRACTS.md. */
function makeSproutId(state: SimState): string {
  return `sprout-${state.tickCount}-${state.sprouts.length}`;
}

// ---------------------------------------------------------------------------
// Tick-based systems (composed via runTick in src/sim/runtime.ts)
// ---------------------------------------------------------------------------

/** Spawns a new Sprout at the Nursery once the podRhythm-adjusted interval elapses. */
export function spawnSystem(state: SimState): TickResult {
  const podRhythmLevel = state.upgradeLevels.podRhythm ?? 0;
  const interval = getPodSpawnIntervalMs(podRhythmLevel);
  const accumulated = state.spawnAccumulatorMs + TICK_MS;

  if (accumulated < interval) {
    return { state: { ...state, spawnAccumulatorMs: accumulated }, events: [] };
  }

  const { value, nextSeed } = nextRandom(state.rngSeed);
  const sproutType = pickSproutType(value);
  const sprout: SproutInstance = {
    id: makeSproutId(state),
    sproutType,
    tile: NURSERY_TILE,
    state: 'idle',
  };

  return {
    state: {
      ...state,
      spawnAccumulatorMs: accumulated - interval,
      rngSeed: nextSeed,
      sprouts: [...state.sprouts, sprout],
    },
    events: [{ type: 'sprout:spawned', sproutId: sprout.id, sproutType, podId: 'nursery' }],
  };
}

/** Accrues Dewdrops from every settled Sprout, per habitat, flushing whole units as they cross 1.0 (self-throttling — no fixed timer needed). */
export function dewdropSystem(state: SimState): TickResult {
  const multiplier = getDewdropMultiplier(state.upgradeLevels);
  let dewdrops = state.dewdrops;
  const fraction = { ...state.habitatDewdropFraction };
  const events: GameEvent[] = [];

  for (const id of HABITAT_ORDER) {
    const habitatState = state.habitats[id];
    if (!habitatState || habitatState.count === 0) continue;
    const rate = HABITATS[id].baseDewdropRate * multiplier;
    const total = (fraction[id] ?? 0) + habitatState.count * rate;
    const whole = Math.floor(total);
    fraction[id] = total - whole;
    if (whole > 0) {
      dewdrops += whole;
      events.push({ type: 'habitat:dewdropTick', habitatId: id, amount: whole });
      events.push({ type: 'currency:dewdropsChanged', total: dewdrops, delta: whole });
    }
  }

  return { state: { ...state, dewdrops, habitatDewdropFraction: fraction }, events };
}

/** Garden Slide auto-unlocks and auto-builds once the manual-placement threshold is hit (docs/GAME_DESIGN.md: "unlocks and auto-builds ... targeting whichever habitat the player has been feeding most"). Colour Gate is gated behind a purchase (see purchaseUpgrade below), not this system. */
export function unlockSystem(state: SimState): TickResult {
  if (state.unlockedAutomations.includes('gardenSlide') || !isGardenSlideUnlocked(state.correctPlacementCount)) {
    return { state, events: [] };
  }

  let target: HabitatId = HABITAT_ORDER[0];
  let best = -1;
  for (const id of HABITAT_ORDER) {
    const count = state.habitats[id]?.count ?? 0;
    if (count > best) {
      best = count;
      target = id;
    }
  }

  const instanceId = 'gardenSlide-1';
  const instance: AutomationInstance = {
    id: instanceId,
    automationId: 'gardenSlide',
    fromTile: NURSERY_TILE,
    toTile: HABITAT_TILES[target],
    builtAtTick: state.tickCount,
    targetHabitatId: target,
    carryingSproutId: null,
    completesAtTick: null,
  };

  return {
    state: {
      ...state,
      unlockedAutomations: [...state.unlockedAutomations, 'gardenSlide'],
      automations: [...state.automations, instance],
    },
    events: [
      { type: 'automation:unlocked', automationId: 'gardenSlide' },
      { type: 'automation:built', automationId: 'gardenSlide', instanceId },
    ],
  };
}

function findEligibleSprout(instance: AutomationInstance, sprouts: SproutInstance[]): SproutInstance | null {
  const candidates = sprouts.filter(
    (s) => s.state === 'idle' && s.tile.x === NURSERY_TILE.x && s.tile.z === NURSERY_TILE.z,
  );
  if (instance.automationId === 'gardenSlide') {
    const wantType = HABITATS[instance.targetHabitatId!].matchSproutType;
    return candidates.find((s) => s.sproutType === wantType) ?? null;
  }
  // colourGate: routes whatever the slide isn't already handling — Star
  // Sprouts always match any habitat, so there's no "stuck" pile for them
  // and no reason to route them automatically.
  return candidates.find((s) => s.sproutType !== 'star') ?? null;
}

function destinationFor(instance: AutomationInstance, sprout: SproutInstance): HabitatId | null {
  if (instance.automationId === 'gardenSlide') return instance.targetHabitatId ?? null;
  return SPROUT_TYPES[sprout.sproutType].habitatId; // colourGate: sprout's own correct habitat (null only for star, already excluded above)
}

function transportMsPerTile(instance: AutomationInstance, upgradeLevels: SimState['upgradeLevels']): number {
  if (instance.automationId !== 'gardenSlide') return BASE_TRANSPORT_MS_PER_TILE;
  const level = upgradeLevels.gardenSlideSpeed ?? 0;
  const factor = (1 - UPGRADES.gardenSlideSpeed.effect.magnitudePerLevel) ** level;
  return BASE_TRANSPORT_MS_PER_TILE * factor;
}

/**
 * Settles a Sprout into a habitat: marks it settled, increments the
 * habitat's count, counts it toward the manual-placement unlock threshold,
 * fires the first-sighting Journal entry if this is the first time this
 * species has ever settled, and flags `habitat:full` on the exact tick
 * capacity is reached (not on every later rejected drop — see
 * adjudicatePlacement). Shared by manual placement and automation dispatch
 * so both paths behave identically.
 */
function settleSprout(state: SimState, sproutId: string, habitatId: HabitatId): TickResult {
  const sprout = state.sprouts.find((s) => s.id === sproutId);
  if (!sprout) return { state, events: [] };

  const events: GameEvent[] = [];
  const sprouts = state.sprouts.map((s) => (s.id === sproutId ? { ...s, tile: HABITAT_TILES[habitatId], state: 'settled' as const } : s));

  const prevHabitatState = state.habitats[habitatId];
  const capacity = getEffectiveHabitatCapacity(habitatId, state.upgradeLevels.habitatCapacity ?? 0);
  const newCount = (prevHabitatState?.count ?? 0) + 1;
  const habitats: SimState['habitats'] = {
    ...state.habitats,
    [habitatId]: { id: habitatId, count: newCount, capacity } satisfies HabitatState,
  };

  events.push({ type: 'sprout:placed:correct', sproutId, habitatId });
  events.push({ type: 'sprout:settled', sproutId, habitatId });
  if (newCount === capacity) events.push({ type: 'habitat:full', habitatId });

  let journalDiscovered = state.journalDiscovered;
  if (!journalDiscovered.includes(sprout.sproutType)) {
    journalDiscovered = [...journalDiscovered, sprout.sproutType];
    events.push({ type: 'journal:entryDiscovered', sproutType: sprout.sproutType });
  }

  return {
    state: {
      ...state,
      sprouts,
      habitats,
      correctPlacementCount: state.correctPlacementCount + 1,
      journalDiscovered,
    },
    events,
  };
}

/** Advances every built automation instance: finishes transports that have arrived, then starts new ones for whoever's free and has an eligible Sprout waiting. */
export function automationSystem(state: SimState): TickResult {
  const events: GameEvent[] = [];
  let working = state;

  // Phase 1: complete arrivals.
  const completedInstances: string[] = [];
  for (const instance of working.automations) {
    if (instance.carryingSproutId && instance.completesAtTick !== null && working.tickCount >= instance.completesAtTick) {
      const sprout = working.sprouts.find((s) => s.id === instance.carryingSproutId);
      const dest = sprout ? destinationFor(instance, sprout) : null;
      if (sprout && dest) {
        events.push({
          type: 'sprout:transportCompleted',
          sproutId: sprout.id,
          automationId: instance.automationId,
          instanceId: instance.id,
        });
        const result = settleSprout(working, sprout.id, dest);
        working = result.state;
        events.push(...result.events);
      }
      completedInstances.push(instance.id);
    }
  }
  if (completedInstances.length > 0) {
    working = {
      ...working,
      automations: working.automations.map((instance) =>
        completedInstances.includes(instance.id) ? { ...instance, carryingSproutId: null, completesAtTick: null } : instance,
      ),
    };
  }

  // Phase 2: start new transports for whoever's free.
  const nextAutomations: AutomationInstance[] = [];
  let sprouts = working.sprouts;
  for (const instance of working.automations) {
    if (instance.carryingSproutId) {
      nextAutomations.push(instance);
      continue;
    }
    const eligible = findEligibleSprout(instance, sprouts);
    if (!eligible) {
      nextAutomations.push(instance);
      continue;
    }
    const dest = destinationFor(instance, eligible);
    if (!dest) {
      nextAutomations.push(instance);
      continue;
    }
    const capacity = getEffectiveHabitatCapacity(dest, working.upgradeLevels.habitatCapacity ?? 0);
    const currentCount = working.habitats[dest]?.count ?? 0;
    if (currentCount >= capacity) {
      nextAutomations.push(instance); // target full — wait rather than force a rejected delivery
      continue;
    }

    const distance = tileDistance(NURSERY_TILE, HABITAT_TILES[dest]);
    const msPerTile = transportMsPerTile(instance, working.upgradeLevels);
    const durationTicks = Math.max(1, Math.round((msPerTile * distance) / TICK_MS));

    sprouts = sprouts.map((s) => (s.id === eligible.id ? { ...s, state: 'transporting' as const, tile: HABITAT_TILES[dest] } : s));
    events.push({
      type: 'sprout:transportStarted',
      sproutId: eligible.id,
      automationId: instance.automationId,
      instanceId: instance.id,
      fromTile: NURSERY_TILE,
      toTile: HABITAT_TILES[dest],
    });
    nextAutomations.push({ ...instance, carryingSproutId: eligible.id, completesAtTick: working.tickCount + durationTicks });
  }

  return { state: { ...working, automations: nextAutomations, sprouts }, events };
}

// ---------------------------------------------------------------------------
// Immediate (non-tick) reactions to player intent — called directly from
// src/sim/runtime.ts, not part of the runTick systems array.
// ---------------------------------------------------------------------------

/** Adjudicates a player's drop of a Sprout onto (or off of) a habitat. Guards against a Sprout no longer being idle (already mid-transport, or already settled) so a stray late drop can't double-place it. */
export function adjudicatePlacement(state: SimState, sproutId: string, overHabitat: HabitatId | null): TickResult {
  if (!overHabitat) return { state, events: [] };
  const sprout = state.sprouts.find((s) => s.id === sproutId);
  if (!sprout || sprout.state !== 'idle') return { state, events: [] };

  if (!sproutMatchesHabitat(sprout.sproutType, overHabitat)) {
    return { state, events: [{ type: 'sprout:placed:incorrect', sproutId, habitatId: overHabitat }] };
  }

  const capacity = getEffectiveHabitatCapacity(overHabitat, state.upgradeLevels.habitatCapacity ?? 0);
  const currentCount = state.habitats[overHabitat]?.count ?? 0;
  if (currentCount >= capacity) {
    return { state, events: [{ type: 'sprout:placed:incorrect', sproutId, habitatId: overHabitat }] };
  }

  return settleSprout(state, sproutId, overHabitat);
}

/** Behavioral gate for purchasing colourGateUnlock — same rule as docs/data/unlocks.ts's ColourGateUnlockState, evaluated against live state. Exported so the UI can explain the gate instead of offering a button that silently no-ops (see colourGateLockReason). */
export function colourGateBehavioralState(state: SimState): ColourGateUnlockState {
  const slide = state.automations.find((a) => a.automationId === 'gardenSlide');
  if (!slide) return { gardenSlideBuilt: false, singleHabitatFeedTicks: 0, unsortedPileSize: 0 };
  const fedType = slide.targetHabitatId ? HABITATS[slide.targetHabitatId].matchSproutType : undefined;
  const unsortedPileSize = fedType
    ? state.sprouts.filter((s) => s.state === 'idle' && s.sproutType !== 'star' && s.sproutType !== fedType).length
    : 0;
  return {
    gardenSlideBuilt: true,
    singleHabitatFeedTicks: state.tickCount - slide.builtAtTick,
    unsortedPileSize,
  };
}

/** Purchases an upgrade: applies the effect and, for colourGateUnlock specifically, auto-builds the Colour Gate — but only once its behavioral unlock condition (docs/GAME_DESIGN.md) is actually met. Silently no-ops (no charge) if unaffordable, maxed, or (colourGateUnlock only) not yet behaviorally unlocked. */
export function purchaseUpgrade(state: SimState, upgradeId: UpgradeId): TickResult {
  const def = UPGRADES[upgradeId];
  const level = state.upgradeLevels[upgradeId] ?? 0;
  if (level >= def.maxLevel) return { state, events: [] };

  if (upgradeId === 'colourGateUnlock' && !isColourGateUnlocked(colourGateBehavioralState(state))) {
    return { state, events: [] };
  }

  const cost = def.costForLevel(level + 1);
  if (state.dewdrops < cost) return { state, events: [] };

  const dewdrops = state.dewdrops - cost;
  const newLevel = level + 1;
  const events: GameEvent[] = [
    { type: 'upgrade:purchased', upgradeId, level: newLevel },
    { type: 'currency:dewdropsChanged', total: dewdrops, delta: -cost },
  ];

  let automations = state.automations;
  let unlockedAutomations = state.unlockedAutomations;
  if (upgradeId === 'colourGateUnlock') {
    const instanceId = 'colourGate-1';
    const instance: AutomationInstance = {
      id: instanceId,
      automationId: 'colourGate',
      fromTile: NURSERY_TILE,
      toTile: AUTOMATION_SITE_TILES.colourGate,
      builtAtTick: state.tickCount,
      carryingSproutId: null,
      completesAtTick: null,
    };
    automations = [...automations, instance];
    unlockedAutomations = [...unlockedAutomations, 'colourGate'];
    events.push({ type: 'automation:unlocked', automationId: 'colourGate' });
    events.push({ type: 'automation:built', automationId: 'colourGate', instanceId });
  }

  return {
    state: {
      ...state,
      dewdrops,
      upgradeLevels: { ...state.upgradeLevels, [upgradeId]: newLevel },
      automations,
      unlockedAutomations,
    },
    events,
  };
}

/** Checks every achievement whose triggerEvent matches an event in this batch, unlocking (at most once each) and returning the extra `achievement:unlocked` events. Stateless w.r.t. which events are passed in — callers (runtime.ts) run this after every batch, tick-based or immediate, so achievements react uniformly regardless of source. */
export function checkAchievements(state: SimState, events: readonly GameEvent[]): TickResult {
  let unlockedAchievements = state.unlockedAchievements;
  const newEvents: GameEvent[] = [];

  for (const event of events) {
    for (const achievement of ACHIEVEMENT_LIST) {
      if (unlockedAchievements.includes(achievement.id)) continue;
      if (achievement.triggerEvent !== event.type) continue;
      if (!achievement.condition(event)) continue;
      unlockedAchievements = [...unlockedAchievements, achievement.id];
      newEvents.push({ type: 'achievement:unlocked', achievementId: achievement.id as AchievementId });
    }
  }

  if (newEvents.length === 0) return { state, events: [] };
  return { state: { ...state, unlockedAchievements }, events: newEvents };
}

export const TICK_SYSTEMS = [spawnSystem, dewdropSystem, unlockSystem, automationSystem];

// Re-exported for runtime.ts / tests without reaching into ids.ts directly.
export type { AutomationId };
