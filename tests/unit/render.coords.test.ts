import { describe, expect, it } from 'vitest';

import { GRID_SIZE, gridCenterWorld, tileDistance, tileToWorld, worldToTile } from '../../src/render/coords';

describe('render/coords: tileToWorld / worldToTile round-trip', () => {
  it('maps known tile inputs to the expected world output', () => {
    expect(tileToWorld({ x: 0, z: 0 })).toEqual({ x: 0, y: 0, z: 0 });
    expect(tileToWorld({ x: 5, z: 3 })).toEqual({ x: 5, y: 0, z: 3 });
  });

  it('round-trips every tile in the 16x16 grid through world space', () => {
    for (let x = 0; x < GRID_SIZE; x++) {
      for (let z = 0; z < GRID_SIZE; z++) {
        const tile = { x, z };
        const world = tileToWorld(tile);
        expect(worldToTile(world)).toEqual(tile);
      }
    }
  });

  it('round-trips the grid corners explicitly', () => {
    const corners = [
      { x: 0, z: 0 },
      { x: GRID_SIZE - 1, z: 0 },
      { x: 0, z: GRID_SIZE - 1 },
      { x: GRID_SIZE - 1, z: GRID_SIZE - 1 },
    ];
    for (const tile of corners) {
      expect(worldToTile(tileToWorld(tile))).toEqual(tile);
    }
  });

  it('rounds a noisy world point to the nearest tile', () => {
    expect(worldToTile({ x: 4.4, z: 7.6 })).toEqual({ x: 4, z: 8 });
    expect(worldToTile({ x: -0.2, z: 0.49 })).toEqual({ x: 0, z: 0 });
  });

  it('places the grid center at the midpoint tile, not the origin corner', () => {
    const center = gridCenterWorld();
    expect(center).toEqual({ x: 7.5, y: 0, z: 7.5 });
  });

  it('computes Manhattan tile distance', () => {
    expect(tileDistance({ x: 0, z: 0 }, { x: 3, z: 4 })).toBe(7);
    expect(tileDistance({ x: 5, z: 5 }, { x: 5, z: 5 })).toBe(0);
  });
});
