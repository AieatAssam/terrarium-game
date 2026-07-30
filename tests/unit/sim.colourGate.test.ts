// The Colour Gate as an actual piece of routing infrastructure — GameRules
// §9.4 ("routes matching Sprouts toward a connected output, and sends
// nonmatches to fallback/waiting paths") and §9.2 ("Phase 1 paths connect
// Nursery, Slide, Gate and Habitat").
//
// Before this, the Gate was decorative in three independent ways: it stood in
// open grass off every path, the garden contained no fork for it to govern, and
// `destinationFor` sent every Sprout straight from the Nursery to its habitat
// so the Gate never participated in routing at all. These tests pin the three
// fixes together, because any one of them alone leaves it decorative again.

import { describe, expect, it } from 'vitest';

import { createInitialSimState, type SimState } from '../../src/sim/state';
import {
  adjudicatePlacement,
  automationSystem,
  colourGateDestination,
  colourGateLaneNote,
  purchaseUpgrade,
  setColourGateLane,
  transportDuration,
} from '../../src/sim/systems';
import { runTick } from '../../src/sim/tick';
import { TICK_MS } from '../../src/sim/loop';
import {
  COLOUR_GATE_LANE_HABITATS,
  COLOUR_GATE_LANE_LIST,
  COLOUR_GATE_TILE,
  GARDEN_SLIDE_TILE,
  HABITAT_TILES,
  NURSERY_TILE,
  defaultColourGateLanes,
  habitatAtTile,
  sameTile,
  tileDistance,
} from '../../src/sim/layout';
import { HABITATS } from '../../src/data/habitats';
import { UNLOCK_THRESHOLDS } from '../../src/data/unlocks';
import { UPGRADES } from '../../src/data/upgrades';
import type { GameEvent } from '../../src/events/types';
import type { SproutTypeId } from '../../src/core/ids';

const CAP = HABITATS.emberNook.baseCapacity;

/** A state with a built Colour Gate and nothing else automating. */
function withGate(overrides: Partial<SimState> = {}): SimState {
  const base = createInitialSimState(1);
  return {
    ...base,
    automations: [
      {
        id: 'colourGate-1',
        automationId: 'colourGate',
        fromTile: NURSERY_TILE,
        toTile: COLOUR_GATE_TILE,
        builtAtTick: 0,
        carryingSproutId: null,
        completesAtTick: null,
      },
    ],
    unlockedAutomations: ['colourGate'],
    ...overrides,
  };
}

function withSprout(state: SimState, sproutType: SproutTypeId, id = 'test-sprout', tile = NURSERY_TILE): SimState {
  return { ...state, sprouts: [...state.sprouts, { id, sproutType, tile, state: 'idle' as const }] };
}

/** Runs the automation system until nothing more happens, collecting every event. */
function drive(state: SimState, ticks: number): { state: SimState; events: GameEvent[] } {
  const events: GameEvent[] = [];
  let working = state;
  for (let i = 0; i < ticks; i += 1) {
    const result = runTick(working, [automationSystem]);
    working = result.state;
    events.push(...result.events);
  }
  return { state: working, events };
}

const sproutById = (state: SimState, id: string) => state.sprouts.find((s) => s.id === id);

describe('garden topology (the fork the Gate governs)', () => {
  it('puts the Gate on a real fork, with both lanes leading to a home', () => {
    expect(habitatAtTile(COLOUR_GATE_TILE)).toBeNull(); // the Gate is a crossroads, not a destination
    const homes = COLOUR_GATE_LANE_LIST.map((lane) => COLOUR_GATE_LANE_HABITATS[lane]);
    expect(new Set(homes).size).toBe(2); // two genuinely different outputs, i.e. a decision
    for (const home of homes) expect(HABITAT_TILES[home]).toBeDefined();
  });

  it('stands the Slide and the Gate between the Nursery and the northern homes', () => {
    // Both automation sites used to sit in open grass at (6,6)/(10,6), off every
    // path — GameRules §9.2 requires Phase 1 paths to connect Nursery, Slide,
    // Gate and Habitat. They now sit on the shared trunk, in that order.
    expect(sameTile(GARDEN_SLIDE_TILE, NURSERY_TILE)).toBe(false);
    expect(tileDistance(NURSERY_TILE, GARDEN_SLIDE_TILE)).toBe(1);
    expect(tileDistance(GARDEN_SLIDE_TILE, COLOUR_GATE_TILE)).toBe(1);
  });

  it('costs a Sprout nothing to travel via the Gate rather than straight to its home', () => {
    // The load-bearing arithmetic: routing THROUGH the Gate must be exactly as
    // long as the old direct ride, or every Colour Gate delivery would silently
    // become slower than a Garden Slide one and the renderer's path walk would
    // stop agreeing with the sim's Manhattan distance.
    for (const lane of COLOUR_GATE_LANE_LIST) {
      const home = HABITAT_TILES[COLOUR_GATE_LANE_HABITATS[lane]];
      expect(tileDistance(NURSERY_TILE, COLOUR_GATE_TILE) + tileDistance(COLOUR_GATE_TILE, home)).toBe(
        tileDistance(NURSERY_TILE, home),
      );
    }
  });
});

