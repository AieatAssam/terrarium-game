// Phase 1 gameplay systems — the piece docs/CONTRACTS.md's Phase 2 split
// never assigned to anyone (see tick.ts's original "extension seam nobody
// owns" comment). Pure functions over SimState, composed by runTick
// (tick-based systems) or called directly (immediate reactions to player
// intent: a drop, a purchase) from src/sim/runtime.ts, the one module
// allowed to hold live mutable state and talk to the event bus.

import type { AchievementId, AutomationId, HabitatId, SproutTypeId, UpgradeId } from '../core/ids';
import type { GameEvent } from '../events/types';
import { ACHIEVEMENT_LIST } from '../data/achievements';
import { sproutMatchesHabitat, SPROUT_TYPES } from '../data/sproutTypes';
import { getEffectiveHabitatCapacity, HABITATS } from '../data/habitats';
import { getDewdropMultiplier, UPGRADES } from '../data/upgrades';
import {
  getNurseryPaceMultiplier,
  getNurseryRhythm,
  getPodSpawnIntervalMs,
  pickSproutType,
} from '../data/spawning';
import { isColourGateUnlocked, isGardenSlideUnlocked, type ColourGateUnlockState } from '../data/unlocks';
import { nextRandom } from './rng';
import { TICK_MS } from './loop';
import type { TileCoord } from './grid';
import {
  COLOUR_GATE_LANE_HABITATS,
  COLOUR_GATE_LANE_LIST,
  COLOUR_GATE_TILE,
  defaultColourGateLanes,
  habitatAtTile,
  HABITAT_TILES,
  NURSERY_TILE,
  sameTile,
  tileDistance,
  type ColourGateLane,
  type ColourGateLanes,
} from './layout';
import type { AutomationInstance, HabitatState, SimState, SproutInstance } from './state';
import type { TickResult } from './tick';

const HABITAT_ORDER: HabitatId[] = ['emberNook', 'dewPond', 'sunflowerMeadow'];
/**
 * Unupgraded ride time per tile of Manhattan distance. This is the ONLY place
 * transport pace is defined: the renderer used to hold its own copy of the same
 * 420 and animate from it, which meant the `gardenSlideSpeed` upgrade (applied
 * here, in `transportMsPerTile`) changed when a Sprout settled but never how
 * fast it looked like it was travelling. The resolved duration now rides along
 * on `sprout:transportStarted` (see src/events/types.ts) so the animation and
 * the simulation share one clock.
 */
const BASE_TRANSPORT_MS_PER_TILE = 420;

/** Deterministic id — never Date.now()/Math.random(), so sim stays reproducible per docs/CONTRACTS.md. */
function makeSproutId(state: SimState): string {
  return `sprout-${state.tickCount}-${state.sprouts.length}`;
}

// ---------------------------------------------------------------------------
// Tick-based systems (composed via runTick in src/sim/runtime.ts)
// ---------------------------------------------------------------------------

/**
 * Sprouts that have arrived and not yet found a home — the ones standing in the
 * Nursery's waiting area, plus any pausing at the Colour Gate's signpost because
 * their lane's home filled up mid-journey. Anything settled or mid-ride is, by
 * definition, already being looked after.
 *
 * This is the single number the Nursery's rhythm reads (see src/data/spawning.ts).
 */
export function countWaitingSprouts(state: SimState): number {
  let waiting = 0;
  for (const sprout of state.sprouts) if (sprout.state === 'idle') waiting += 1;
  return waiting;
}

/**
 * Spawns a new Sprout at the Nursery once the podRhythm-adjusted interval
 * elapses — but only while the garden has room to welcome one.
 *
 * The pod reads how many little ones are already waiting and eases its rhythm
 * accordingly, resting entirely once the waiting area is crowded (see the
 * "Nursery rhythm" section of src/data/spawning.ts for the rule and the reason).
 * NOTHING is ever deleted or lost here — the queue simply stops growing, and the
 * pod picks straight back up the moment the player settles a few Sprouts or buys
 * Habitat Room.
 *
 * While resting, the spawn accumulator is clamped to ONE lively interval rather
 * than left to run away. Without the clamp, a garden that rested for ten minutes
 * would fire a dozen pods back-to-back the instant it recovered — an accidental
 * punishment for having solved the problem. With it, exactly one Sprout arrives
 * promptly (a nice "the garden breathes again" beat) and the normal cadence
 * resumes from there.
 */
