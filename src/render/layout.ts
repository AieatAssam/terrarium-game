// Static garden layout: garden paths and decorative scenery on the 16x16
// grid. The Nursery/habitat/automation-site tile POSITIONS themselves live
// in src/sim/layout.ts now (docs/CONTRACTS.md: "sim owns tile positions");
// this module re-exports them for convenience and adds render-only concerns
// (path tiles for mesh generation, decorative scatter) that sim has no
// reason to know about.
//
// All positions are TileCoord; every consumer must still go through
// tileToWorld (src/sim/grid.ts) to get world space. Nothing here invents its
// own screen-space math.

import type { TileCoord } from '../sim/grid';
import { GRID_SIZE } from '../sim/grid';
import { AUTOMATION_SITE_TILES, HABITAT_TILES, NURSERY_TILE } from '../sim/layout';

export { AUTOMATION_SITE_TILES, HABITAT_TILES, NURSERY_TILE };

/** Straight-line (Manhattan step) path tiles from the Nursery to one habitat, inclusive of both ends. */
function pathBetween(from: TileCoord, to: TileCoord): TileCoord[] {
  const tiles: TileCoord[] = [];
  let x = from.x;
  let z = from.z;
  tiles.push({ x, z });
  while (x !== to.x) {
    x += x < to.x ? 1 : -1;
    tiles.push({ x, z });
  }
  while (z !== to.z) {
    z += z < to.z ? 1 : -1;
    tiles.push({ x, z });
  }
  return tiles;
}

export const GARDEN_PATH_TILES: TileCoord[] = (() => {
  const seen = new Set<string>();
  const tiles: TileCoord[] = [];
  for (const habitatTile of Object.values(HABITAT_TILES)) {
    for (const tile of pathBetween(NURSERY_TILE, habitatTile)) {
      const key = `${tile.x},${tile.z}`;
      if (!seen.has(key)) {
        seen.add(key);
        tiles.push(tile);
      }
    }
  }
  return tiles;
})();

function tileKey(tile: TileCoord): string {
  return `${tile.x},${tile.z}`;
}

const RESERVED_TILE_KEYS: Set<string> = new Set([
  tileKey(NURSERY_TILE),
  ...Object.values(HABITAT_TILES).map(tileKey),
  ...Object.values(AUTOMATION_SITE_TILES).map(tileKey),
  ...GARDEN_PATH_TILES.map(tileKey),
]);

export function isReservedTile(tile: TileCoord): boolean {
  return RESERVED_TILE_KEYS.has(tileKey(tile));
}

/**
 * Deterministic decorative scenery scatter (foliage/rocks/water) — a fixed
 * layout, not randomized per-session, so it's stable across reloads and easy
 * to eyeball in QA. Skips any reserved (nursery/habitat/path/automation)
 * tile. `kind` picks which manifest key family to look up in assets.ts.
 */
export interface SceneryPlacement {
  tile: TileCoord;
  kind: 'foliage' | 'rock' | 'water';
  variant: number;
}

export const SCENERY_PLACEMENTS: SceneryPlacement[] = (() => {
  const placements: SceneryPlacement[] = [];
  // Small mulberry32-style local LCG so the scatter is deterministic without
  // touching src/sim's RNG (that PRNG's seed is sim state, not ours to read).
  let seed = 0x9e3779b9;
  const next = (): number => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const kinds: SceneryPlacement['kind'][] = ['foliage', 'rock', 'water'];
  let placed = 0;
  let attempts = 0;
  const target = 22;
  while (placed < target && attempts < 400) {
    attempts += 1;
    const tile: TileCoord = {
      x: Math.floor(next() * GRID_SIZE),
      z: Math.floor(next() * GRID_SIZE),
    };
    if (isReservedTile(tile)) continue;
    if (placements.some((p) => p.tile.x === tile.x && p.tile.z === tile.z)) continue;
    const kind = kinds[Math.floor(next() * kinds.length)];
    placements.push({ tile, kind, variant: Math.floor(next() * 3) + 1 });
    placed += 1;
  }
  return placements;
})();