describe('colourGateDestination (the rule itself)', () => {
  it('sends each kind down the lane whose card names it', () => {
    const lanes = defaultColourGateLanes();
    expect(colourGateDestination(lanes, 'ember')).toBe('emberNook');
    expect(colourGateDestination(lanes, 'dew')).toBe('dewPond');
  });

  it('calls nobody forward for a kind on no card at all', () => {
    const lanes = defaultColourGateLanes();
    // No lane leads to the Sunflower Meadow — that run leaves the Nursery
    // southward and stays the hand-carried route. Star Sprouts are never routed.
    expect(colourGateDestination(lanes, 'sun')).toBeNull();
    expect(colourGateDestination(lanes, 'star')).toBeNull();
  });

  it('refuses to carry a kind toward a home that is not its home', () => {
    // The player may put Ember on the east lane, which leads to the Dew Pond.
    // Carrying them there would only get them turned away and bounced back — an
    // endless shuttle. The Gate declines instead, and says why.
    const lanes = { west: null, east: 'ember' as SproutTypeId };
    expect(colourGateDestination(lanes, 'ember')).toBeNull();
    const note = colourGateLaneNote(lanes, 'east');
    expect(note).toBeTruthy();
    expect(note).toContain('Dew Pond');
    expect(note).toContain('Ember Nook');
    // Friendly, not technical (GameRules §11).
    expect(note?.toLowerCase()).not.toMatch(/error|invalid|fail|filter|splitter/);
  });

  it('says something kind about an empty lane too, rather than nothing', () => {
    expect(colourGateLaneNote({ west: null, east: 'dew' }, 'west')).toBeTruthy();
    expect(colourGateLaneNote({ west: 'ember', east: 'dew' }, 'west')).toBeNull();
  });
});

describe('setColourGateLane', () => {
  it('changes a lane and announces the new rule', () => {
    const result = setColourGateLane(withGate(), 'west', 'sun');
    expect(result.state.colourGateLanes.west).toBe('sun');
    expect(result.events).toEqual([
      { type: 'automation:colourGateRuleChanged', lanes: { west: 'sun', east: 'dew' } },
    ]);
  });

  it('clears a lane to "nobody"', () => {
    const result = setColourGateLane(withGate(), 'east', null);
    expect(result.state.colourGateLanes.east).toBeNull();
    expect(result.events).toHaveLength(1);
  });

  it('never accepts a Star Sprout — the rare reveal stays a hand-placed moment', () => {
    const result = setColourGateLane(withGate(), 'west', 'star');
    expect(result.events).toEqual([]);
    expect(result.state.colourGateLanes.west).toBe('ember');
  });

  it('is silent when nothing would change, so the UI can call it freely', () => {
    expect(setColourGateLane(withGate(), 'west', 'ember').events).toEqual([]);
  });

  it('is what a newly built Gate announces, with the safe recommended rule', () => {
    // GameRules §9.1: "Offer recommendations and safe defaults." A Gate that
    // arrives unset does nothing and reads as broken.
    const feedTicks = UNLOCK_THRESHOLDS.colourGate.requiredSingleHabitatFeedTicks ?? 0;
    let state: SimState = {
      ...createInitialSimState(1),
      dewdrops: UPGRADES.colourGateUnlock.costForLevel(1),
      tickCount: feedTicks,
      automations: [
        {
          id: 'gardenSlide-1',
          automationId: 'gardenSlide',
          fromTile: NURSERY_TILE,
          toTile: HABITAT_TILES.emberNook,
          builtAtTick: 0,
          targetHabitatId: 'emberNook',
          carryingSproutId: null,
          completesAtTick: null,
        },
      ],
    };
    for (let i = 0; i < (UNLOCK_THRESHOLDS.colourGate.requiredUnsortedPileSize ?? 0); i += 1) {
      state = withSprout(state, 'dew', `pile-${i}`);
    }
    const result = purchaseUpgrade(state, 'colourGateUnlock');
    expect(result.events).toContainEqual({
      type: 'automation:colourGateRuleChanged',
      lanes: { west: 'ember', east: 'dew' },
    });
    const gate = result.state.automations.find((a) => a.automationId === 'colourGate');
    expect(gate?.toTile).toEqual(COLOUR_GATE_TILE); // built ON the fork, not in open grass
  });
});