export function spawnSystem(state: SimState): TickResult {
  const waitingCount = countWaitingSprouts(state);
  const rhythm = getNurseryRhythm(waitingCount);
  const events: GameEvent[] = [];
  // Announced on a change of rhythm OR of the crowd size while the pod is not
  // lively: the note quotes the number, and freezing it at whatever it was when
  // the pod dozed off left the player reading "814 little ones are waiting"
  // while they had settled half of them (browser QA). While lively the note is
  // hidden anyway, so the count is not re-announced for every ordinary spawn.
  const countChangedWhileQuiet = rhythm !== 'lively' && waitingCount !== state.nurseryWaitingCount;
  if (rhythm !== state.nurseryRhythm || countChangedWhileQuiet) {
    events.push({ type: 'nursery:rhythmChanged', rhythm, waitingCount });
  }

  const podRhythmLevel = state.upgradeLevels.podRhythm ?? 0;
  const livelyInterval = getPodSpawnIntervalMs(podRhythmLevel);
  const interval = livelyInterval * getNurseryPaceMultiplier(waitingCount);
  const accumulated =
    rhythm === 'resting'
      ? Math.min(state.spawnAccumulatorMs + TICK_MS, livelyInterval)
      : state.spawnAccumulatorMs + TICK_MS;

  if (rhythm === 'resting' || accumulated < interval) {
    return { state: { ...state, spawnAccumulatorMs: accumulated, nurseryRhythm: rhythm, nurseryWaitingCount: waitingCount }, events };
  }

  const { value, nextSeed } = nextRandom(state.rngSeed);
  const sproutType = pickSproutType(value);
  const sprout: SproutInstance = {
    id: makeSproutId(state),
    sproutType,
    tile: NURSERY_TILE,
    state: 'idle',
  };

  events.push({ type: 'sprout:spawned', sproutId: sprout.id, sproutType, podId: 'nursery' });
  return {
    state: {
      ...state,
      spawnAccumulatorMs: accumulated - interval,
      nurseryRhythm: rhythm,
      nurseryWaitingCount: waitingCount,
      rngSeed: nextSeed,
      sprouts: [...state.sprouts, sprout],
    },
    events,
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
      { type: 'automation:built', automationId: 'gardenSlide', instanceId, targetHabitatId: target },
    ],
  };
}

// ---------------------------------------------------------------------------
// Colour Gate routing (GameRules §9.4)
// ---------------------------------------------------------------------------
// "This garden sign guides one kind of Sprout down the right path."
//
// The Gate stands at the fork at the north end of the trunk (src/sim/layout.ts).
// Two lanes leave it — WEST to the Ember Nook, EAST to the Dew Pond — and the
// player's whole control is a large picture card on each lane saying which kind
// of Sprout that lane invites. No boolean logic, no conditions, no numbers
// (§9.4, §6.4).
//
// A matching Sprout physically PASSES THROUGH the Gate, in two legs: it rides
// the trunk from the Nursery up to the Gate tile, pauses there, then rides on
// down its lane to its home. Both legs travel real painted path tiles, and
// `tileDistance(Nursery, Gate) + tileDistance(Gate, home)` equals
// `tileDistance(Nursery, home)`, so the whole journey takes exactly as long as
// the old straight-to-the-habitat ride did.
//
// Everything else goes to the fallback, which is the waiting area it is already
// standing in: the Gate simply does not call it forward. That covers three
// cases, all of them kind and all of them legible:
//
//   * a kind on no lane card at all (a Sun Sprout, a Star Sprout) — it waits by
//     the pods for the player, and the southern run to the Sunflower Meadow is
//     the untouched hand-carried route;
//   * a lane card naming a kind that lane's home is NOT a home for (the player
//     put Ember on the east lane, which leads to the Dew Pond) — the Gate
//     refuses to carry them somewhere they would only be turned away from, and
//     the lane card says so in plain garden language (see colourGateLaneNote).
//     Carrying them and bouncing them back would be an endless shuttle;
//   * a lane whose home is currently full — they wait, exactly as the Garden
//     Slide already waits rather than forcing a rejected delivery.
//
// A Sprout that reaches the Gate and can no longer go on (its home filled while
// it was travelling, or the player changed the rule mid-ride) simply stands at
// the signpost as an ordinary idle Sprout. It is still pickable, still counted
// as waiting, never lost — and it is re-checked every tick, so it moves on by
// itself the moment the way is clear again.

