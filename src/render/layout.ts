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

// ---------------------------------------------------------------------------
// Garden path piece typing
// ---------------------------------------------------------------------------
// GARDEN_PATH_TILES above is the UNION of three Manhattan runs out of the
// Nursery, so the network genuinely contains corners, a junction and dead
// ends: with NURSERY_TILE (8,8) and habitats at (4,4)/(12,4)/(8,13) it is a
// horizontal run along z=8 from x=4..12, vertical runs at x=4 and x=12 up to
// z=4, and a vertical run at x=8 down to z=13. The first render pass drew
// EVERY tile with the single `path.segment.straight` key at zero rotation, so
// corners, the junction and the dead ends all rendered as straight runs
// pointing the same way — the road just stopped mattering at every turn.
//
// Piece type and orientation are derived here from each tile's four
// neighbours, and the renderer rotates the tile mesh by whole quarter turns.

/**
 * How a source SVG's own four edges land in the world, listed in the order
 * that ONE +90° mesh rotation about world +Y advances them.
 *
 * The art→world mapping was MEASURED in the running scene, not reasoned from
 * the builders — reasoning got it wrong once. `groundBuilder.js` does emit
 * u = col/subdivisionsX (u increasing with world +X) and v = 1 - row/subdivisionsY
 * with z running +height/2 → -height/2 (v increasing with world +Z), so the
 * "art right → +X" half is safe. The other half depends on whether texture
 * v = 0 samples the canvas's top or bottom row, and the observed answer is
 * TOP: rendering the corner piece and projecting known tile centres to screen
 * showed the art's top edge facing world **-Z**, i.e. the art is NOT simply
 * axis-aligned onto (+X, +Z) — the pair (art right, art up) maps to
 * (+X, -Z).
 *
 * Consequence for rotation: `Matrix.RotationY(theta)` maps local +X →
 * (cos θ, 0, -sin θ), so a +90° turn sends +X → -Z → -X → +Z → +X. Because
 * art-right is +X and art-up is -Z, a +90° turn therefore sends art-right to
 * art-up — i.e. it advances art directions COUNTER-clockwise, so this list
 * reads up, left, down, right rather than the more intuitive clockwise order.
 * A piece rotated by `k` quarter turns connects in world direction
 * PATH_DIRECTION_OFFSETS[(d + k) % 4] for each art-space direction `d` it opens onto.
 *
 * tests/unit/render.pathPieces.test.ts pins the resulting classification for
 * the real garden layout so this can't silently regress.
 */
export const PATH_DIRECTION_OFFSETS: ReadonlyArray<TileCoord> = [
  { x: 0, z: -1 }, // 0 — art up (top edge of the SVG canvas)
  { x: -1, z: 0 }, // 1 — art left
  { x: 0, z: 1 }, // 2 — art down
  { x: 1, z: 0 }, // 3 — art right
];

export type PathPiece = 'straight' | 'corner' | 'tee' | 'cross' | 'end';

/** Which art-space directions each authored piece connects in (bitmask over
 * PATH_DIRECTIONS). Mirrors public/assets/paths/*.svg — every piece shares one
 * 68/160 tread band centred on the tile so arms line up across every tile
 * boundary regardless of rotation. */
const PIECE_ART_MASKS: Record<PathPiece, number> = {
  straight: (1 << 1) | (1 << 3), // left–right
  corner: (1 << 0) | (1 << 3), // up–right
  tee: (1 << 1) | (1 << 2) | (1 << 3), // left–right plus a stem down
  cross: 0b1111,
  end: 1 << 3, // a capped stub opening to the right
};

/** Most-connected first, so a tile is never described by a less specific
 * piece that happens to match a rotation of its mask. */
const PIECE_MATCH_ORDER: ReadonlyArray<PathPiece> = ['cross', 'tee', 'corner', 'straight', 'end'];

