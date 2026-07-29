// World<->tile coordinate helpers for the renderer. `tileToWorld` itself is
// owned by src/sim/grid.ts (docs/CONTRACTS.md: "single shared mapping,
// consumed by E") and MUST stay the only forward mapping anyone uses — this
// file only adds the strict inverse (`worldToTile`), which sim doesn't need
// and doesn't define. Renderer/input code should prefer reading a tile back
// off `mesh.metadata.tile` (stashed at mesh-build time) over calling
// `worldToTile` on a picked point, since world->tile math necessarily loses
// precision that metadata doesn't — `worldToTile` exists mainly for ground
// picking (translating a raw pointer/ground hit into "which tile is this"
// when there's no mesh metadata to read, e.g. an empty patch of grass).

import { GRID_SIZE, isWithinGrid, tileToWorld, type TileCoord } from '../sim/grid';

const TILE_WORLD_SIZE = 1; // must mirror src/sim/grid.ts's private constant

/**
 * Strict inverse of `tileToWorld`: rounds to the nearest integer tile.
 * Returns a tile even if it falls outside the 16x16 grid — callers that care
 * should check `isWithinGrid` themselves (re-exported below for convenience).
 */
export function worldToTile(world: { x: number; z: number }): TileCoord {
  // `+ 0` normalizes a `-0` result (e.g. Math.round(-0.2)) to `0` so
  // deep-equal comparisons against `{ x: 0 }` behave as expected.
  return {
    x: Math.round(world.x / TILE_WORLD_SIZE) + 0,
    z: Math.round(world.z / TILE_WORLD_SIZE) + 0,
  };
}

export { isWithinGrid, tileToWorld, GRID_SIZE };
export type { TileCoord };

/** World-space center of the 16x16 grid; camera targets/frames this. */
export function gridCenterWorld(size: number = GRID_SIZE): { x: number; y: number; z: number } {
  return tileToWorld({ x: (size - 1) / 2, z: (size - 1) / 2 });
}

/** Manhattan tile distance, used for hover/snap radius checks. */
export function tileDistance(a: TileCoord, b: TileCoord): number {
  return Math.abs(a.x - b.x) + Math.abs(a.z - b.z);
}