/**
 * The home the Colour Gate would send this kind of Sprout to, or null if it
 * would not call it forward at all. Pure and exported so the UI can explain the
 * current rule without duplicating it.
 */
export function colourGateDestination(lanes: ColourGateLanes, sproutType: SproutTypeId): HabitatId | null {
  for (const lane of COLOUR_GATE_LANE_LIST) {
    if (lanes[lane] !== sproutType) continue;
    const habitatId = COLOUR_GATE_LANE_HABITATS[lane];
    // The lane's home has to actually welcome this kind. `sproutMatchesHabitat`
    // is the one sanctioned check (it also encodes "a Star Sprout is happy
    // anywhere"), but Star is never offered as a lane choice — see
    // setColourGateLane.
    if (!sproutMatchesHabitat(sproutType, habitatId)) continue;
    return habitatId;
  }
  return null;
}

/**
 * Friendly, specific feedback for one lane card — null when the lane is fine.
 * GameRules §9.4 requires missing/incorrect outputs to "produce friendly,
 * specific feedback", and §11 requires that copy to be concrete and warm rather
 * than a technical error.
 */
export function colourGateLaneNote(lanes: ColourGateLanes, lane: ColourGateLane): string | null {
  const sproutType = lanes[lane];
  if (!sproutType) return 'This lane is quiet for now. Choose a kind of Sprout to send along it.';
  const habitatId = COLOUR_GATE_LANE_HABITATS[lane];
  if (sproutMatchesHabitat(sproutType, habitatId)) return null;
  const home = SPROUT_TYPES[sproutType].habitatId;
  const homeName = home ? HABITATS[home].displayName : 'somewhere else';
  return `${HABITATS[habitatId].displayName} is not home to ${SPROUT_TYPES[sproutType].displayName}s — they are looking for the ${homeName}, so the Gate is letting them wait by the pods instead.`;
}

/** True when `habitat` has no room left right now. */
function habitatIsFull(state: SimState, habitatId: HabitatId): boolean {
  const capacity = getEffectiveHabitatCapacity(habitatId, state.upgradeLevels.habitatCapacity ?? 0);
  return (state.habitats[habitatId]?.count ?? 0) >= capacity;
}

/** One journey an automation is about to start. */
interface RidePlan {
  sprout: SproutInstance;
  fromTile: TileCoord;
  toTile: TileCoord;
}

function findIdleAt(sprouts: SproutInstance[], tile: TileCoord, accept: (s: SproutInstance) => boolean): SproutInstance | null {
  return sprouts.find((s) => s.state === 'idle' && sameTile(s.tile, tile) && accept(s)) ?? null;
}

/**
 * What this automation should carry next, or null if it should stay put.
 *
 * The Garden Slide is unchanged: one fixed home, one matching kind, straight
 * there. The Colour Gate has TWO dispatch paths, and checks them in this order
 * on purpose — clearing the crossroads always comes before adding to it, so
 * Sprouts never stack up at the signpost while the trunk keeps feeding it.
 */
