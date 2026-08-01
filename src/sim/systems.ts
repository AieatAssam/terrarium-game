// Phase 1 gameplay systems — the piece docs/CONTRACTS.md's Phase 2 split
// never assigned to anyone (see tick.ts's original "extension seam nobody
// owns" comment). Pure functions over SimState, composed by runTick
// (tick-based systems) or called directly (immediate reactions to player
// intent: a drop, a purchase) from src/sim/runtime.ts, the one module
// allowed to hold live mutable state and talk to the event bus.

import type { AchievementId, AutomationId, HabitatId, MoodId, SproutTypeId, UpgradeId } from '../core/ids';
import type { GameEvent } from '../events/types';
import { ACHIEVEMENT_LIST } from '../data/achievements';
import { sproutMatchesHabitat, SPROUT_TYPES } from '../data/sproutTypes';
import { getEffectiveHabitatCapacity, HABITATS } from '../data/habitats';
import { getDewdropMultiplier, UPGRADES } from '../data/upgrades';
import {
  getNurseryPaceMultiplier,
  getNurseryRhythm,
  getPodSpawnIntervalMs,
  pickMood,
  pickSproutType,
} from '../data/spawning';
import {
  isColourGateUnlocked,
  isGardenSlideUnlocked,
  isMoodBellUnlocked,
  type ColourGateUnlockState,
  type MoodBellUnlockState,
} from '../data/unlocks';
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
  isValidAutomationSite,
  nearestReachableHabitat,
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

  // Two INDEPENDENT draws — type and mood are deliberately orthogonal
  // attributes (Mood Bell feature, 2026-08-01). Reusing one draw for both
  // would make mood a pure function of type (e.g. ember always sunny),
  // silently collapsing the entire point of a second attribute — see
  // src/data/spawning.ts's pickMood doc comment.
  const typeRoll = nextRandom(state.rngSeed);
  const sproutType = pickSproutType(typeRoll.value);
  const moodRoll = nextRandom(typeRoll.nextSeed);
  const mood = pickMood(moodRoll.value);
  const sprout: SproutInstance = {
    id: makeSproutId(state),
    sproutType,
    mood,
    tile: NURSERY_TILE,
    state: 'idle',
  };

  events.push({ type: 'sprout:spawned', sproutId: sprout.id, sproutType, mood, podId: 'nursery' });
  return {
    state: {
      ...state,
      spawnAccumulatorMs: accumulated - interval,
      nurseryRhythm: rhythm,
      nurseryWaitingCount: waitingCount,
      rngSeed: moodRoll.nextSeed,
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

/**
 * Garden Slide auto-unlocks once the manual-placement threshold is hit.
 *
 * 2026-08-01 revision (plan.yaml Phase 1.2): this used to ALSO auto-build
 * the Slide in the same step, always targeting Sunflower Meadow. Unlocking
 * now only removes the restriction on placing it — the player places it by
 * hand via `placeAutomation` below, and its destination is computed from
 * WHEREVER they put it (`nearestReachableHabitat`), not hardcoded. This is
 * what resolves the previously-reported visual incoherence (a structure
 * standing north of the Nursery while its forced-Meadow ride went south,
 * never touching it) — the player choosing the site tile is now what
 * decides the destination, so the two can never disagree again.
 */
export function unlockSystem(state: SimState): TickResult {
  if (state.unlockedAutomations.includes('gardenSlide') || !isGardenSlideUnlocked(state.correctPlacementCount)) {
    return { state, events: [] };
  }

  return {
    state: { ...state, unlockedAutomations: [...state.unlockedAutomations, 'gardenSlide'] },
    events: [{ type: 'automation:unlocked', automationId: 'gardenSlide' }],
  };
}

/**
 * Player commits a placement for an already-unlocked-but-not-yet-placed
 * automation (2026-08-01, plan.yaml Phase 1.2/1.4) — the "plain function
 * the runtime exposes" pattern this codebase already uses for
 * setColourGateLane/setMoodBellRule, since docs/CONTRACTS.md's GameEvent
 * union has no dedicated "player wants to build X here" member. No-ops
 * (returns state unchanged) on any invalid request rather than throwing —
 * the caller (src/input's click-to-commit handler) is expected to have
 * already checked `isValidAutomationSite` for the ghost preview, but this
 * function re-validates rather than trusting the client, same discipline
 * `adjudicateAutomationDrop` already follows.
 */
export function placeAutomation(state: SimState, automationId: AutomationId, tile: TileCoord): TickResult {
  if (!state.unlockedAutomations.includes(automationId)) return { state, events: [] };
  if (state.automations.some((a) => a.automationId === automationId)) return { state, events: [] }; // already placed — one instance per kind
  const occupied = state.automations.map((a) => a.siteTile);
  if (!isValidAutomationSite(automationId, tile, occupied)) return { state, events: [] };

  const instanceId = `${automationId}-1`;
  const targetHabitatId = automationId === 'gardenSlide' ? (nearestReachableHabitat(tile, occupied) ?? undefined) : undefined;
  // gardenSlide needs a real destination to be worth placing at all — if
  // nothing is reachable (shouldn't happen on the current fixed network,
  // but a future dynamic one could momentarily disconnect a site), decline
  // rather than build a Slide with nowhere to go.
  if (automationId === 'gardenSlide' && !targetHabitatId) return { state, events: [] };

  const instance: AutomationInstance = {
    id: instanceId,
    automationId,
    siteTile: tile,
    fromTile: NURSERY_TILE,
    toTile: targetHabitatId ? HABITAT_TILES[targetHabitatId] : tile,
    builtAtTick: state.tickCount,
    targetHabitatId,
    carryingSproutId: null,
    completesAtTick: null,
  };

  const events: GameEvent[] = [{ type: 'automation:built', automationId, instanceId, siteTile: tile, targetHabitatId }];
  let colourGateLanes = state.colourGateLanes;
  let moodBellRule = state.moodBellRule;
  if (automationId === 'colourGate') {
    colourGateLanes = defaultColourGateLanes();
    events.push({ type: 'automation:colourGateRuleChanged', lanes: { ...colourGateLanes } });
  }
  if (automationId === 'moodBell') {
    moodBellRule = 'sunny';
    events.push({ type: 'automation:moodBellRuleChanged', mood: moodBellRule });
  }

  return {
    state: { ...state, automations: [...state.automations, instance], colourGateLanes, moodBellRule },
    events,
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
//   * a kind on no lane card at all (a Sun Sprout, a Star Sprout) — the Gate
//     itself never touches either. A Star Sprout waits by the pods for the
//     player, same as always. A Sun Sprout is NOT stuck waiting, though: once
//     the Garden Slide is built (unlockSystem, above) it always feeds the
//     southern run to Sunflower Meadow automatically, independent of the
//     Gate's own two lanes;
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

// ---------------------------------------------------------------------------
// Mood Bell routing (GameRules §9.5/§7.3/§9.6 stage 4) — a second, orthogonal
// Sprout attribute ("mood") and a third automation that routes on it.
// ---------------------------------------------------------------------------
// Unlike the Colour Gate (one fixed lane -> one fixed habitat), the Bell has
// no per-lane habitat map: it carries a Sprout of the mood it currently
// welcomes to THAT SPROUT'S OWN correct habitat, computed from its type —
// the destination varies per ride, the Slide's never does.

/**
 * The one habitat this Sprout type belongs in, or null (Star — no single
 * correct habitat, same reason the Colour Gate never offers it as a lane
 * choice). Pure and exported so the UI can explain the Bell without
 * duplicating this lookup.
 */
export function moodBellDestination(sproutType: SproutTypeId): HabitatId | null {
  return SPROUT_TYPES[sproutType].habitatId;
}

/**
 * True when a Sprout is "claimed" by the Mood Bell — i.e. matches its
 * current rule AND the Bell actually exists. This is the traffic-partition
 * fix: without it, the Garden Slide and Colour Gate (checked earlier in
 * automationSystem's per-tick dispatch loop, by build order) would keep
 * taking any Sprout they're independently eligible for, and the Bell — which
 * is ALWAYS checked after them below — would never see a matching Sprout
 * before they did. A newly-built Bell would then visibly do nothing for its
 * cost. Both the Garden Slide branch and the Colour Gate's leg-1 (fresh
 * Nursery pickup) branch of `planRide` exclude any Sprout this returns true
 * for, so building the Bell genuinely reassigns one whole mood's worth of
 * traffic away from them — a real partition, not a priority race. False
 * whenever the Bell doesn't exist yet, so the Slide/Gate are completely
 * unaffected until the player actually builds it.
 *
 * "Exists" is checked via `state.automations` (an actual instance present),
 * not `unlockedAutomations` — the same idiom `colourGateBehavioralState`
 * already uses for "is the Slide built". In real play the two are always in
 * sync (`purchaseUpgrade` adds to both atomically), but keying off the
 * concrete instance is the structurally correct signal, consistent with how
 * the rest of this file answers "does this automation concretely exist".
 */
function isMoodBellClaimed(state: SimState, sprout: SproutInstance): boolean {
  return sprout.mood === state.moodBellRule && state.automations.some((a) => a.automationId === 'moodBell');
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
  if (instance.automationId === 'moodBell') {
    const sprout = findIdleAt(sprouts, NURSERY_TILE, (s) => {
      if (s.mood !== state.moodBellRule) return false;
      const dest = moodBellDestination(s.sproutType);
      return dest !== null && !habitatIsFull(state, dest);
    });
    if (!sprout) return null;
    const dest = moodBellDestination(sprout.sproutType) as HabitatId;
    return { sprout, fromTile: NURSERY_TILE, toTile: HABITAT_TILES[dest] };
  }

  if (instance.automationId === 'gardenSlide') {
    const dest = instance.targetHabitatId;
    if (!dest || habitatIsFull(state, dest)) return null; // target full — wait rather than force a rejected delivery
    const wantType = HABITATS[dest].matchSproutType;
    // Excludes a Sprout the Mood Bell has claimed (see isMoodBellClaimed) —
    // once the Bell exists, a Sprout of its current mood is the Bell's, even
    // if it also matches the Slide's fixed target type.
    const sprout = findIdleAt(sprouts, NURSERY_TILE, (s) => s.sproutType === wantType && !isMoodBellClaimed(state, s));
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
  //
  // Deliberately NOT excluded by isMoodBellClaimed: a Sprout already standing
  // at the signpost started this journey before (or independent of) the
  // Bell's claim on its mood, and must be allowed to finish it — only a FRESH
  // Nursery pickup (leg 1, below) is partitioned away from the Bell.
  const atGate = findIdleAt(sprouts, COLOUR_GATE_TILE, (s) => !justArrived.has(s.id) && canGoOn(s) !== null);
  if (atGate) {
    return { sprout: atGate, fromTile: COLOUR_GATE_TILE, toTile: HABITAT_TILES[canGoOn(atGate) as HabitatId] };
  }

  // Leg 1: call one forward from the Nursery — but only one the Gate can
  // actually place, so nobody is invited to a journey that ends nowhere.
  // Also excludes a Sprout the Mood Bell has claimed (see isMoodBellClaimed).
  const atNursery = findIdleAt(sprouts, NURSERY_TILE, (s) => canGoOn(s) !== null && !isMoodBellClaimed(state, s));
  return atNursery ? { sprout: atNursery, fromTile: NURSERY_TILE, toTile: COLOUR_GATE_TILE } : null;
}

/**
 * Marks `sproutId` as boarded on `instance` and bound for `toTile`, computing
 * the ride's duration the one authoritative way (`transportDuration`).
 * Factored out of `automationSystem`'s own dispatch loop so a manual drop
 * onto a built automation site (`adjudicateAutomationDrop` below) starts a
 * ride through the EXACT same mechanics the automation uses on its own next
 * tick, rather than a second, potentially-diverging implementation.
 */
function beginRide(
  sprouts: SproutInstance[],
  upgradeLevels: SimState['upgradeLevels'],
  tickCount: number,
  instance: AutomationInstance,
  sproutId: string,
  fromTile: TileCoord,
  toTile: TileCoord,
): { sprouts: SproutInstance[]; instance: AutomationInstance; event: GameEvent } {
  const distance = tileDistance(fromTile, toTile);
  const { durationTicks, durationMs } = transportDuration(instance, upgradeLevels, distance);
  const nextSprouts = sprouts.map((s) => (s.id === sproutId ? { ...s, state: 'transporting' as const, tile: toTile } : s));
  const event: GameEvent = {
    type: 'sprout:transportStarted',
    sproutId,
    automationId: instance.automationId,
    instanceId: instance.id,
    fromTile,
    toTile,
    durationMs,
  };
  const nextInstance: AutomationInstance = {
    ...instance,
    fromTile,
    toTile,
    carryingSproutId: sproutId,
    completesAtTick: tickCount + durationTicks,
  };
  return { sprouts: nextSprouts, instance: nextInstance, event };
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

    const result = beginRide(sprouts, working.upgradeLevels, working.tickCount, instance, plan.sprout.id, plan.fromTile, plan.toTile);
    sprouts = result.sprouts;
    events.push(result.event);
    // `fromTile`/`toTile` are updated per ride, not just at build time: the
    // Colour Gate's two legs have different endpoints, and Phase 1 completion
    // reads `toTile` to decide whether the Sprout has reached a home.
    nextAutomations.push(result.instance);
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

/**
 * Sets the Mood Bell's rule: which mood it currently welcomes. Mirrors
 * `setColourGateLane`'s no-op-if-unchanged shape — a single toggle rather
 * than a 2-lane map, so there is no "nobody yet"/null case to clear.
 *
 * No-ops (no event) when nothing would change, so the UI can call it freely.
 */
export function setMoodBellRule(state: SimState, mood: MoodId): TickResult {
  if (state.moodBellRule === mood) return { state, events: [] };
  return {
    state: { ...state, moodBellRule: mood },
    events: [{ type: 'automation:moodBellRuleChanged', mood }],
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

/**
 * Reason a manual drop onto a built automation site did not board the
 * Sprout — mirrors `colourGateLaneNote`'s spirit (a short, specific, never-
 * punitive explanation, GameRules §11) but as a plain code rather than prose:
 * sim stays decoupled from copywriting (docs/CONTRACTS.md: data/copy live in
 * src/data and src/ui, not src/sim), so a caller that wants player-facing
 * text composes it from this the same way UI composes copy from
 * `nursery:rhythmChanged`'s rhythm field.
 */
export type AutomationDropDeclineReason = 'notBuilt' | 'busy' | 'noRoute' | 'wrongKind' | 'destinationFull';

/**
 * Adjudicates a player dropping a Sprout directly onto a BUILT automation
 * structure (the Garden Slide or the Colour Gate) instead of a habitat —
 * "put this little one on the helper myself" rather than waiting for the
 * helper to notice it. GameRules §9.1 wants automation to feel like garden
 * care infrastructure the player can also work WITH, not just observe.
 *
 * Deliberately held to the exact same eligibility `planRide` (this module's
 * own tick-based dispatcher) would apply to this automation on its very next
 * tick — routed through the same `beginRide` — so a manual drop can never
 * start a ride the automation itself would have refused, and never needs a
 * second, potentially-diverging notion of "can this instance carry this kind
 * right now". An ineligible drop declines with a specific reason and changes
 * nothing: the Sprout stays exactly where it was, still idle, still pickable,
 * per the same "never punitive" rule `adjudicatePlacement` already follows
 * for a wrong-habitat drop.
 */
export function adjudicateAutomationDrop(state: SimState, sproutId: string, automationId: AutomationId): TickResult {
  const decline = (reason: AutomationDropDeclineReason): TickResult => ({
    state,
    events: [{ type: 'sprout:automationDeclined', sproutId, automationId, reason }],
  });

  const sprout = state.sprouts.find((s) => s.id === sproutId);
  if (!sprout || sprout.state !== 'idle') return { state, events: [] }; // stray/late drop — silently no-op, same guard as adjudicatePlacement

  const instance = state.automations.find((a) => a.automationId === automationId);
  if (!instance) return decline('notBuilt'); // renderer should never offer an unbuilt site as a drop target, but never trust the client
  if (instance.carryingSproutId) return decline('busy'); // one ride at a time per instance, same as automationSystem

  let toTile: TileCoord;
  if (automationId === 'gardenSlide') {
    const dest = instance.targetHabitatId;
    if (!dest) return decline('noRoute');
    if (sprout.sproutType !== HABITATS[dest].matchSproutType) return decline('wrongKind');
    if (habitatIsFull(state, dest)) return decline('destinationFull');
    toTile = HABITAT_TILES[dest];
  } else if (automationId === 'moodBell') {
    if (sprout.mood !== state.moodBellRule) return decline('wrongKind');
    const dest = moodBellDestination(sprout.sproutType);
    if (!dest) return decline('wrongKind'); // Star: no single correct habitat
    if (habitatIsFull(state, dest)) return decline('destinationFull');
    toTile = HABITAT_TILES[dest]; // single leg, no "which leg" split unlike the Gate
  } else {
    const dest = colourGateDestination(state.colourGateLanes, sprout.sproutType);
    if (!dest) return decline('wrongKind');
    if (habitatIsFull(state, dest)) return decline('destinationFull');
    // Whichever leg this Sprout is actually due for: leg 2 (Gate -> home) if
    // it happens to already be standing at the signpost, leg 1 (Nursery/
    // wherever it was picked up -> Gate) otherwise — the same split
    // `planRide` makes, keyed here to THIS Sprout's own current tile rather
    // than a search over every idle Sprout.
    toTile = sameTile(sprout.tile, COLOUR_GATE_TILE) ? HABITAT_TILES[dest] : COLOUR_GATE_TILE;
  }

  const result = beginRide(state.sprouts, state.upgradeLevels, state.tickCount, instance, sproutId, sprout.tile, toTile);
  const automations = state.automations.map((a) => (a.id === instance.id ? result.instance : a));
  return { state: { ...state, sprouts: result.sprouts, automations }, events: [result.event] };
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

/**
 * Behavioral gate for purchasing moodBellUnlock — both prior automations
 * already built. Keyed off `state.automations` (an actual placed instance),
 * NOT `unlockedAutomations` — see 2026-08-01: once unlocking and placing
 * decoupled (plan.yaml Phase 1.2), `unlockedAutomations` alone no longer
 * implies a structure exists, so this must match colourGateBehavioralState's
 * already-correct idiom above rather than the old (pre-decoupling, harmless
 * because unlock+build used to be atomic) shortcut.
 */
export function moodBellBehavioralState(state: SimState): MoodBellUnlockState {
  return {
    gardenSlideBuilt: state.automations.some((a) => a.automationId === 'gardenSlide'),
    colourGateBuilt: state.automations.some((a) => a.automationId === 'colourGate'),
  };
}

/**
 * Purchases an upgrade: applies the effect and, for colourGateUnlock/
 * moodBellUnlock, adds to `unlockedAutomations` — but only once each one's
 * behavioral unlock condition (docs/GAME_DESIGN.md) is actually met.
 *
 * 2026-08-01 revision (plan.yaml Phase 1.2): this used to ALSO auto-build
 * the instance in the same step. It no longer does — unlocking only removes
 * the restriction on placing it; the player places it by hand via
 * `placeAutomation`, which is also where the default Colour Gate lanes /
 * Mood Bell rule now get set (moved out of here, since they only make sense
 * once a structure actually exists).
 *
 * Silently no-ops (no charge) if unaffordable, maxed, already unlocked, or
 * (colourGateUnlock/moodBellUnlock only) not yet behaviorally unlocked.
 */
export function purchaseUpgrade(state: SimState, upgradeId: UpgradeId): TickResult {
  const def = UPGRADES[upgradeId];
  const level = state.upgradeLevels[upgradeId] ?? 0;
  if (level >= def.maxLevel) return { state, events: [] };

  if (upgradeId === 'colourGateUnlock' && !isColourGateUnlocked(colourGateBehavioralState(state))) {
    return { state, events: [] };
  }
  if (upgradeId === 'moodBellUnlock' && !isMoodBellUnlocked(moodBellBehavioralState(state))) {
    return { state, events: [] };
  }
  const automationId: AutomationId | null =
    upgradeId === 'colourGateUnlock' ? 'colourGate' : upgradeId === 'moodBellUnlock' ? 'moodBell' : null;
  if (automationId && state.unlockedAutomations.includes(automationId)) return { state, events: [] }; // already unlocked

  const cost = def.costForLevel(level + 1);
  if (state.dewdrops < cost) return { state, events: [] };

  const dewdrops = state.dewdrops - cost;
  const newLevel = level + 1;
  const events: GameEvent[] = [
    { type: 'upgrade:purchased', upgradeId, level: newLevel },
    { type: 'currency:dewdropsChanged', total: dewdrops, delta: -cost },
  ];

  let unlockedAutomations = state.unlockedAutomations;
  if (automationId) {
    unlockedAutomations = [...unlockedAutomations, automationId];
    events.push({ type: 'automation:unlocked', automationId });
  }

  return {
    state: {
      ...state,
      dewdrops,
      upgradeLevels: { ...state.upgradeLevels, [upgradeId]: newLevel },
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
