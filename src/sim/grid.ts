// Single shared coordinate mapping (docs/CONTRACTS.md, "World grid"). Sim owns
// tile positions; the renderer (Subagent E) must map through tileToWorld and
// never invent its own screen-space math. No screen-space math belongs in sim.

export interface TileCoord {
  x: number;
  z: number;
}

// 16x16 fixed grid for Phase 1, per CONTRACTS.md.
export const GRID_SIZE = 16;

// World units per tile edge. Kept as a named constant (not a magic number) so
// the renderer's camera/zoom math and this mapping can only ever agree.
const TILE_WORLD_SIZE = 1;

export function tileToWorld(tile: TileCoord): { x: number; y: number; z: number } {
  return {
    x: tile.x * TILE_WORLD_SIZE,
    y: 0,
    z: tile.z * TILE_WORLD_SIZE,
  };
}

export function isWithinGrid(tile: TileCoord, size: number = GRID_SIZE): boolean {
  return tile.x >= 0 && tile.x < size && tile.z >= 0 && tile.z < size;
}