describe('a Sprout physically passing through the Gate', () => {
  it('rides the trunk to the Gate first, pauses there, then takes its lane home', () => {
    let state = withSprout(withGate(), 'ember');

    // --- Leg 1: Nursery -> Gate.
    const first = runTick(state, [automationSystem]);
    state = first.state;
    const leg1 = first.events.find((e) => e.type === 'sprout:transportStarted');
    expect(leg1).toBeDefined();
    if (leg1?.type !== 'sprout:transportStarted') throw new Error('unreachable');
    expect(leg1.fromTile).toEqual(NURSERY_TILE);
    expect(leg1.toTile).toEqual(COLOUR_GATE_TILE);
    expect(leg1.automationId).toBe('colourGate');

    // Arrives at the crossroads and is set down there — NOT settled anywhere.
    let arrived = false;
    for (let i = 0; i < 100 && !arrived; i += 1) {
      const tick = runTick(state, [automationSystem]);
      state = tick.state;
      arrived = tick.events.some((e) => e.type === 'sprout:transportCompleted');
      if (arrived) {
        expect(tick.events.some((e) => e.type === 'sprout:settled')).toBe(false);
      }
    }
    expect(arrived).toBe(true);

    // --- Leg 2 starts from the Gate, not from the Nursery.
    const second = runTick(state, [automationSystem]);
    state = second.state;
    const leg2 = second.events.find((e) => e.type === 'sprout:transportStarted');
    expect(leg2).toBeDefined();
    if (leg2?.type !== 'sprout:transportStarted') throw new Error('unreachable');
    expect(leg2.fromTile).toEqual(COLOUR_GATE_TILE);
    expect(leg2.toTile).toEqual(HABITAT_TILES.emberNook);

    const finished = drive(state, 100);
    expect(finished.events.some((e) => e.type === 'sprout:settled' && e.habitatId === 'emberNook')).toBe(true);
    expect(sproutById(finished.state, 'test-sprout')?.state).toBe('settled');
    expect(finished.state.habitats.emberNook?.count).toBe(1);
  });

  it('takes essentially as long in total as one direct ride would have', () => {
    // The tile arithmetic is exact (2 + 6 = 8), but each leg's duration is
    // rounded to whole sim ticks independently, so the two-leg journey can
    // differ by at most a tick or so either way. Asserted as a tolerance not as
    // equality because the exact figure is a rounding coincidence, not a design
    // guarantee — what matters is that going via the Gate is not a penalty.
    const gate = withGate().automations[0];
    const viaGate =
      transportDuration(gate, {}, tileDistance(NURSERY_TILE, COLOUR_GATE_TILE)).durationMs +
      transportDuration(gate, {}, tileDistance(COLOUR_GATE_TILE, HABITAT_TILES.dewPond)).durationMs;
    const direct = transportDuration(gate, {}, tileDistance(NURSERY_TILE, HABITAT_TILES.dewPond)).durationMs;
    expect(Math.abs(viaGate - direct)).toBeLessThanOrEqual(2 * TICK_MS);
  });

  it('routes each colour to its own lane, not all of them to one place', () => {
    // The whole point of a fork: with one Gate, ember goes west and dew goes
    // east, and both end up home.
    let state = withSprout(withSprout(withGate(), 'ember', 'e1'), 'dew', 'd1');
    state = drive(state, 400).state;
    expect(sproutById(state, 'e1')?.tile).toEqual(HABITAT_TILES.emberNook);
    expect(sproutById(state, 'd1')?.tile).toEqual(HABITAT_TILES.dewPond);
    expect(state.habitats.emberNook?.count).toBe(1);
    expect(state.habitats.dewPond?.count).toBe(1);
  });
});

