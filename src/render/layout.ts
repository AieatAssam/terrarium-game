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
import { GRID_SIZE, tileToWorld } from '../sim/grid';
import {
  AUTOMATION_SITE_TILES,
  COLOUR_GATE_LANE_HABITATS,
  COLOUR_GATE_LANE_LIST,
  COLOUR_GATE_TILE,
  GARDEN_SLIDE_TILE,
  HABITAT_TILES,
  MOOD_BELL_TILE,
  NURSERY_TILE,
} from '../sim/layout';

export {
  AUTOMATION_SITE_TILES,
  COLOUR_GATE_LANE_HABITATS,
  COLOUR_GATE_LANE_LIST,
  COLOUR_GATE_TILE,
  GARDEN_SLIDE_TILE,
  HABITAT_TILES,
  MOOD_BELL_TILE,
  NURSERY_TILE,
};

/** Straight-line (Manhattan step) path tiles between two points, inclusive of both ends. */
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

/**
 * The painted garden path network, as the union of four runs (see the topology
 * diagram in src/sim/layout.ts):
 *
 *   1. the shared TRUNK, Nursery -> Colour Gate, with the Garden Slide on it;
 *   2. the Gate's WEST lane, Gate -> Ember Nook;
 *   3. the Gate's EAST lane, Gate -> Dew Pond;
 *   4. the untouched southern run, Nursery -> Sunflower Meadow (the fallback /
 *      hand-carried route, which deliberately does NOT pass the Gate).
 *
 * Runs 2 and 3 start at the GATE, not at the Nursery — that is the whole point
 * of the redesign. Unioning three Nursery-rooted runs (the previous shape) gave
 * a network whose only shared tile was the Nursery, i.e. no fork anywhere for
 * the Colour Gate to govern.
 *
 * Because `pathBetween` walks x before z, run 2 leaves the Gate westward along
 * z=6 and only then turns north at x=4 (and run 3 mirrors it) — so the two lanes
 * genuinely leave the fork sideways, which is what makes the decision readable
 * from the garden camera.
 *
 * A 5th run (Mood Bell feature, 2026-08-01), Nursery -> Mood Bell (9,8), was
 * added purely for the structure's own decorative site — NO Mood Bell ride
 * ever travels this tile. A Bell delivery rides Nursery -> whichever habitat
 * the boarded Sprout's own type wants, using runs 1-4 above exactly like the
 * Garden Slide's own ride already does (see src/sim/layout.ts's topology
 * comment for why the Slide's own site tile is the same kind of decoration-
 * only stop).
 */
