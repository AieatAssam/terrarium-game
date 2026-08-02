// Phase 2 buildable habitats (plan.yaml Phase 2.2, GameRules §10.0): the
// escalating cost curve, `placeHabitat`'s three gates, and the instance-aware
// ride rule that starts serving a player-built home on its next dispatch.

import { describe, expect, it } from 'vitest';
import { habitatBuildCost, HABITATS } from '../../src/data/habitats';
import { isValidHabitatSite, HABITAT_TILES, NURSERY_TILE } from '../../src/sim/layout';
import { createInitialSimState, type SimState } from '../../src/sim/state';
import { nearestReachableHabitatInstance, placeHabitat } from '../../src/sim/systems';
import type { HabitatId } from '../../src/core/ids';

const CAP = HABITATS.emberNook.baseCapacity;

// An original instance at the given (default: full) occupancy. `id` lets a
// fixture hand-plant a player-built copy (emberNook-2) with its own tile.
function instance(habitatId: HabitatId, count: number = CAP, id: string = `${habitatId}-1`): SimState['habitats'][number] {
  return { id, habitatId, tile: HABITAT_TILES[habitatId], count, builtAtTick: 0 };
}

/** A garden where only Ember Nook is full and the player holds enough Dewdrops
 * to afford the first (500-Dewdrop) extension. */
function stateWithFullEmberNook(dewdrops: number = 1000): SimState {
  return {
    ...createInitialSimState(1),
    dewdrops,
    habitats: [
      instance('emberNook'),
      instance('dewPond', 0),
      instance('sunflowerMeadow', 0),
    ],
  };
}

// A free path tile for the new home: on the painted network (the west lane's
// straight run) and not occupied by the Nursery, a habitat, or an automation
// site (GARDEN_SLIDE_TILE is (8,7), COLOUR_GATE_TILE (8,6), MOOD_BELL_TILE (9,8)).
// (11,6) is the east lane's mirror at the same Manhattan distance from the
// Slide's (8,7) trunk position, so the two make a genuine equidistant tie.
const VALID_SITE = { x: 5, z: 6 };
const VALID_SITE_2 = { x: 11, z: 6 };

describe('habitatBuildCost (escalating curve)', () => {
  it('makes the first player-built home (2nd instance overall) cost 500', () => {
    expect(habitatBuildCost(1)).toBe(500);
  });

  it('grows geometrically per instance of the kind, rounded to the nearest 5', () => {
    expect(habitatBuildCost(2)).toBe(950); // 3rd
    expect(habitatBuildCost(3)).toBe(1805); // 4th
  });

  it('is 500 for the floor count 0 (defensive: never cheaper than the base)', () => {
    expect(habitatBuildCost(0)).toBe(500);
  });
});

describe('isValidHabitatSite', () => {
  it('accepts a free painted-path tile', () => {
    expect(isValidHabitatSite(VALID_SITE, [])).toBe(true);
  });

  it('rejects a tile that is not on the path network', () => {
    expect(isValidHabitatSite({ x: 0, z: 0 }, [])).toBe(false);
  });

  it('rejects the Nursery tile', () => {
    expect(isValidHabitatSite(NURSERY_TILE, [])).toBe(false);
  });

  it('rejects any tile already occupied by a standing habitat or automation', () => {
    const occupied = [...Object.values(HABITAT_TILES), { x: 8, z: 7 }, { x: 8, z: 6 }];
    for (const tile of occupied) expect(isValidHabitatSite(tile, occupied)).toBe(false);
  });
});

describe('placeHabitat (gates)', () => {
  it('is a no-op when no instance of the kind is currently full (full-now gate)', () => {
    const state = { ...stateWithFullEmberNook(), habitats: [instance('emberNook', 0), instance('dewPond'), instance('sunflowerMeadow')] };
    const { state: next, events } = placeHabitat(state, 'emberNook', VALID_SITE);
    expect(next).toBe(state);
    expect(events).toEqual([]);
    expect(state.dewdrops).toBe(1000);
  });

  it('is a no-op when the player cannot afford the next cost', () => {
    const state = stateWithFullEmberNook(499);
    const { state: next, events } = placeHabitat(state, 'emberNook', VALID_SITE);
    expect(next).toBe(state);
    expect(events).toEqual([]);
  });

  it('is a no-op on an invalid site even when full and affordable', () => {
    const state = stateWithFullEmberNook();
    const { state: next, events } = placeHabitat(state, 'emberNook', { x: 0, z: 0 });
    expect(next).toBe(state);
    expect(events).toEqual([]);
  });

  it('does not treat another kind being full as satisfying this kind\'s gate', () => {
    // Only Dew Pond is full; Ember Nook has room. Ember Nook is not buildable.
    const state = {
      ...stateWithFullEmberNook(),
      habitats: [instance('emberNook', 0), instance('dewPond'), instance('sunflowerMeadow', 0)],
    };
    const { state: next, events } = placeHabitat(state, 'emberNook', VALID_SITE);
    expect(next).toBe(state);
    expect(events).toEqual([]);
  });
});