function rotateMask(mask: number, quarterTurns: number): number {
  let rotated = 0;
  for (let d = 0; d < 4; d++) {
    if (mask & (1 << d)) rotated |= 1 << ((d + quarterTurns) % 4);
  }
  return rotated;
}

export interface PathTilePiece {
  tile: TileCoord;
  piece: PathPiece;
  /** Whole quarter turns about world +Y to apply to the piece's art. */
  quarterTurns: number;
  /**
   * Which way Sprouts travel across this tile, as an index into
   * PATH_DIRECTIONS. Derived by breadth-first search outward from
   * NURSERY_TILE over the path graph: flow always points at the neighbour
   * FURTHER from the Nursery, because that is the direction gameplay
   * transport actually moves (GARDEN_PATH_TILES is the union of
   * pathBetween(NURSERY_TILE, habitatTile) for all three habitats, so every
   * run leads outward from the Nursery to a habitat). Drives the conveyor
   * animation in world.ts.
   */
  flowDirection: number;
  /**
   * The conveyor overlay for this tile, as HALF-tile segments. A tile gets one
   * segment for the half traffic arrives across and one for the half it leaves
   * across, so a corner's chevrons follow the bend and — crucially — nothing is
   * drawn over the quadrant a corner has no tread in. A single full-tile quad
   * rotated to the outgoing direction spilled chevrons onto bare soil past
   * every corner (seen in browser QA).
   *
   * Along a straight run the two halves are collinear and share the animation
   * phase, so the march is continuous from tile to tile.
   */
  flowSegments: PathFlowSegment[];
}

export interface PathFlowSegment {
  /** Index into PATH_DIRECTION_OFFSETS: which half of the tile (centre → that edge)
   * this segment covers. */
  halfDirection: number;
  /**
   * Quarter turns about world +Y that make a quad's local +X axis point the way
   * traffic travels here. A +90° turn sends world +X → -Z → -X → +Z and
   * PATH_DIRECTION_OFFSETS is ordered [-Z, -X, +Z, +X], so this is (travel + 1) % 4.
   * One shared scrolling material therefore animates every segment in its own
   * correct direction, with no per-tile material.
   */
  travelQuarterTurns: number;
}

/**
 * Which piece (and rotation) a tile needs, given the world directions it
 * connects in. An isolated tile (no path neighbours at all) falls back to a
 * capped stub — the current layout never produces one, but the classifier
 * should not return undefined for a valid tile.
 */
export function classifyPathTile(connectionMask: number): { piece: PathPiece; quarterTurns: number } {
  for (const piece of PIECE_MATCH_ORDER) {
    for (let quarterTurns = 0; quarterTurns < 4; quarterTurns++) {
      if (rotateMask(PIECE_ART_MASKS[piece], quarterTurns) === connectionMask) {
        return { piece, quarterTurns };
      }
    }
  }
  return { piece: 'end', quarterTurns: 0 };
}

/**
 * Tile distance from the Nursery along the path graph (breadth-first, so it is
 * the true walking distance, not Manhattan). Exported for the conveyor-flow
 * test; the renderer only needs GARDEN_PATH_PIECES.
 */
export function pathDistancesFromNursery(): Map<string, number> {
  const pathKeys = new Set(GARDEN_PATH_TILES.map(tileKey));
  const distance = new Map<string, number>();
  const start = tileKey(NURSERY_TILE);
  if (!pathKeys.has(start)) return distance;
  distance.set(start, 0);
  let frontier: TileCoord[] = [NURSERY_TILE];
  while (frontier.length > 0) {
    const next: TileCoord[] = [];
    for (const tile of frontier) {
      const here = distance.get(tileKey(tile)) as number;
      for (const step of PATH_DIRECTION_OFFSETS) {
        const neighbour = { x: tile.x + step.x, z: tile.z + step.z };
        const key = tileKey(neighbour);
        if (!pathKeys.has(key) || distance.has(key)) continue;
        distance.set(key, here + 1);
        next.push(neighbour);
      }
    }
    frontier = next;
  }
  return distance;
}

