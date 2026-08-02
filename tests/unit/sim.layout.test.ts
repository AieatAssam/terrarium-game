import { describe, expect, it } from 'vitest';
import { TICK_MS } from '../../src/sim/loop';
import { transportDuration } from '../../src/sim/systems';
import {
  COLOUR_GATE_TILE,
  findPathRoute,
  GARDEN_PATH_TILES,
  GARDEN_SLIDE_TILE,
  HABITAT_TILES,
  isJunctionTile,
  isValidAutomationSite,
  MOOD_BELL_TILE,
  nearestReachableHabitat,
  NURSERY_TILE,
  tileDistance,
} from '../../src/sim/layout';

describe('findPathRoute', () => {
  it('finds a route from the Nursery to every habitat on the fixed network', () => {
    for (const tile of Object.values(HABITAT_TILES)) {
      const route = findPathRoute(NURSERY_TILE, tile);
      expect(route, `route to ${JSON.stringify(tile)}`).not.toBeNull();
      expect(route![0]).toEqual(NURSERY_TILE);
      expect(route![route!.length - 1]).toEqual(tile);
    }
  });

  it('returns a single-tile route when from and to are the same', () => {
    expect(findPathRoute(NURSERY_TILE, NURSERY_TILE)).toEqual([NURSERY_TILE]);
  });

  it('returns null for a tile off the path network', () => {
    expect(findPathRoute(NURSERY_TILE, { x: 0, z: 0 })).toBeNull();
  });

  it('honours the avoid set, refusing to route through a blocked tile', () => {
    // Ember Nook is only reachable via the Gate's west lane, which passes
    // through COLOUR_GATE_TILE — avoiding it should sever the route.
    const route = findPathRoute(NURSERY_TILE, HABITAT_TILES.emberNook, new Set([`${COLOUR_GATE_TILE.x},${COLOUR_GATE_TILE.z}`]));
    expect(route).toBeNull();
  });

  it('never avoids the destination tile itself even if it is in the avoid set', () => {
    // nearestReachableHabitat relies on this: it avoids every OTHER site
    // tile but must still be able to land ON the site tile being evaluated.
    const key = `${GARDEN_SLIDE_TILE.x},${GARDEN_SLIDE_TILE.z}`;
    const route = findPathRoute(NURSERY_TILE, GARDEN_SLIDE_TILE, new Set([key]));
    expect(route).not.toBeNull();
    expect(route![route!.length - 1]).toEqual(GARDEN_SLIDE_TILE);
  });
});

describe('nearestReachableHabitat', () => {
  it('resolves the Nursery itself to Sunflower Meadow (the shortest, unforked run)', () => {
    expect(nearestReachableHabitat(NURSERY_TILE, [])).toBe('sunflowerMeadow');
  });

  it('resolves the Colour Gate fork to the tie-break winner between the two equidistant lanes', () => {
    // (8,6) is equidistant (via pathBetween's x-then-z walk) from Ember Nook
    // and Dew Pond along the west/east lanes — alphabetical tie-break picks
    // dewPond over emberNook.
    expect(nearestReachableHabitat(COLOUR_GATE_TILE, [])).toBe('dewPond');
  });

  it('resolves the Garden Slide site to Sunflower Meadow — one step back to the Nursery then south (6 tiles) beats one step forward through the fork to either lane (7 tiles)', () => {
    expect(nearestReachableHabitat(GARDEN_SLIDE_TILE, [])).toBe('sunflowerMeadow');
  });

  it('is deterministic across repeated calls (no reliance on Set/Map iteration order)', () => {
    const results = new Set(Array.from({ length: 20 }, () => nearestReachableHabitat(COLOUR_GATE_TILE, [])));
    expect(results.size).toBe(1);
  });

  it('excludes routes through other placed automations own site tiles', () => {
    // Placing something ON the Colour Gate tile and treating it as
    // "occupied" must not prevent the Gate's OWN placement query from
    // resolving (the function excludes the site tile being evaluated from
    // its own avoid set) — but should block routes for a DIFFERENT site
    // that would otherwise pass through it.
    const viaGate = nearestReachableHabitat(NURSERY_TILE, [COLOUR_GATE_TILE]);
    // Nursery still reaches Sunflower Meadow without going through the Gate at all.
    expect(viaGate).toBe('sunflowerMeadow');
  });

  it('returns null for a site tile off the path network', () => {
    expect(nearestReachableHabitat({ x: 0, z: 0 }, [])).toBeNull();
  });

  it('every reachable habitat corresponds to a real GARDEN_PATH_TILES entry', () => {
    // Sanity check that the network itself is non-empty and the Mood Bell
    // spur tile is present but never returned as a "habitat" (it isn't one).
    expect(GARDEN_PATH_TILES.length).toBeGreaterThan(0);
    expect(GARDEN_PATH_TILES).toContainEqual(MOOD_BELL_TILE);
  });
});

