// Guards the garden-path route a transported Sprout actually follows
// (src/render/sprouts.ts's `gardenRouteBetween`).
//
// Background: the `sprout:transportStarted` animation lerped STRAIGHT from the
// Nursery tile to the habitat tile, so a carried Sprout drifted diagonally
// across open grass while the L-shaped garden path sat unused beside it.
// GameRules §9.2 makes the paths the physical route and §9.3 requires the
// Garden Slide to visibly carry Sprouts along it.
//
// These are pure geometry assertions over the route polyline — no Babylon
// scene, no canvas — so they run headless with the rest of the unit suite.

import { describe, expect, it } from 'vitest';

import { gardenRouteBetween, gardenSlideRideBetween, SPROUT_RIDE_HEIGHT, type GardenRoute } from '../../src/render/sprouts';
import { GARDEN_PATH_TILES, GARDEN_SLIDE_TILE, HABITAT_TILES, NURSERY_TILE } from '../../src/render/layout';
import { GARDEN_SLIDE } from '../../src/render/propDims';
import { tileToWorld, worldToTile } from '../../src/render/coords';
import type { TileCoord } from '../../src/sim/grid';

const HABITAT_IDS = Object.keys(HABITAT_TILES) as Array<keyof typeof HABITAT_TILES>;
const PATH_KEYS = new Set(GARDEN_PATH_TILES.map((t) => `${t.x},${t.z}`));

/** Point at arc-length fraction `f` along the route. */
function pointAt(route: GardenRoute, f: number): { x: number; z: number } {
  const target = Math.min(1, Math.max(0, f)) * route.totalLength;
  let i = 0;
  while (i < route.count - 2 && route.cumulative[i + 1] < target) i += 1;
  const span = route.cumulative[i + 1] - route.cumulative[i];
  const local = span > 1e-9 ? (target - route.cumulative[i]) / span : 0;
  return {
    x: route.points[i * 2] + (route.points[i * 2 + 2] - route.points[i * 2]) * local,
    z: route.points[i * 2 + 1] + (route.points[i * 2 + 3] - route.points[i * 2 + 1]) * local,
  };
}

/** Perpendicular distance from `p` to the straight segment a→b. */
function distanceToStraightLine(p: { x: number; z: number }, a: TileCoord, b: TileCoord): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const length = Math.hypot(dx, dz);
  if (length < 1e-9) return Math.hypot(p.x - a.x, p.z - a.z);
  return Math.abs(dz * (p.x - a.x) - dx * (p.z - a.z)) / length;
}