/**
 * Which way traffic flows across a tile: outward, away from the Nursery.
 *
 * A dead end (a habitat tile) has no neighbour further out, so it keeps
 * travelling in the direction it was already heading — the conveyor should
 * point INTO the habitat, not turn round. A fan-out junction has several
 * outward neighbours and only one overlay quad, so it deterministically takes
 * the first in PATH_DIRECTION_OFFSETS order (in the shipped layout that tile is the
 * Nursery's own, completely hidden under the mound).
 */
function flowDirectionFor(tile: TileCoord, connectionMask: number, distance: Map<string, number>): number {
  const here = distance.get(tileKey(tile));
  const neighbourDistance = (d: number): number | undefined =>
    distance.get(tileKey({ x: tile.x + PATH_DIRECTION_OFFSETS[d].x, z: tile.z + PATH_DIRECTION_OFFSETS[d].z }));
  if (here !== undefined) {
    for (let d = 0; d < 4; d++) {
      if (!(connectionMask & (1 << d))) continue;
      const there = neighbourDistance(d);
      if (there !== undefined && there > here) return d;
    }
    for (let d = 0; d < 4; d++) {
      if (!(connectionMask & (1 << d))) continue;
      const there = neighbourDistance(d);
      if (there !== undefined && there < here) return (d + 2) % 4;
    }
  }
  // Unreachable from the Nursery (or isolated): pick a stable direction rather
  // than leaving the overlay unrotated-but-undefined.
  for (let d = 0; d < 4; d++) if (connectionMask & (1 << d)) return d;
  return 3;
}

/** The direction traffic ARRIVES from, i.e. toward the neighbour nearer the
 * Nursery, or null on the Nursery tile itself (nothing flows into it). */
function inboundDirectionFor(tile: TileCoord, connectionMask: number, distance: Map<string, number>): number | null {
  const here = distance.get(tileKey(tile));
  if (here === undefined) return null;
  for (let d = 0; d < 4; d++) {
    if (!(connectionMask & (1 << d))) continue;
    const there = distance.get(tileKey({ x: tile.x + PATH_DIRECTION_OFFSETS[d].x, z: tile.z + PATH_DIRECTION_OFFSETS[d].z }));
    if (there !== undefined && there < here) return d;
  }
  return null;
}

/** Every path tile with the piece art, rotation and conveyor flow it renders with. */
export const GARDEN_PATH_PIECES: PathTilePiece[] = (() => {
  const pathKeys = new Set(GARDEN_PATH_TILES.map(tileKey));
  const distance = pathDistancesFromNursery();
  return GARDEN_PATH_TILES.map((tile) => {
    let connectionMask = 0;
    for (let d = 0; d < 4; d++) {
      const neighbour = { x: tile.x + PATH_DIRECTION_OFFSETS[d].x, z: tile.z + PATH_DIRECTION_OFFSETS[d].z };
      if (pathKeys.has(tileKey(neighbour))) connectionMask |= 1 << d;
    }
    const flowDirection = flowDirectionFor(tile, connectionMask, distance);
    const inbound = inboundDirectionFor(tile, connectionMask, distance);
    const flowSegments: PathFlowSegment[] = [
      // Leaving half: covers centre → outgoing edge, travelling outward.
      { halfDirection: flowDirection, travelQuarterTurns: (flowDirection + 1) % 4 },
    ];
    if (inbound !== null && inbound !== flowDirection) {
      // Arriving half: covers centre → the edge traffic came in across, and
      // travel there runs from that edge toward the centre — the OPPOSITE of
      // the direction the inbound neighbour lies in.
      flowSegments.push({ halfDirection: inbound, travelQuarterTurns: ((inbound + 2) % 4 + 1) % 4 });
    }
    return {
      tile,
      ...classifyPathTile(connectionMask),
      flowDirection,
      flowSegments,
    };
  });
})();

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