function planRide(
  state: SimState,
  instance: AutomationInstance,
  sprouts: SproutInstance[],
  justArrived: ReadonlySet<string>,
): RidePlan | null {
  if (instance.automationId === 'gardenSlide') {
    const dest = instance.targetHabitatId;
    if (!dest || habitatIsFull(state, dest)) return null; // target full — wait rather than force a rejected delivery
    const wantType = HABITATS[dest].matchSproutType;
    const sprout = findIdleAt(sprouts, NURSERY_TILE, (s) => s.sproutType === wantType);
    return sprout ? { sprout, fromTile: NURSERY_TILE, toTile: HABITAT_TILES[dest] } : null;
  }

  const canGoOn = (s: SproutInstance): HabitatId | null => {
    const dest = colourGateDestination(state.colourGateLanes, s.sproutType);
    return dest && !habitatIsFull(state, dest) ? dest : null;
  };

  // Leg 2: someone already standing at the Gate whose lane is open — send them on.
  //
  // `justArrived` holds whoever was set down at the Gate on THIS tick, and they
  // are deliberately skipped: the Gate reads each little one for a beat before
  // waving it down its lane. Without that beat the arrival and the departure
  // land in the same event batch, the Sprout never visibly stops at the
  // signpost, and the Gate's decision becomes invisible — which is the whole
  // thing this redesign exists to fix (GameRules §9.4). One tick is enough to
  // separate them, and it costs nothing: leg 1 (8 ticks) plus this beat plus
  // leg 2 (25 ticks) is 34 ticks, the same as the old direct ride.
  const atGate = findIdleAt(sprouts, COLOUR_GATE_TILE, (s) => !justArrived.has(s.id) && canGoOn(s) !== null);
  if (atGate) {
    return { sprout: atGate, fromTile: COLOUR_GATE_TILE, toTile: HABITAT_TILES[canGoOn(atGate) as HabitatId] };
  }

  // Leg 1: call one forward from the Nursery — but only one the Gate can
  // actually place, so nobody is invited to a journey that ends nowhere.
  const atNursery = findIdleAt(sprouts, NURSERY_TILE, (s) => canGoOn(s) !== null);
  return atNursery ? { sprout: atNursery, fromTile: NURSERY_TILE, toTile: COLOUR_GATE_TILE } : null;
}

export function transportMsPerTile(instance: AutomationInstance, upgradeLevels: SimState['upgradeLevels']): number {
  if (instance.automationId !== 'gardenSlide') return BASE_TRANSPORT_MS_PER_TILE;
  const level = upgradeLevels.gardenSlideSpeed ?? 0;
  const factor = (1 - UPGRADES.gardenSlideSpeed.effect.magnitudePerLevel) ** level;
  return BASE_TRANSPORT_MS_PER_TILE * factor;
}

/**
 * Whole ticks a ride takes, and the exact wall-clock interval those ticks
 * represent. `durationMs` is deliberately derived from the ROUNDED tick count
 * rather than from `msPerTile * distance` directly: the sim settles the Sprout
 * on a tick boundary, so the tick count — not the un-rounded ideal — is the
 * interval the renderer has to match to arrive at the same moment.
 *
 * Exported for unit tests and so nothing has to re-derive this rounding.
 */