describe('placeHabitat (commit)', () => {
  it('deducts the full cost, adds the instance empty, and emits habitat:built + dewdrops', () => {
    const state = stateWithFullEmberNook(1000);
    const { state: next, events } = placeHabitat(state, 'emberNook', VALID_SITE);

    expect(next.habitats).toHaveLength(4);
    const built = next.habitats.find((h) => h.id === 'emberNook-2');
    expect(built).toMatchObject({ id: 'emberNook-2', habitatId: 'emberNook', tile: VALID_SITE, count: 0 });
    expect(next.dewdrops).toBe(500);

    expect(events).toEqual(
      expect.arrayContaining([
        { type: 'habitat:built', habitatId: 'emberNook', habitatInstanceId: 'emberNook-2', tile: VALID_SITE, cost: 500 },
        { type: 'currency:dewdropsChanged', total: 500, delta: -500 },
      ]),
    );
  });

  it('the next home of the same kind costs more (escalating per instance)', () => {
    const state = stateWithFullEmberNook(3000);
    const first = placeHabitat(state, 'emberNook', VALID_SITE).state;
    expect(first.dewdrops).toBe(3000 - 500);
    // First copy now stands empty, but the ORIGINAL is still full — so the
    // gate still passes and the SECOND copy costs the 3rd-instance price.
    const second = placeHabitat(first, 'emberNook', VALID_SITE_2).state;
    expect(second.dewdrops).toBe(3000 - 500 - 950);
    expect(second.habitats.some((h) => h.id === 'emberNook-3')).toBe(true);
  });
});

describe('nearestReachableHabitatInstance (instance-aware rides)', () => {
  it('serves the nearest reachable instance of the kind, preferring room', () => {
    // Ember Nook original full at (4,4); player-built copy at (5,6), empty.
    const state = {
      ...stateWithFullEmberNook(),
      habitats: [
        instance('emberNook', CAP, 'emberNook-1'),
        { ...instance('emberNook', 0, 'emberNook-2'), tile: VALID_SITE },
        instance('dewPond', 0),
        instance('sunflowerMeadow', 0),
      ],
    };
    const target = nearestReachableHabitatInstance(state, { x: 8, z: 7 }, 'emberNook');
    // The original is full, so the only instance with room is the built copy.
    expect(target?.id).toBe('emberNook-2');
  });

  it('starts serving a player-built instance the moment it appears', () => {
    const state = {
      ...stateWithFullEmberNook(),
      habitats: [instance('emberNook'), instance('dewPond', 0), instance('sunflowerMeadow', 0)],
    };
    // No room anywhere in Ember Nook -> no ride.
    expect(nearestReachableHabitatInstance(state, { x: 8, z: 7 }, 'emberNook')).toBeNull();

    const committed = placeHabitat(state, 'emberNook', VALID_SITE).state;
    const target = nearestReachableHabitatInstance(committed, { x: 8, z: 7 }, 'emberNook');
    expect(target).not.toBeNull();
    expect(target?.habitatId).toBe('emberNook');
  });

  it('ties break deterministically by lowest instance id', () => {
    // Two empty copies equidistant (4 tiles) from the Slide: the tie resolves
    // to the lowest instance id, never by insertion order or randomness. The
    // original at (4,4) is 7 tiles away and drops out of the tie.
    const state = {
      ...stateWithFullEmberNook(),
      habitats: [
        instance('emberNook', 0, 'emberNook-1'),
        { ...instance('emberNook', 0, 'emberNook-2'), tile: VALID_SITE },
        { ...instance('emberNook', 0, 'emberNook-3'), tile: VALID_SITE_2 },
      ],
    };
    const target = nearestReachableHabitatInstance(state, { x: 8, z: 7 }, 'emberNook');
    expect(target?.id).toBe('emberNook-2');
  });
});