export const GARDEN_PATH_TILES: TileCoord[] = (() => {
  const runs: TileCoord[][] = [
    pathBetween(NURSERY_TILE, COLOUR_GATE_TILE),
    ...COLOUR_GATE_LANE_LIST.map((lane) => pathBetween(COLOUR_GATE_TILE, HABITAT_TILES[COLOUR_GATE_LANE_HABITATS[lane]])),
    pathBetween(NURSERY_TILE, HABITAT_TILES.sunflowerMeadow),
    pathBetween(NURSERY_TILE, MOOD_BELL_TILE),
  ];
  const seen = new Set<string>();
  const tiles: TileCoord[] = [];
  for (const run of runs) {
    for (const tile of run) {
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
// GARDEN_PATH_TILES above is the UNION of four Manhattan runs (trunk, two Gate
// lanes, southern Meadow run), so the network genuinely contains corners, a
// fork and dead ends: a trunk at x=8 from z=8 up to z=6, a horizontal run along
// z=6 from x=4..12 forking at the Gate tile (8,6), vertical runs at x=4 and
// x=12 up to z=4, and a vertical run at x=8 down to z=13. The first render pass
// drew EVERY tile with the single `path.segment.straight` key at zero rotation,
// so corners, the junction and the dead ends all rendered as straight runs
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
   * segment for the half traffic arrives across and one for EACH half it leaves
   * across, so a corner's chevrons follow the bend and — crucially — nothing is
   * drawn over the quadrant a corner has no tread in. A single full-tile quad
   * rotated to the outgoing direction spilled chevrons onto bare soil past
   * every corner (seen in browser QA).
   *
   * "Each half it leaves across" is load-bearing now that the network has a
   * genuine fork: the Colour Gate's tile leaves in TWO directions (west lane and
   * east lane), and the Nursery's leaves north up the trunk and south toward the
   * Sunflower Meadow. With only the single primary `flowDirection` drawn, one
   * whole branch of every junction read as unmarked ground and the fork did not
   * look like a fork at all — GameRules §9.2 requires paths to show direction.
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
 * Every direction traffic leaves this tile in — i.e. toward a neighbour FURTHER
 * from the Nursery along the path graph. Usually one; two at the Nursery (trunk
 * north, Meadow run south) and two at the Colour Gate's fork (west lane, east
 * lane). Empty at a dead end, which has no outward neighbour at all.
 */
function outwardDirectionsFor(tile: TileCoord, connectionMask: number, distance: Map<string, number>): number[] {
  const here = distance.get(tileKey(tile));
  if (here === undefined) return [];
  const out: number[] = [];
  for (let d = 0; d < 4; d++) {
    if (!(connectionMask & (1 << d))) continue;
    const there = distance.get(tileKey({ x: tile.x + PATH_DIRECTION_OFFSETS[d].x, z: tile.z + PATH_DIRECTION_OFFSETS[d].z }));
    if (there !== undefined && there > here) out.push(d);
  }
  return out;
}

/**
 * The tile's PRIMARY flow direction: outward, away from the Nursery.
 *
 * A dead end (a habitat tile) has no neighbour further out, so it keeps
 * travelling in the direction it was already heading — the conveyor should
 * point INTO the habitat, not turn round. A fan-out junction has several
 * outward neighbours and deterministically takes the first in
 * PATH_DIRECTION_OFFSETS order; every one of them still gets its own conveyor
 * segment (see `outwardDirectionsFor` and PathTilePiece.flowSegments), so
 * nothing is lost by that choice — it only decides which arm the tile's single
 * `flowDirection` field names.
 */
function flowDirectionFor(tile: TileCoord, connectionMask: number, distance: Map<string, number>): number {
  const here = distance.get(tileKey(tile));
  const neighbourDistance = (d: number): number | undefined =>
    distance.get(tileKey({ x: tile.x + PATH_DIRECTION_OFFSETS[d].x, z: tile.z + PATH_DIRECTION_OFFSETS[d].z }));
  if (here !== undefined) {
    const outward = outwardDirectionsFor(tile, connectionMask, distance);
    if (outward.length > 0) return outward[0];
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
    // One leaving half per outward arm, so a fork is chevroned down BOTH lanes.
    // A dead end has no outward neighbour and falls back to its primary
    // direction, which continues into the habitat rather than doubling back.
    const outward = outwardDirectionsFor(tile, connectionMask, distance);
    const leaving = outward.length > 0 ? outward : [flowDirection];
    const flowSegments: PathFlowSegment[] = leaving.map((d) => ({
      // Leaving half: covers centre → outgoing edge, travelling outward.
      halfDirection: d,
      travelQuarterTurns: (d + 1) % 4,
    }));
    if (inbound !== null && !leaving.includes(inbound)) {
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

// ===========================================================================
// PROCEDURAL GARDEN GENERATION
// ===========================================================================
//
// Everything below generates the DECORATIVE/ENVIRONMENTAL layer of the world:
// terrain undulation, water basins, and the scatter of stones, foliage,
// ground cover, fungi and (after the first expansion is bought) the lantern
// walk, kerb and flower beds. Nothing here decides a gameplay position — the
// Nursery, habitats, automation sites and paths all still come from
// src/sim/layout.ts via the re-exports at the top of this file.
//
// ---------------------------------------------------------------------------
// Determinism contract
// ---------------------------------------------------------------------------
// The same garden must look IDENTICAL across reloads, machines and backends.
// The previous pass got that by hand-listing 22 placements; this one gets it
// from a seed, which is stronger (it survives changing the counts) but only if
// the generator itself is disciplined:
//
//   1. ONE module-level seed (`GARDEN_SEED`). Nothing here ever reads
//      `Math.random`, `Date.now`, `performance.now`, the sim's RNG (whose seed
//      is sim state, not ours) or any per-session value.
//   2. Every random decision comes from a POSITIONAL HASH — `rand01(seed, cellX,
//      cellZ, channel)` — not from a sequential stream. A stream PRNG makes
//      every draw depend on how many draws happened before it, so adding one
//      shrub at the start silently reshuffles the entire garden and a rejected
//      candidate perturbs everything after it. A positional hash makes each
//      cell's decision depend only on (seed, cell, channel), so generation is
//      order-independent and locally stable: rejection sampling costs nothing,
//      and layers can be added or removed without disturbing their neighbours.
//   3. Integer math only (`Math.imul`, `>>> 0`) so the hash is bit-exact
//      everywhere rather than depending on float rounding.
//   4. Generation runs at module load and is frozen into exported arrays, so
//      the renderer cannot accidentally re-roll anything per frame or per
//      session. tests/unit/render.procgen.test.ts pins the resulting layout.
//
// See docs/ART_DIRECTION.md §12 for the art-side rules (density fields, tint
// ranges, why decoration stays lower-contrast than interactive props).

/** The one seed the whole decorative world derives from. Changing this
 * re-rolls the entire garden; it is intentionally a fixed literal, never a
 * per-session value. */
export const GARDEN_SEED = 0x7e44a17;

/** Sub-seeds, so two layers that happen to use the same cell coordinates
 * don't produce correlated results (all foliage landing exactly where all
 * pebbles land). XORed into GARDEN_SEED rather than being independent magic
 * numbers, so changing GARDEN_SEED still re-rolls everything together. */
const SEED_TERRAIN = GARDEN_SEED ^ 0x51a3;
const SEED_BASIN = GARDEN_SEED ^ 0x2c7f;
const SEED_SCATTER = GARDEN_SEED ^ 0x6be1;
const SEED_EXPANSION = GARDEN_SEED ^ 0x1d95;
const SEED_GROUND_TINT = GARDEN_SEED ^ 0x40b7;

/** Final avalanche of the murmur3 32-bit finalizer family — good bit mixing
 * for very small inputs (tile coordinates), which a plain multiply-shift
 * leaves visibly correlated along rows. */
function mix32(value: number): number {
  let h = value | 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Positional hash: (seed, x, z, channel) -> uint32. `channel` lets one cell
 * make several independent decisions (place? which variant? what tint?)
 * without a sequential stream. */
export function hashCell(seed: number, x: number, z: number, channel: number): number {
  let h = mix32(seed ^ Math.imul(x | 0, 0x27d4eb2d));
  h = mix32(h ^ Math.imul(z | 0, 0x165667b1));
  return mix32(h ^ Math.imul(channel | 0, 0x9e3779b1));
}

/** Positional hash as a [0,1) float. */
export function rand01(seed: number, x: number, z: number, channel: number): number {
  return hashCell(seed, x, z, channel) / 4294967296;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function smoothstep(t: number): number {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
}

/** Classic value noise: hash the integer lattice, smoothstep-interpolate.
 * Continuous, tileable-free, and — because the lattice values come from
 * `rand01` — exactly reproducible. Returns 0..1. */
export function valueNoise2D(seed: number, x: number, z: number): number {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const u = smoothstep(x - x0);
  const v = smoothstep(z - z0);
  const n00 = rand01(seed, x0, z0, 0);
  const n10 = rand01(seed, x0 + 1, z0, 0);
  const n01 = rand01(seed, x0, z0 + 1, 0);
  const n11 = rand01(seed, x0 + 1, z0 + 1, 0);
  return (n00 * (1 - u) + n10 * u) * (1 - v) + (n01 * (1 - u) + n11 * u) * v;
}

/** Fractal sum of value-noise octaves (each half the amplitude, double the
 * frequency), normalised back to 0..1. Three octaves is enough for a soft
 * garden mound field; more just adds high-frequency noise the terrain's
 * subdivision level cannot resolve anyway. */
export function fbm2D(seed: number, x: number, z: number, octaves = 3): number {
  let sum = 0;
  let amplitude = 1;
  let total = 0;
  let frequency = 1;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise2D(seed + i * 7919, x * frequency, z * frequency) * amplitude;
    total += amplitude;
    amplitude *= 0.5;
    frequency *= 2.07; // not exactly 2, so octave lattices don't align into a grid pattern
  }
  return sum / total;
}

// ---------------------------------------------------------------------------
// Reserved-space clearance
// ---------------------------------------------------------------------------
// `isReservedTile` answers a TILE question, which is the right granularity for
// automation placement but too coarse for decoration: a habitat drum is 2.6
// world units across (src/render/propDims.ts), i.e. it overhangs its own tile
// by more than a whole tile in every direction, and the previous scatter — a
// pure `isReservedTile` check — was therefore free to drop a rock halfway
// inside the Dew Pond. Decoration is placed at continuous positions, so it
// needs a continuous clearance field instead.

interface ReservedZone {
  x: number;
  z: number;
  /** World-space radius decoration must stay outside of. */
  radius: number;
}

/** Radii are the prop's own footprint (body half-width + foot outset, see
 * src/render/propDims.ts) plus breathing room, so nothing decorative ever
 * touches or visually crowds an interactive element. Path tiles get a radius
 * a little wider than the 0.2125 tread half-width, which still lets planting
 * hug the verge — the look we want — without landing on the tread. */
const RESERVED_ZONES: ReservedZone[] = [
  { ...tileToWorldXZ(NURSERY_TILE), radius: 1.25 },
  ...Object.values(HABITAT_TILES).map((t) => ({ ...tileToWorldXZ(t), radius: 1.6 })),
  ...Object.values(AUTOMATION_SITE_TILES).map((t) => ({ ...tileToWorldXZ(t), radius: 0.85 })),
  ...GARDEN_PATH_TILES.map((t) => ({ ...tileToWorldXZ(t), radius: 0.55 })),
];

/** Goes through sim's `tileToWorld` (docs/CONTRACTS.md: single shared
 * mapping) and just drops the y component, which is always 0 for a tile. */
function tileToWorldXZ(tile: TileCoord): { x: number; z: number } {
  const world = tileToWorld(tile);
  return { x: world.x, z: world.z };
}

/**
 * Distance from a world point to the nearest reserved zone's EDGE. Positive
 * outside every zone, negative inside one. This is the single gate both the
 * terrain flattening and every scatter layer use, so "decoration never lands
 * on or deforms gameplay space" is one rule in one place.
 */
export function reservedClearance(x: number, z: number): number {
  let best = Infinity;
  for (const zone of RESERVED_ZONES) {
    const d = Math.hypot(x - zone.x, z - zone.z) - zone.radius;
    if (d < best) best = d;
  }
  return best;
}

// ---------------------------------------------------------------------------
// Terrain
// ---------------------------------------------------------------------------

/** Peak height of the terrain undulation, in world units. Deliberately tiny:
 * this is a gentle "loose soil that was raked, not levelled" swell, not
 * landscape relief. Anything larger starts to occlude Sprouts at the garden
 * camera's shallow angle, which trades readability for texture. */
export const TERRAIN_AMPLITUDE = 0.18;

/** How far outside a reserved zone the terrain has fully returned to its
 * natural height. Inside this band it is smoothly flattened to exactly 0, so
 * every prop, path tile and shadow still meets the ground plane the way it
 * did when the ground was flat — the undulation is decoration, and it is not
 * allowed to lift or sink a gameplay surface. */
const TERRAIN_FLATTEN_BAND = 0.9;

export interface WaterBasin {
  x: number;
  z: number;
  /** Radius of the carved depression. */
  radius: number;
  /** How far below the terrain datum the centre of the bowl sits. */
  depth: number;
  /** Radius of the open water surface. NOT a free parameter — see
   * WATER_RADIUS_FRACTION: it is the radius at which the bowl floor rises to
   * exactly the water's own surface height, i.e. the true shoreline. */
  waterRadius: number;
  seed: number;
}

/**
 * Where the waterline sits, as a fraction of the bowl radius.
 *
 * This one number fixes both the pond's width AND its surface height, and they
 * cannot be chosen independently — getting that wrong is a real bug this pass
 * hit. The bowl profile is `-depth * (cos(pi*d/R)/2 + 0.5)`, so a water plane
 * at height `S` meets the floor where that expression equals `S`. An earlier
 * pass picked the water radius (0.85R) and the surface height (0.6 of depth
 * above the floor) as two independent-looking constants; they described
 * inconsistent geometry, so the water plane intersected the rising bowl well
 * before its own edge and the disc's rim was buried in soil — and lily pads
 * generated on that plane ended up UNDER the ground they floated over (caught
 * by the unit test, not by eye).
 *
 * Now the surface height is DERIVED from the radius, so they cannot disagree.
 */
const WATER_RADIUS_FRACTION = 0.7;

/** Bowl falloff evaluated at the shoreline — the fraction of `depth` the water
 * surface sits below the datum. */
const WATER_SURFACE_FALLOFF = Math.cos(Math.PI * WATER_RADIUS_FRACTION) * 0.5 + 0.5;

/** Height of a basin's open water surface, relative to the terrain datum
 * (always negative — the water sits recessed). Single definition shared by the
 * lily-pad generator here and the water mesh in src/render/world.ts, so the
 * two can never drift apart. */
export function basinSurfaceHeight(basin: WaterBasin): number {
  return -basin.depth * WATER_SURFACE_FALLOFF;
}

/**
 * Water accents are generated FIRST and are an input to the terrain height
 * field (they carve a bowl), so the ordering here matters and is deliberate:
 * basins -> terrain -> everything that stands on terrain. Placed on a coarse
 * jittered grid with a clearance requirement, then thinned to `target` by
 * hashed priority rather than by iteration order, so the result does not
 * depend on scan direction.
 */
function generateWaterBasins(): WaterBasin[] {
  const candidates: Array<WaterBasin & { priority: number }> = [];
  const cell = 3.2;
  for (let cx = -1; cx <= Math.ceil(GRID_SIZE / cell); cx++) {
    for (let cz = -1; cz <= Math.ceil(GRID_SIZE / cell); cz++) {
      const x = (cx + 0.15 + rand01(SEED_BASIN, cx, cz, 1) * 0.7) * cell;
      const z = (cz + 0.15 + rand01(SEED_BASIN, cx, cz, 2) * 0.7) * cell;
      if (x < -0.6 || x > GRID_SIZE - 0.4 || z < -0.6 || z > GRID_SIZE - 0.4) continue;
      const radius = 1.05 + rand01(SEED_BASIN, cx, cz, 3) * 0.5;
      // A basin deforms the ground, so it needs more clearance than a prop
      // that merely sits on it.
      // Generous: a pale decorative pool sitting next to the (blue, round)
      // Dew Pond habitat is a genuine readability hazard — GameRules §4.1
      // wants interactive elements instantly distinguishable from decoration —
      // so basins keep well clear of every prop, not just barely clear.
      if (reservedClearance(x, z) < radius + 0.7) continue;
      candidates.push({
        x,
        z,
        radius,
        depth: 0.1 + rand01(SEED_BASIN, cx, cz, 4) * 0.05,
        waterRadius: radius * WATER_RADIUS_FRACTION,
        seed: hashCell(SEED_BASIN, cx, cz, 5),
        priority: rand01(SEED_BASIN, cx, cz, 6),
      });
    }
  }
  candidates.sort((a, b) => a.priority - b.priority || a.x - b.x || a.z - b.z);
  const accepted: WaterBasin[] = [];
  for (const candidate of candidates) {
    if (accepted.length >= 3) break;
    if (accepted.some((b) => Math.hypot(b.x - candidate.x, b.z - candidate.z) < b.radius + candidate.radius + 3.4)) continue;
    accepted.push(candidate);
  }
  return accepted;
}

export const WATER_BASINS: WaterBasin[] = generateWaterBasins();

/** How deep into a basin a point is, 0 (outside) .. 1 (centre). Cosine
 * falloff so the bowl meets flat ground with zero slope discontinuity — a
 * linear cone leaves a visible crease ring in the shading. */
function basinFalloff(basin: WaterBasin, x: number, z: number): number {
  const d = Math.hypot(x - basin.x, z - basin.z);
  if (d >= basin.radius) return 0;
  return Math.cos((Math.PI * d) / basin.radius) * 0.5 + 0.5;
}

/**
 * 1 away from every basin, 0 anywhere inside one, smoothly blended over a
 * short band outside the rim. This SUPPRESSES the general terrain swell inside
 * a basin, which is what makes the bowl a clean radially-symmetric dish — and
 * therefore what makes `basinSurfaceHeight`'s derived shoreline exact. With
 * the swell left in, one side of a pond sits higher than the other and a flat
 * water plane pokes out of the bank on the high side.
 */
function basinSwellMask(x: number, z: number): number {
  let mask = 1;
  for (const basin of WATER_BASINS) {
    const d = Math.hypot(x - basin.x, z - basin.z);
    const local = smoothstep((d - basin.radius) / 0.7);
    if (local < mask) mask = local;
  }
  return mask;
}

/**
 * The garden's ground height at a world point. Pure function of position (and
 * the module seed), so the renderer's vertex displacement and every scatter
 * layer's "sit on the ground" lookup agree exactly, with no shared mutable
 * height buffer to fall out of sync.
 */
export function terrainHeightAt(x: number, z: number): number {
  // Two scales, not one: a broad bank field (long wavelength, most of the
  // amplitude) that gives the garden a readable large-scale form at the iso
  // camera's shallow angle, plus a finer crumble on top. A single mid-scale
  // octave set read as uniform noise — present in the vertex data, invisible
  // on screen.
  const banks = (fbm2D(SEED_TERRAIN, x * 0.085, z * 0.085, 2) - 0.5) * 2;
  const crumble = (fbm2D(SEED_TERRAIN ^ 0x9d, x * 0.31, z * 0.31, 2) - 0.5) * 2;
  const swell = (banks * 0.72 + crumble * 0.28) * TERRAIN_AMPLITUDE;
  const flatten = smoothstep(reservedClearance(x, z) / TERRAIN_FLATTEN_BAND);
  let height = swell * flatten * basinSwellMask(x, z);
  for (const basin of WATER_BASINS) {
    height -= basin.depth * basinFalloff(basin, x, z);
  }
  return height;
}

/**
 * Per-vertex ground tint, returned as a multiplier over the soil material's
 * own albedo (so 1,1,1 is "unchanged"). Three blended reads, all from the
 * same height field the displacement uses, so colour and form describe the
 * same surface instead of being unrelated overlays:
 *
 *   - rises go drier/sandier and slightly lighter,
 *   - hollows go mossier/greener and slightly darker (cheap large-scale AO),
 *   - a low-frequency independent patch field adds mossy/bare drift so the
 *     ground is not a pure function of its own shape.
 *
 * Kept inside a narrow multiplier range on purpose: GameRules §4.1 requires
 * interactive elements to stay instantly distinguishable from decoration, and
 * the ground is the largest surface on screen — it must gain material variety
 * without gaining contrast that competes with a Sprout.
 */
export function groundTintAt(x: number, z: number): { r: number; g: number; b: number } {
  const height = terrainHeightAt(x, z);
  const rise = clamp01(height / TERRAIN_AMPLITUDE); // 0 at/below datum, 1 at a peak
  const hollow = clamp01(-height / TERRAIN_AMPLITUDE);
  const patch = fbm2D(SEED_GROUND_TINT, x * 0.17, z * 0.17, 2);
  const moss = clamp01(hollow * 0.75 + (patch - 0.45) * 1.1);
  const dry = clamp01(rise * 0.8 + (0.55 - patch) * 0.9);
  // Dry crests go warm ochre, damp hollows go deep moss. Deliberately sized
  // to stay inside a ~0.78..1.28 multiplier: this has to give the largest
  // surface on screen real material variety WITHOUT becoming a second
  // saturated palette competing with the Sprouts and habitats.
  return {
    r: 1 + dry * 0.28 - moss * 0.22,
    g: 1 + dry * 0.16 + moss * 0.1,
    b: 1 + dry * 0.04 - moss * 0.18,
  };
}

// ---------------------------------------------------------------------------
// Scatter
// ---------------------------------------------------------------------------

export type SceneryKind =
  | 'pebble'
  | 'boulder'
  | 'tuft'
  | 'bush'
  | 'fern'
  | 'mushroom'
  | 'lily'
  | 'kerb'
  | 'lantern'
  | 'blossom';

/** One placed decorative element. Everything the renderer needs to build a
 * thin instance: a transform, a tint, and a sway phase. No mesh, material or
 * Babylon type is referenced here — layout stays pure/testable. */
export interface SceneryInstance {
  kind: SceneryKind;
  /** Which master mesh of that kind to instance (0-based). */
  variant: number;
  x: number;
  y: number;
  z: number;
  scale: number;
  rotationY: number;
  /** Small lean off vertical, in radians, so nothing looks stamped. */
  tiltX: number;
  tiltZ: number;
  /** Multiplier over the shared material's albedo — the per-instance colour
   * micro-variation, delivered via a thin-instance colour buffer so it costs
   * no extra material. */
  tint: { r: number; g: number; b: number };
  /** 0..1 wind-sway amplitude scale (0 for anything rigid, like stone). */
  sway: number;
  /** Sway phase offset in radians, so a stand of grass does not move as one. */
  phase: number;
}

interface ScatterLayer {
  kind: SceneryKind;
  /** Sub-grid cell size in world units — controls minimum spacing. */
  cell: number;
  /** Number of master mesh variants available for this kind. */
  variants: number;
  /** Base chance a cell places anything at all, before the density field. */
  density: number;
  /** Clearance from reserved zones this kind needs (its own footprint). */
  clearance: number;
  scale: [number, number];
  tilt: number;
  sway: number;
  /** Base tint multiplier, jittered per instance by `tintJitter`. */
  tint: [number, number, number];
  tintJitter: number;
  /** Extra per-position acceptance weight, 0..1, on top of `density`. */
  weight?: (x: number, z: number) => number;
}

/** Distance to the nearest basin's water edge — negative inside the water.
 * Used as a density input (things like damp ground) and as a hard exclusion
 * for anything that would stand in the pond. */
function waterEdgeDistance(x: number, z: number): number {
  let best = Infinity;
  for (const basin of WATER_BASINS) {
    const d = Math.hypot(x - basin.x, z - basin.z) - basin.waterRadius;
    if (d < best) best = d;
  }
  return best;
}

/** 1 near a basin shoulder, falling off with distance — the "damp ground"
 * density input for moss, ferns and shore pebbles. */
function dampness(x: number, z: number): number {
  const d = waterEdgeDistance(x, z);
  if (d < 0) return 0;
  return clamp01(1 - d / 2.2);
}

/** 1 close to the garden path verge, 0 away from it — used to concentrate
 * ground cover along the road so the path reads as a tended route through
 * planting rather than a stripe dropped on open soil. */
const PATH_WORLD_POINTS = GARDEN_PATH_TILES.map(tileToWorldXZ);

function pathVerge(x: number, z: number): number {
  let best = Infinity;
  for (const point of PATH_WORLD_POINTS) {
    const d = Math.hypot(x - point.x, z - point.z);
    if (d < best) best = d;
  }
  return clamp01(1 - (best - 0.55) / 1.1);
}

const SCATTER_LAYERS: ScatterLayer[] = [
  {
    kind: 'pebble',
    cell: 0.85,
    variants: 3,
    density: 0.36,
    clearance: 0.12,
    scale: [0.55, 1.15],
    tilt: 0.5,
    sway: 0,
    tint: [1, 0.99, 0.97],
    tintJitter: 0.24,
    // Pebbles gather on the drier rises and are washed toward basin shores.
    weight: (x, z) => 0.35 + clamp01(terrainHeightAt(x, z) / TERRAIN_AMPLITUDE) * 0.45 + dampness(x, z) * 0.5,
  },
  {
    kind: 'boulder',
    cell: 3.1,
    variants: 2,
    density: 0.55,
    clearance: 0.55,
    scale: [0.9, 1.6],
    tilt: 0.18,
    sway: 0,
    tint: [1, 0.98, 0.95],
    tintJitter: 0.2,
  },
  {
    kind: 'tuft',
    cell: 0.72,
    variants: 2,
    density: 0.42,
    clearance: 0.15,
    scale: [0.7, 1.35],
    tilt: 0.22,
    sway: 1,
    tint: [0.95, 1.02, 0.9],
    tintJitter: 0.22,
    weight: (x, z) => 0.3 + dampness(x, z) * 0.55 + pathVerge(x, z) * 0.5,
  },
  {
    kind: 'bush',
    cell: 2.15,
    variants: 2,
    density: 0.52,
    clearance: 0.55,
    scale: [0.85, 1.3],
    tilt: 0.1,
    sway: 0.55,
    tint: [0.94, 1.0, 0.92],
    tintJitter: 0.18,
  },
  {
    kind: 'fern',
    cell: 1.7,
    variants: 1,
    density: 0.34,
    clearance: 0.4,
    scale: [0.8, 1.25],
    tilt: 0.14,
    sway: 0.8,
    tint: [0.9, 1.02, 0.93],
    tintJitter: 0.2,
    weight: (x, z) => 0.25 + dampness(x, z) * 0.75,
  },
  {
    kind: 'mushroom',
    cell: 1.45,
    variants: 2,
    density: 0.12,
    clearance: 0.3,
    scale: [0.7, 1.2],
    tilt: 0.22,
    sway: 0,
    tint: [1.02, 0.98, 0.96],
    tintJitter: 0.14,
    // Fungi like the damp, shaded hollows, not the open dry rises.
    weight: (x, z) => clamp01(0.15 + dampness(x, z) * 0.6 + clamp01(-terrainHeightAt(x, z) / TERRAIN_AMPLITUDE) * 0.5),
  },
];

/**
 * Jittered-grid scatter. For each cell of a layer's sub-grid, ONE hashed
 * decision decides whether that cell places anything, and further hashed
 * channels decide where inside the cell, which variant, how big, how tilted
 * and what tint. Because every decision is a pure function of the cell
 * coordinate, the layout is stable under insertion/removal of other layers,
 * and rejection (clearance, water, off-grid) simply leaves a gap rather than
 * shifting everything downstream.
 */
function generateScatterLayer(seed: number, layer: ScatterLayer, area: { min: number; max: number }): SceneryInstance[] {
  const out: SceneryInstance[] = [];
  const first = Math.floor(area.min / layer.cell);
  const last = Math.ceil(area.max / layer.cell);
  const kindSalt = layer.kind.charCodeAt(0) * 131 + layer.kind.length;
  for (let cx = first; cx <= last; cx++) {
    for (let cz = first; cz <= last; cz++) {
      const roll = rand01(seed, cx, cz, kindSalt);
      const x = (cx + 0.12 + rand01(seed, cx, cz, kindSalt + 1) * 0.76) * layer.cell;
      const z = (cz + 0.12 + rand01(seed, cx, cz, kindSalt + 2) * 0.76) * layer.cell;
      if (x < area.min || x > area.max || z < area.min || z > area.max) continue;
      const weight = layer.weight ? clamp01(layer.weight(x, z)) : 1;
      if (roll > layer.density * weight) continue;
      if (reservedClearance(x, z) < layer.clearance) continue;
      // Nothing but lilies stands in open water; keep a shoreline margin so
      // roots aren't visibly submerged.
      if (waterEdgeDistance(x, z) < layer.clearance + 0.1) continue;
      const t = rand01(seed, cx, cz, kindSalt + 3);
      const jitter = layer.tintJitter;
      const shade = (rand01(seed, cx, cz, kindSalt + 6) - 0.5) * jitter;
      const hue = (rand01(seed, cx, cz, kindSalt + 7) - 0.5) * jitter * 0.6;
      out.push({
        kind: layer.kind,
        variant: Math.floor(rand01(seed, cx, cz, kindSalt + 4) * layer.variants) % layer.variants,
        x,
        y: terrainHeightAt(x, z),
        z,
        scale: layer.scale[0] + t * (layer.scale[1] - layer.scale[0]),
        rotationY: rand01(seed, cx, cz, kindSalt + 5) * Math.PI * 2,
        tiltX: (rand01(seed, cx, cz, kindSalt + 8) - 0.5) * layer.tilt,
        tiltZ: (rand01(seed, cx, cz, kindSalt + 9) - 0.5) * layer.tilt,
        tint: {
          r: layer.tint[0] * (1 + shade + hue),
          g: layer.tint[1] * (1 + shade),
          b: layer.tint[2] * (1 + shade - hue),
        },
        sway: layer.sway,
        phase: rand01(seed, cx, cz, kindSalt + 10) * Math.PI * 2,
      });
    }
  }
  return out;
}

/** Lily pads float on the basins themselves, so they are generated per-basin
 * in polar coordinates rather than from the world grid — a rectangular cell
 * grid over a 1.1-unit disc produces either two pads or none. */
function generateLilies(): SceneryInstance[] {
  const out: SceneryInstance[] = [];
  for (const basin of WATER_BASINS) {
    const count = 3 + (hashCell(basin.seed, 0, 0, 11) % 3);
    for (let i = 0; i < count; i++) {
      const angle = rand01(basin.seed, i, 0, 12) * Math.PI * 2;
      const radius = Math.sqrt(rand01(basin.seed, i, 0, 13)) * basin.waterRadius * 0.78;
      const x = basin.x + Math.cos(angle) * radius;
      const z = basin.z + Math.sin(angle) * radius;
      const shade = (rand01(basin.seed, i, 0, 14) - 0.5) * 0.2;
      out.push({
        kind: 'lily',
        variant: hashCell(basin.seed, i, 0, 15) % 2,
        x,
        // Floats on the basin's own derived water surface (see
        // basinSurfaceHeight), lifted by a hair so the pad reads as resting ON
        // the water rather than co-planar with it and z-fighting.
        y: basinSurfaceHeight(basin) + 0.004,
        z,
        scale: 0.75 + rand01(basin.seed, i, 0, 16) * 0.5,
        rotationY: rand01(basin.seed, i, 0, 17) * Math.PI * 2,
        tiltX: 0,
        tiltZ: 0,
        tint: { r: 0.93 + shade, g: 1.0 + shade, b: 0.9 + shade },
        sway: 0.25,
        phase: rand01(basin.seed, i, 0, 18) * Math.PI * 2,
      });
    }
  }
  return out;
}

/** The decorative layer present from the first frame. */
export const BASE_SCENERY: SceneryInstance[] = (() => {
  const area = { min: -1.6, max: GRID_SIZE - 1 + 1.6 };
  const out: SceneryInstance[] = [];
  for (const layer of SCATTER_LAYERS) out.push(...generateScatterLayer(SEED_SCATTER, layer, area));
  out.push(...generateLilies());
  return out;
})();

// ---------------------------------------------------------------------------
// First expansion (GameRules §6.6) — "Decorative Expansion I"
// ---------------------------------------------------------------------------
// Bought via src/data/upgrades.ts's `decorativeExpansion1`, which promises
// "stones, lanterns, moss". §6.6 additionally requires the first expansion to
// "make the world feel larger and more personal, not merely increase capacity
// invisibly", so this layer is designed around three distinct reads rather
// than just "more shrubs":
//
//   1. A LARGER WORLD: a low stone kerb rings the garden OUTSIDE the 16x16
//      play grid, on ground that was previously bare apron. The plot gains a
//      defined edge, which reads as the garden having been extended out to it.
//   2. A MORE PERSONAL WORLD: lanterns along the path verge — the first warm
//      light sources the player owns rather than the ambient sun, plus their
//      own firefly motes (src/render/world.ts).
//   3. MORE LIFE: flowering blossoms and a denser moss carpet threaded through
//      the existing planting, so the interior visibly fills in too.
//
// It is generated from its own sub-seed at module load exactly like the base
// layer — buying the upgrade only decides WHEN it becomes visible, never what
// it looks like, so a save reloaded after the purchase rebuilds an identical
// garden.

const EXPANSION_LAYERS: ScatterLayer[] = [
  {
    kind: 'blossom',
    cell: 1.25,
    variants: 3,
    density: 0.3,
    clearance: 0.3,
    // Bigger than the first pass: at 0.07 world-unit petals a bloom was a
    // single pixel cluster at gameplay distance and read as noise.
    scale: [1.0, 1.7],
    tilt: 0.28,
    sway: 1,
    // Warm-to-cool drift across the bed (the tint's r and b channels move in
    // opposite directions, see generateScatterLayer's `hue`), so a bed reads
    // as mixed planting rather than one cloned flower.
    tint: [1, 0.97, 0.95],
    tintJitter: 0.26,
    weight: (x, z) => 0.35 + pathVerge(x, z) * 0.65,
  },
  {
    kind: 'tuft',
    cell: 0.66,
    variants: 2,
    density: 0.3,
    clearance: 0.15,
    scale: [0.8, 1.4],
    tilt: 0.24,
    sway: 1,
    // Slightly greener/lusher than the base tufts — the moss carpet the
    // upgrade copy promises.
    tint: [0.86, 1.05, 0.86],
    tintJitter: 0.2,
    weight: (x, z) => 0.35 + dampness(x, z) * 0.5 + pathVerge(x, z) * 0.5,
  },
];

/** Kerb blocks ringing the play grid, on the apron the base garden never
 * uses. Walked as a perimeter rather than a scatter so the ring is unbroken,
 * with per-block jitter so it reads as laid stones, not extruded fence. */
function generateKerb(): SceneryInstance[] {
  const out: SceneryInstance[] = [];
  const min = -1.85;
  const max = GRID_SIZE - 1 + 1.85;
  const step = 0.74;
  const span = max - min;
  const steps = Math.round(span / step);
  const push = (x: number, z: number, index: number, side: number): void => {
    const jx = (rand01(SEED_EXPANSION, index, side, 20) - 0.5) * 0.16;
    const jz = (rand01(SEED_EXPANSION, index, side, 21) - 0.5) * 0.16;
    const shade = (rand01(SEED_EXPANSION, index, side, 22) - 0.5) * 0.18;
    out.push({
      kind: 'kerb',
      variant: hashCell(SEED_EXPANSION, index, side, 23) % 2,
      x: x + jx,
      y: terrainHeightAt(x + jx, z + jz),
      z: z + jz,
      scale: 0.9 + rand01(SEED_EXPANSION, index, side, 24) * 0.3,
      rotationY:
        // Aligned with the run it belongs to, then nudged — a kerb is laid,
        // not scattered.
        (side % 2 === 0 ? 0 : Math.PI / 2) + (rand01(SEED_EXPANSION, index, side, 25) - 0.5) * 0.35,
      tiltX: (rand01(SEED_EXPANSION, index, side, 26) - 0.5) * 0.1,
      tiltZ: (rand01(SEED_EXPANSION, index, side, 27) - 0.5) * 0.1,
      tint: { r: 1.04 + shade, g: 1.0 + shade, b: 0.94 + shade },
      sway: 0,
      phase: 0,
    });
  };
  for (let i = 0; i <= steps; i++) {
    const t = min + (i / steps) * span;
    push(t, min, i, 0);
    push(t, max, i, 2);
    if (i > 0 && i < steps) {
      push(min, t, i, 1);
      push(max, t, i, 3);
    }
  }
  return out;
}

/** Lanterns stand along the path verge, spaced by walking the path tile list
 * and taking every Nth tile, so they line the route the player actually
 * watches Sprouts travel instead of landing in random corners. */
function generateLanterns(): SceneryInstance[] {
  const out: SceneryInstance[] = [];
  const spacing = 2;
  for (let i = 0; i < GARDEN_PATH_TILES.length; i += spacing) {
    const tile = GARDEN_PATH_TILES[i];
    const world = tileToWorldXZ(tile);
    // Offset to whichever side of the tile has room; a lantern is a real
    // volume and must not stand on the tread.
    const candidates = [
      { x: world.x + 0.78, z: world.z + 0.16 },
      { x: world.x - 0.78, z: world.z - 0.16 },
      { x: world.x + 0.16, z: world.z + 0.78 },
      { x: world.x - 0.16, z: world.z - 0.78 },
    ];
    const order = hashCell(SEED_EXPANSION, tile.x, tile.z, 30) % candidates.length;
    const best = candidates
      .map((_, k) => candidates[(order + k) % candidates.length])
      .find((candidate) => reservedClearance(candidate.x, candidate.z) > 0.24 && waterEdgeDistance(candidate.x, candidate.z) > 0.5);
    if (!best) continue;
    if (out.some((l) => Math.hypot(l.x - best.x, l.z - best.z) < 1.7)) continue;
    out.push({
      kind: 'lantern',
      variant: 0,
      x: best.x,
      y: terrainHeightAt(best.x, best.z),
      z: best.z,
      scale: 0.92 + rand01(SEED_EXPANSION, tile.x, tile.z, 31) * 0.18,
      rotationY: rand01(SEED_EXPANSION, tile.x, tile.z, 32) * Math.PI * 2,
      tiltX: 0,
      tiltZ: 0,
      tint: { r: 1, g: 1, b: 1 },
      sway: 0,
      phase: rand01(SEED_EXPANSION, tile.x, tile.z, 33) * Math.PI * 2,
    });
  }
  return out;
}

/** The decorative layer revealed by buying "Decorative Expansion I". */
export const EXPANSION_SCENERY: SceneryInstance[] = (() => {
  const area = { min: -1.4, max: GRID_SIZE - 1 + 1.4 };
  const out: SceneryInstance[] = [];
  for (const layer of EXPANSION_LAYERS) out.push(...generateScatterLayer(SEED_EXPANSION, layer, area));
  out.push(...generateKerb());
  out.push(...generateLanterns());
  return out;
})();