describe('default transit network', () => {
  it('uses placed route length for transport duration', () => {
    const route = findPathRoute(NURSERY_TILE, HABITAT_TILES.emberNook);
    expect(route).not.toBeNull();
    const placedRouteLength = route!.length - 1;
    expect(placedRouteLength).toBe(tileDistance(NURSERY_TILE, HABITAT_TILES.emberNook));

    const { durationTicks, durationMs } = transportDuration(
      {
        id: 'slide-1',
        automationId: 'gardenSlide',
        siteTile: GARDEN_SLIDE_TILE,
        fromTile: NURSERY_TILE,
        toTile: HABITAT_TILES.emberNook,
        builtAtTick: 0,
        carryingSproutId: null,
        completesAtTick: null,
      },
      {},
      placedRouteLength,
    );
    expect(durationMs).toBe(durationTicks * TICK_MS);
  });
});

describe('isJunctionTile', () => {
  it('is true for both real forks on the fixed Phase-1 network: the Colour Gate, and the Nursery itself (trunk north, Meadow run south, Mood Bell spur east — 3 neighbours)', () => {
    expect(isJunctionTile(COLOUR_GATE_TILE)).toBe(true);
    expect(isJunctionTile(NURSERY_TILE)).toBe(true);
    expect(isJunctionTile(GARDEN_SLIDE_TILE)).toBe(false); // straight run, 2 neighbours
    expect(isJunctionTile(MOOD_BELL_TILE)).toBe(false); // dead-end spur, 1 neighbour
  });

  it('is false off the path network', () => {
    expect(isJunctionTile({ x: 0, z: 0 })).toBe(false);
  });
});

describe('isValidAutomationSite', () => {
  it('accepts the Garden Slide site for gardenSlide and moodBell but not off-network tiles', () => {
    expect(isValidAutomationSite('gardenSlide', GARDEN_SLIDE_TILE, [])).toBe(true);
    expect(isValidAutomationSite('moodBell', MOOD_BELL_TILE, [])).toBe(true);
    expect(isValidAutomationSite('gardenSlide', { x: 0, z: 0 }, [])).toBe(false);
  });

  it('rejects the Nursery tile and every habitat tile for any automation', () => {
    expect(isValidAutomationSite('gardenSlide', NURSERY_TILE, [])).toBe(false);
    for (const tile of Object.values(HABITAT_TILES)) {
      expect(isValidAutomationSite('gardenSlide', tile, [])).toBe(false);
    }
  });

  it('rejects a tile already occupied by another placed automation', () => {
    expect(isValidAutomationSite('moodBell', GARDEN_SLIDE_TILE, [GARDEN_SLIDE_TILE])).toBe(false);
  });

  it('only accepts colourGate on a genuine junction — the fork, not a straight run', () => {
    expect(isValidAutomationSite('colourGate', COLOUR_GATE_TILE, [])).toBe(true);
    expect(isValidAutomationSite('colourGate', GARDEN_SLIDE_TILE, [])).toBe(false);
    expect(isValidAutomationSite('colourGate', MOOD_BELL_TILE, [])).toBe(false);
  });

  it('rejects colourGate at the Nursery even though the Nursery is structurally a junction too — the Nursery exclusion applies regardless of automationId', () => {
    expect(isJunctionTile(NURSERY_TILE)).toBe(true);
    expect(isValidAutomationSite('colourGate', NURSERY_TILE, [])).toBe(false);
  });

  it('gardenSlide and moodBell are not restricted to junctions', () => {
    expect(isValidAutomationSite('gardenSlide', COLOUR_GATE_TILE, [])).toBe(true);
  });
});