describe('the fallback: nobody vanishes, nobody is carried nowhere', () => {
  it('leaves a kind on no lane card waiting comfortably at the Nursery', () => {
    // A Sun Sprout has no lane (the Meadow run leaves the Nursery southward and
    // stays hand-carried), so the Gate simply never calls it forward.
    const state = drive(withSprout(withGate(), 'sun'), 200).state;
    const sprout = sproutById(state, 'test-sprout');
    expect(sprout?.state).toBe('idle');
    expect(sprout?.tile).toEqual(NURSERY_TILE);
    expect(state.sprouts).toHaveLength(1); // still here — never despawned (§7.4)
  });

  it('leaves a Star Sprout for the player, so its reveal is never automated away', () => {
    const state = drive(withSprout(withGate(), 'star'), 200).state;
    expect(sproutById(state, 'test-sprout')?.state).toBe('idle');
  });

  it('never carries a Sprout toward a home that would turn it away', () => {
    // Ember assigned to the east lane, which leads to the Dew Pond.
    let state = setColourGateLane(withGate(), 'east', 'ember').state;
    state = setColourGateLane(state, 'west', null).state;
    state = withSprout(state, 'ember');
    const result = drive(state, 300);
    expect(result.events.some((e) => e.type === 'sprout:transportStarted')).toBe(false);
    expect(result.events.some((e) => e.type === 'sprout:placed:incorrect')).toBe(false);
    const sprout = sproutById(result.state, 'test-sprout');
    expect(sprout?.state).toBe('idle');
    expect(sprout?.tile).toEqual(NURSERY_TILE);
  });

  it('lets a Sprout stand at the signpost when its home fills mid-journey, then sends it on', () => {
    // Leg 1 departs with room in the Ember Nook; the home fills while it is on
    // the trunk. It must arrive, wait at the Gate as an ordinary Sprout, and
    // move on by itself once room appears — never be lost, never bounce.
    let state = withSprout(withGate(), 'ember');
    state = runTick(state, [automationSystem]).state; // leg 1 boards
    state = { ...state, habitats: { emberNook: { id: 'emberNook', count: CAP, capacity: CAP } } };

    state = drive(state, 200).state;
    const waiting = sproutById(state, 'test-sprout');
    expect(waiting?.state).toBe('idle');
    expect(waiting?.tile).toEqual(COLOUR_GATE_TILE); // parked at the crossroads, visible and pickable

    // Habitat Room is bought: the way is clear and it carries on unaided.
    state = { ...state, habitats: { emberNook: { id: 'emberNook', count: CAP, capacity: CAP } }, upgradeLevels: { habitatCapacity: 1 } };
    state = drive(state, 300).state;
    expect(sproutById(state, 'test-sprout')?.state).toBe('settled');
  });

  it('still lets the player pick up a Sprout waiting at the signpost', () => {
    // §7.4: waiting Sprouts must never become unreachable. One paused at the
    // Gate is an ordinary idle Sprout and a drop on its home still works.
    const state = withSprout(withGate(), 'ember', 'test-sprout', COLOUR_GATE_TILE);
    const result = adjudicatePlacement(state, 'test-sprout', 'emberNook');
    expect(result.events.some((e) => e.type === 'sprout:settled')).toBe(true);
  });

  it('stops sending a colour the moment its lane is cleared', () => {
    let state = setColourGateLane(withGate(), 'west', null).state;
    state = withSprout(state, 'ember');
    const result = drive(state, 200);
    expect(result.events.some((e) => e.type === 'sprout:transportStarted')).toBe(false);
    expect(sproutById(result.state, 'test-sprout')?.state).toBe('idle');
  });
});