describe('garden-path routes for transported Sprouts', () => {
  it('finds a route from the Nursery to every habitat', () => {
    for (const id of HABITAT_IDS) {
      expect(gardenRouteBetween(NURSERY_TILE, HABITAT_TILES[id]), id).not.toBeNull();
    }
  });

  it('starts on the Nursery tile and ends on the habitat tile', () => {
    for (const id of HABITAT_IDS) {
      const route = gardenRouteBetween(NURSERY_TILE, HABITAT_TILES[id]);
      if (!route) throw new Error(`no route to ${id}`);
      const from = tileToWorld(NURSERY_TILE);
      const to = tileToWorld(HABITAT_TILES[id]);
      expect(route.points[0]).toBeCloseTo(from.x, 6);
      expect(route.points[1]).toBeCloseTo(from.z, 6);
      expect(route.points[(route.count - 1) * 2]).toBeCloseTo(to.x, 6);
      expect(route.points[(route.count - 1) * 2 + 1]).toBeCloseTo(to.z, 6);
    }
  });

  it('stays on the painted garden path for its whole length', () => {
    // The point of the fix: sampled densely, every position a carried Sprout
    // occupies belongs to a tile that actually has path art on it.
    for (const id of HABITAT_IDS) {
      const route = gardenRouteBetween(NURSERY_TILE, HABITAT_TILES[id]);
      if (!route) throw new Error(`no route to ${id}`);
      for (let s = 0; s <= 200; s += 1) {
        const p = pointAt(route, s / 200);
        const tile = worldToTile(p);
        expect(PATH_KEYS.has(`${tile.x},${tile.z}`), `${id} @ ${s / 200}: tile ${tile.x},${tile.z}`).toBe(true);
      }
    }
  });

  it('is not the old straight diagonal — it visibly departs from it around the corner', () => {
    // emberNook (4,4) and dewPond (12,4) both sit off the Nursery's own row, so
    // the straight lerp cut a long diagonal across bare grass. The routed path
    // has to swing well clear of that line.
    for (const id of ['emberNook', 'dewPond'] as const) {
      const route = gardenRouteBetween(NURSERY_TILE, HABITAT_TILES[id]);
      if (!route) throw new Error(`no route to ${id}`);
      let maxDeviation = 0;
      for (let s = 0; s <= 100; s += 1) {
        maxDeviation = Math.max(maxDeviation, distanceToStraightLine(pointAt(route, s / 100), NURSERY_TILE, HABITAT_TILES[id]));
      }
      expect(maxDeviation, id).toBeGreaterThan(1);
    }
  });

  it('rounds its corners instead of snapping through a right angle', () => {
    // Every consecutive pair of polyline segments must turn gently. A raw tile
    // walk would contain a single 90° turn; the fillet spreads it over several
    // small ones, which is what makes the ride read as conveyance rather than a
    // stop-and-pivot.
    for (const id of HABITAT_IDS) {
      const route = gardenRouteBetween(NURSERY_TILE, HABITAT_TILES[id]);
      if (!route) throw new Error(`no route to ${id}`);
      let sharpest = 0;
      for (let i = 1; i < route.count - 1; i += 1) {
        const ax = route.points[i * 2] - route.points[(i - 1) * 2];
        const az = route.points[i * 2 + 1] - route.points[(i - 1) * 2 + 1];
        const bx = route.points[(i + 1) * 2] - route.points[i * 2];
        const bz = route.points[(i + 1) * 2 + 1] - route.points[i * 2 + 1];
        const turn = Math.abs(Math.atan2(ax * bz - az * bx, ax * bx + az * bz));
        sharpest = Math.max(sharpest, turn);
      }
      expect(sharpest, `${id} sharpest turn (rad)`).toBeLessThan(Math.PI / 6); // < 30°, vs. the 90° a raw tile walk would have
    }
  });

  it('advances monotonically, with a usable arc-length parameterisation', () => {
    for (const id of HABITAT_IDS) {
      const route = gardenRouteBetween(NURSERY_TILE, HABITAT_TILES[id]);
      if (!route) throw new Error(`no route to ${id}`);
      expect(route.totalLength).toBeGreaterThan(0);
      expect(route.cumulative[0]).toBe(0);
      expect(route.cumulative[route.count - 1]).toBeCloseTo(route.totalLength, 9);
      for (let i = 1; i < route.count; i += 1) {
        expect(route.cumulative[i]).toBeGreaterThan(route.cumulative[i - 1]);
      }
      // Rounding a corner never lengthens the walk.
      const manhattan = Math.abs(HABITAT_TILES[id].x - NURSERY_TILE.x) + Math.abs(HABITAT_TILES[id].z - NURSERY_TILE.z);
      expect(route.totalLength).toBeLessThanOrEqual(manhattan + 1e-6);
    }
  });

  it('caches: the same pair returns the identical object, so nothing is rebuilt per ride', () => {
    const first = gardenRouteBetween(NURSERY_TILE, HABITAT_TILES.emberNook);
    const second = gardenRouteBetween(NURSERY_TILE, HABITAT_TILES.emberNook);
    expect(second).toBe(first);
  });

  it('returns null (renderer falls back to a straight lerp) when an endpoint is off the path', () => {
    const offPath: TileCoord = { x: 0, z: 0 };
    expect(PATH_KEYS.has('0,0')).toBe(false); // fixture sanity
    expect(gardenRouteBetween(NURSERY_TILE, offPath)).toBeNull();
    expect(gardenRouteBetween(offPath, HABITAT_TILES.emberNook)).toBeNull();
  });

  it('keeps a Garden Slide ride on its authored channel before leaving for the habitat', () => {
    const route = gardenSlideRideBetween(GARDEN_SLIDE_TILE, HABITAT_TILES.sunflowerMeadow);
    if (!route) throw new Error('no Garden Slide ride route');
    expect(route.points[0]).toBeCloseTo(NURSERY_TILE.x, 6);
    expect(route.points[1]).toBeCloseTo(NURSERY_TILE.z, 6);
    expect(route.points[(route.count - 1) * 2]).toBeCloseTo(HABITAT_TILES.sunflowerMeadow.x, 6);
    expect(route.points[(route.count - 1) * 2 + 1]).toBeCloseTo(HABITAT_TILES.sunflowerMeadow.z, 6);
    expect(route.heights[0]).toBeCloseTo(SPROUT_RIDE_HEIGHT, 6);

    const entryZ = GARDEN_SLIDE_TILE.z + GARDEN_SLIDE.path[0].z;
    const exitZ = GARDEN_SLIDE_TILE.z + GARDEN_SLIDE.path[GARDEN_SLIDE.path.length - 1].z;
    const entryIndex = Array.from({ length: route.count }, (_, index) => index).find(
      (index) => Math.abs(route.points[index * 2 + 1] - entryZ) < 1e-6,
    );
    const exitIndex = Array.from({ length: route.count }, (_, index) => index).find(
      (index) => Math.abs(route.points[index * 2 + 1] - exitZ) < 1e-6,
    );
    expect(entryIndex).toBeDefined();
    expect(exitIndex).toBeDefined();
    expect(route.heights[entryIndex!]).toBeGreaterThan(route.heights[exitIndex!]);
  });
});