export function transportDuration(
  instance: AutomationInstance,
  upgradeLevels: SimState['upgradeLevels'],
  distanceTiles: number,
): { durationTicks: number; durationMs: number } {
  const msPerTile = transportMsPerTile(instance, upgradeLevels);
  const durationTicks = Math.max(1, Math.round((msPerTile * distanceTiles) / TICK_MS));
  return { durationTicks, durationMs: durationTicks * TICK_MS };
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

/**
 * Advances every built automation instance: finishes transports that have
 * arrived, then starts new ones for whoever's free and has a Sprout to carry.
 *
 * An arrival settles the Sprout when the ride ended ON a habitat tile, and
 * otherwise simply sets it down where it is. That second case is the Colour
 * Gate's first leg: the Sprout has reached the crossroads, not a home, so it
 * stands at the signpost as an ordinary idle Sprout until the Gate sends it on
 * (usually the very next tick). Deriving this from the ride's destination TILE
 * rather than from a per-instance "what am I carrying this for" field means the
 * two legs need no extra state and cannot disagree with each other.
 */
export function automationSystem(state: SimState): TickResult {
  const events: GameEvent[] = [];
  let working = state;

  // Phase 1: complete arrivals.
  const completedInstances: string[] = [];
  /** Set down at the Colour Gate on this very tick — they rest a beat before the Gate waves them on. */
  const justArrived = new Set<string>();
  for (const instance of working.automations) {
    if (instance.carryingSproutId && instance.completesAtTick !== null && working.tickCount >= instance.completesAtTick) {
      const sprout = working.sprouts.find((s) => s.id === instance.carryingSproutId);
      if (sprout) {
        events.push({
          type: 'sprout:transportCompleted',
          sproutId: sprout.id,
          automationId: instance.automationId,
          instanceId: instance.id,
        });
        const arrivedAt = habitatAtTile(instance.toTile);
        if (arrivedAt) {
          const result = settleSprout(working, sprout.id, arrivedAt);
          working = result.state;
          events.push(...result.events);
        } else {
          // Reached the Colour Gate, not a home: step off and wait here.
          justArrived.add(sprout.id);
          working = {
            ...working,
            sprouts: working.sprouts.map((s) =>
              s.id === sprout.id ? { ...s, tile: instance.toTile, state: 'idle' as const } : s,
            ),
          };
        }
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

  // Phase 2: start new transports for whoever's free. `sprouts` is threaded
  // through the loop so an automation earlier in the list has already marked its
  // passenger as travelling by the time a later one looks — two automations can
  // never board the same Sprout on the same tick.
  const nextAutomations: AutomationInstance[] = [];
  let sprouts = working.sprouts;
  for (const instance of working.automations) {
    if (instance.carryingSproutId) {
      nextAutomations.push(instance);
      continue;
    }
    const plan = planRide(working, instance, sprouts, justArrived);
    if (!plan) {
      nextAutomations.push(instance);
      continue;
    }

    const distance = tileDistance(plan.fromTile, plan.toTile);
    const { durationTicks, durationMs } = transportDuration(instance, working.upgradeLevels, distance);

    sprouts = sprouts.map((s) => (s.id === plan.sprout.id ? { ...s, state: 'transporting' as const, tile: plan.toTile } : s));
    events.push({
      type: 'sprout:transportStarted',
      sproutId: plan.sprout.id,
      automationId: instance.automationId,
      instanceId: instance.id,
      fromTile: plan.fromTile,
      toTile: plan.toTile,
      // Sim is the single authority on ride time — the renderer animates over
      // exactly this interval instead of deriving its own (see the field's doc
      // comment in src/events/types.ts).
      durationMs,
    });
    // `fromTile`/`toTile` are updated per ride, not just at build time: the
    // Colour Gate's two legs have different endpoints, and Phase 1 completion
    // reads `toTile` to decide whether the Sprout has reached a home.
    nextAutomations.push({
      ...instance,
      fromTile: plan.fromTile,
      toTile: plan.toTile,
      carryingSproutId: plan.sprout.id,
      completesAtTick: working.tickCount + durationTicks,
    });
  }

  return { state: { ...working, automations: nextAutomations, sprouts }, events };
}

/**
 * Sets one lane card on the Colour Gate. `sproutType` of null clears the lane
 * ("nobody yet"). Star Sprouts are deliberately not accepted: they are happy in
 * any home, so routing them automatically would quietly rob the player of the
 * rare-reveal moment GameRules §6.5 protects.
 *
 * No-ops (no event) when nothing would change, so the UI can call it freely.
 */
export function setColourGateLane(state: SimState, lane: ColourGateLane, sproutType: SproutTypeId | null): TickResult {
  if (sproutType === 'star') return { state, events: [] };
  if (state.colourGateLanes[lane] === sproutType) return { state, events: [] };
  const colourGateLanes: ColourGateLanes = { ...state.colourGateLanes, [lane]: sproutType };
  return {
    state: { ...state, colourGateLanes },
    events: [{ type: 'automation:colourGateRuleChanged', lanes: { ...colourGateLanes } }],
  };
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
  let colourGateLanes = state.colourGateLanes;
  if (upgradeId === 'colourGateUnlock') {
    const instanceId = 'colourGate-1';
    const instance: AutomationInstance = {
      id: instanceId,
      automationId: 'colourGate',
      fromTile: NURSERY_TILE,
      toTile: COLOUR_GATE_TILE,
      builtAtTick: state.tickCount,
      carryingSproutId: null,
      completesAtTick: null,
    };
    automations = [...automations, instance];
    unlockedAutomations = [...unlockedAutomations, 'colourGate'];
    // A new Gate always opens with the safe, recommended rule (GameRules §9.1),
    // so it works the moment it is built instead of arriving blank.
    colourGateLanes = defaultColourGateLanes();
    events.push({ type: 'automation:unlocked', automationId: 'colourGate' });
    events.push({ type: 'automation:built', automationId: 'colourGate', instanceId });
    events.push({ type: 'automation:colourGateRuleChanged', lanes: { ...colourGateLanes } });
  }

  return {
    state: {
      ...state,
      dewdrops,
      upgradeLevels: { ...state.upgradeLevels, [upgradeId]: newLevel },
      automations,
      unlockedAutomations,
      colourGateLanes,
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
