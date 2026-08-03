// Canonical tile positions for the Nursery, the three habitats, and the two
// automation build sites — docs/CONTRACTS.md: "Sim owns tile positions; the
// renderer must map through tileToWorld and never invent its own
// screen-space math." Originally these lived in src/render/layout.ts, but
// sim's own spawn/transport systems need the same authoritative positions
// (to compute transport distance/duration), and sim must never import from
// render (enforced by tests/unit/architecture.sim-boundary.test.ts). This is
// the fix: sim owns the positions, and src/render/layout.ts re-exports them
// for the renderer's own path/scenery-scatter concerns.
//
// ---------------------------------------------------------------------------
// Garden topology: a shared trunk with a real fork
// ---------------------------------------------------------------------------
// The first layout gave each habitat its own Manhattan run out of the Nursery.
// Those three runs shared exactly ONE tile — the Nursery itself — and then fanned
// out immediately, so the garden contained no junction anywhere a route decision
// could be made. That made the Colour Gate decorative by construction: GameRules
// §9.4 requires it to "route matching Sprouts toward a connected output", and
// there was no output to connect to and nothing to choose between. Both
// automation site tiles ((6,6) and (10,6)) additionally sat in open grass, off
// every path, which §9.2 forbids ("Phase 1 paths connect Nursery, Slide, Gate
// and Habitat").
//
// The topology now is:
//
//                        Ember Nook (4,4)      Dew Pond (12,4)
//                              |                     |
//                            (4,5)                 (12,5)
//                              |                     |
//        (4,6)--(5,6)--(6,6)--(7,6)--[GATE 8,6]--(9,6)--(10,6)--(11,6)--(12,6)
//                                        |
//                                  [SLIDE 8,7]                west lane / east lane
//                                        |
//                                  Nursery (8,8)--[BELL 9,8]
//                                        |
//                                  (8,9) .. (8,12)
//                                        |
//                              Sunflower Meadow (8,13)
//
//   * a short shared TRUNK runs north out of the Nursery, (8,8) -> (8,7) -> (8,6),
//     with the Garden Slide standing ON it at (8,7);
//   * the trunk ends in a genuine FORK at (8,6), where the Colour Gate stands:
//     the WEST lane leads to Ember Nook, the EAST lane to Dew Pond. Two homes at
//     the same z make this a natural, readable two-way decision;
//   * the southern run to Sunflower Meadow leaves the Nursery directly, and the
//     Garden Slide's single instance ALWAYS rides it (design decision
//     2026-07-31: automate Sunflower Meadow, since it's the one habitat the
//     Colour Gate's fork can structurally never reach — see unlockSystem's own
//     doc comment in src/sim/systems.ts). This was Phase 1's deliberate
//     hand-carry-only fallback route before that decision; a player can still
//     drag a Sprout down it by hand exactly as before, same as any other tile.
//     GameRules §9.4's "fallback and waiting paths" is still served by the
//     Nursery's own waiting area, which is the Colour Gate's REAL fallback for
//     a non-matching or off-lane Sprout (see planRide's own doc comment) — the
//     Meadow path was never functionally load-bearing for that, only narrated
//     that way.
//   * a short spur east of the Nursery, (8,8) -> (9,8), carries the Mood
//     Bell's own structure (design decision 2026-08-01: a second, orthogonal
//     Sprout attribute, "mood", GameRules §7.3/§9.5/§9.6 stage 4). Like the
//     Slide's site tile, this is decorative only — a Bell delivery rides
//     Nursery -> whichever habitat the boarded Sprout's own TYPE wants,
//     reusing the same path network the Slide/Gate already use for all 3
//     habitats, never through (9,8) itself.
//
// Arithmetic that must keep holding (pinned in tests/unit/sim.layout.test.ts):
// `tileDistance(NURSERY, GATE) + tileDistance(GATE, habitat)` equals
// `tileDistance(NURSERY, habitat)` for both northern homes (2 + 6 = 8). A ride
// through the Gate therefore takes exactly as long as the old direct ride, and
// the renderer's path route (which walks the painted tiles) never disagrees with
// the sim's Manhattan distance.

import type { HabitatId, AutomationId, SproutTypeId } from '../core/ids';
import type { TileCoord } from './grid';

export const NURSERY_TILE: TileCoord = { x: 8, z: 8 };

export const HABITAT_TILES: Record<HabitatId, TileCoord> = {
  emberNook: { x: 4, z: 4 },
  dewPond: { x: 12, z: 4 },
  sunflowerMeadow: { x: 8, z: 13 },
};

/** On the shared trunk, one tile north of the Nursery. */
export const GARDEN_SLIDE_TILE: TileCoord = { x: 8, z: 7 };
/** The fork itself, at the north end of the trunk. */
export const COLOUR_GATE_TILE: TileCoord = { x: 8, z: 6 };
/**
 * A short decorative spur east of the Nursery (Mood Bell feature,
 * 2026-08-01). Like the Garden Slide's own site tile, this is NEVER a ride
 * waypoint — a Bell delivery rides straight Nursery -> destination habitat,
 * reusing the exact same path network the Slide and Gate already use for
 * all 3 habitats. Only the structure's own decorative placement needs this
 * tile (and one short connecting path segment, added in
 * src/render/layout.ts's GARDEN_PATH_TILES construction).
 */
export const MOOD_BELL_TILE: TileCoord = { x: 9, z: 8 };

/** Where a player-built automation instance's ghost/site marker sits by default (before it's actually built). */
export const AUTOMATION_SITE_TILES: Record<AutomationId, TileCoord> = {
  gardenSlide: GARDEN_SLIDE_TILE,
  colourGate: COLOUR_GATE_TILE,
  moodBell: MOOD_BELL_TILE,
};

/** The two lanes leaving the Colour Gate's fork. */
export type ColourGateLane = 'west' | 'east';

/**
 * Which home each lane physically leads to. This is a fact about the garden's
 * shape, not a player setting — the player chooses which KIND of Sprout each
 * lane invites (see SimState.colourGateLanes), never where a lane goes.
 */
export const COLOUR_GATE_LANE_HABITATS: Record<ColourGateLane, HabitatId> = {
  west: 'emberNook',
  east: 'dewPond',
};

export const COLOUR_GATE_LANE_LIST: ColourGateLane[] = ['west', 'east'];

/**
 * The Colour Gate's rule as the player set it: which Sprout kind each lane
 * currently invites, or `null` for "nobody yet". Never `'star'` — a Star Sprout
 * is happy in any home (src/data/sproutTypes.ts) and is hand-placed for its
 * reveal moment (GameRules §6.5), so it is not offered as a lane choice.
 */
export type ColourGateLanes = Record<ColourGateLane, SproutTypeId | null>;

/**
 * Safe, recommended default the Gate is built with (GameRules §9.1: "Offer
 * recommendations and safe defaults"). Each lane invites the kind whose home
 * that lane actually leads to, so a freshly built Gate works immediately
 * instead of arriving unset and reading as broken.
 */
export function defaultColourGateLanes(): ColourGateLanes {
  return { west: 'ember', east: 'dew' };
}

/** Manhattan tile distance — used for transport duration (matches the renderer's own per-tile animation timing). */
export function tileDistance(a: TileCoord, b: TileCoord): number {
  return Math.abs(a.x - b.x) + Math.abs(a.z - b.z);
}

/** Whether two tiles are the same square. */
export function sameTile(a: TileCoord, b: TileCoord): boolean {
  return a.x === b.x && a.z === b.z;
}

/** Which habitat occupies `tile`, if any. */
export function habitatAtTile(tile: TileCoord): HabitatId | null {
  for (const id of Object.keys(HABITAT_TILES) as HabitatId[]) {
    if (sameTile(HABITAT_TILES[id], tile)) return id;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Garden path network (moved here from src/render/layout.ts, 2026-08-01,
// Phase 2 manual-placement work — see plan.yaml Phase 1.2)
// ---------------------------------------------------------------------------
// This used to live in src/render/layout.ts as a render-only concern (path
// tiles for mesh generation). It moved here because sim now needs the same
// network to compute a manually-PLACED automation's destination (whichever
// habitat is reachable from the site tile the player chose — see
// planAutomationDestination below) and sim must never import from render
// (tests/unit/architecture.sim-boundary.test.ts). render/layout.ts re-exports
// GARDEN_PATH_TILES from here now, same pattern as every other tile position
// in this file.

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
 * The painted garden path network, as the union of five runs — see the
 * topology diagram near the top of this file. Because `pathBetween` walks x
 * before z, the Gate's two lanes leave it sideways before turning north,
 * which is what makes the fork read as a real decision from the garden
 * camera (see the topology comment above for the full reasoning).
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
      const key = tileKeyOf(tile);
      if (!seen.has(key)) {
        seen.add(key);
        tiles.push(tile);
      }
    }
  }
  return tiles;
})();

function tileKeyOf(tile: TileCoord): string {
  return `${tile.x},${tile.z}`;
}

const PATH_TILE_KEY_SET: ReadonlySet<string> = new Set(GARDEN_PATH_TILES.map(tileKeyOf));

const ROUTE_NEIGHBOUR_STEPS: ReadonlyArray<TileCoord> = [
  { x: 1, z: 0 },
  { x: -1, z: 0 },
  { x: 0, z: 1 },
  { x: 0, z: -1 },
];

/**
 * Breadth-first walk over the garden path graph, tile-by-tile (no world
 * positions, no rendering — the pure geometry piece src/render/sprouts.ts's
 * gardenRouteBetween used to compute standalone before this moved here; that
 * function now calls this one and adds its own polyline/fillet rendering on
 * top). Returns null if either end is off the path network, or if `avoid`
 * blocks every route between them.
 */
export function findPathRoute(from: TileCoord, to: TileCoord, avoid?: ReadonlySet<string>): TileCoord[] | null {
  const fromKey = tileKeyOf(from);
  const toKey = tileKeyOf(to);
  if (!PATH_TILE_KEY_SET.has(fromKey) || !PATH_TILE_KEY_SET.has(toKey)) return null;
  if (fromKey === toKey) return [from];

  const cameFrom = new Map<string, TileCoord | null>([[fromKey, null]]);
  let frontier: TileCoord[] = [from];
  while (frontier.length > 0) {
    const next: TileCoord[] = [];
    for (const tile of frontier) {
      for (const step of ROUTE_NEIGHBOUR_STEPS) {
        const neighbour: TileCoord = { x: tile.x + step.x, z: tile.z + step.z };
        const key = tileKeyOf(neighbour);
        if (!PATH_TILE_KEY_SET.has(key) || cameFrom.has(key)) continue;
        if (avoid?.has(key) && key !== toKey) continue;
        cameFrom.set(key, tile);
        if (key === toKey) {
          const reversed: TileCoord[] = [];
          let cursor: TileCoord | null = neighbour;
          while (cursor) {
            reversed.push(cursor);
            cursor = cameFrom.get(tileKeyOf(cursor)) ?? null;
          }
          return reversed.reverse();
        }
        next.push(neighbour);
      }
    }
    frontier = next;
  }
  return null;
}

export interface ConveyorRouteSegment {
  id: string;
  tile: TileCoord;
}

export interface ConveyorRoute {
  /** Ordered endpoint/segment tiles, including both endpoints. */
  tiles: TileCoord[];
  /** Segment ids in the same order as they appear between the endpoints. */
  segmentIds: string[];
  /** Orthogonal tile length, used by the simulation's transport clock. */
  length: number;
}

/**
 * Finds the shortest deterministic route through the garden route layer. The
 * authored path and owned Conveyor tiles are one graph: old gardens keep their
 * painted route, while player-built Conveyors extend it into new space.
 * Neighbor order is stable so identical saved state always produces identical
 * routing.
 */
export function findConveyorRoute(
  from: TileCoord,
  to: TileCoord,
  segments: readonly ConveyorRouteSegment[],
): ConveyorRoute | null {
  const byKey = new Map<string, ConveyorRouteSegment>();
  for (const segment of segments) {
    const key = tileKeyOf(segment.tile);
    if (byKey.has(key)) return null;
    byKey.set(key, segment);
  }

  const fromKey = tileKeyOf(from);
  const toKey = tileKeyOf(to);
  if (fromKey === toKey) return { tiles: [from], segmentIds: [], length: 0 };
  const allowed = new Set([...GARDEN_PATH_TILES.map(tileKeyOf), ...byKey.keys()]);
  allowed.add(fromKey);
  allowed.add(toKey);
  const cameFrom = new Map<string, string | null>([[fromKey, null]]);
  let frontier: TileCoord[] = [from];
  while (frontier.length > 0) {
    const next: TileCoord[] = [];
    for (const tile of frontier) {
      for (const step of ROUTE_NEIGHBOUR_STEPS) {
        const neighbour = { x: tile.x + step.x, z: tile.z + step.z };
        const key = tileKeyOf(neighbour);
        if (!allowed.has(key) || cameFrom.has(key)) continue;
        cameFrom.set(key, tileKeyOf(tile));
        if (key === toKey) {
          const keys: string[] = [key];
          let cursor = cameFrom.get(key);
          while (cursor !== null && cursor !== undefined) {
            keys.push(cursor);
            cursor = cameFrom.get(cursor);
          }
          keys.reverse();
          const tiles = keys.map((item) => {
            const [x, z] = item.split(',').map(Number);
            return { x, z };
          });
          return {
            tiles,
            segmentIds: keys.slice(1, -1).map((item) => byKey.get(item)?.id).filter((id): id is string => id !== undefined),
            length: tiles.length - 1,
          };
        }
        next.push(neighbour);
      }
    }
    frontier = next;
  }
  return null;
}

/**
 * What a manually-placed automation at `siteTile` should target: the
 * NEAREST habitat reachable from the site tile over the real path network,
 * without routing through any OTHER automation's own site tile (so two
 * structures on the same trunk can't both claim the same leg). This is the
 * 2026-08-01 manual-placement design decision (plan.yaml Phase 1.2): where
 * the player puts the structure is now what it does, replacing the old
 * hardcoded "Garden Slide always targets Sunflower Meadow" rule that caused
 * the reported visual incoherence (structure north of the Nursery, ride
 * animation going south, never touching it).
 *
 * Tie-break for equidistant habitats: lowest HabitatId alphabetically —
 * deterministic and pinned by a test, since a non-deterministic destination
 * between saves/replays would be a real, confusing bug (see plan.yaml
 * Phase 1.2's own note on this).
 */
export function nearestReachableHabitat(
  siteTile: TileCoord,
  occupiedSiteTiles: ReadonlyArray<TileCoord>,
  routeSegments: readonly ConveyorRouteSegment[] = [],
): HabitatId | null {
  const avoid = new Set(occupiedSiteTiles.filter((t) => !sameTile(t, siteTile)).map(tileKeyOf));
  const candidates = (Object.keys(HABITAT_TILES) as HabitatId[])
    .map((id) => {
      const route = routeSegments.length
        ? findConveyorRoute(siteTile, HABITAT_TILES[id], routeSegments)?.tiles ?? null
        : findPathRoute(siteTile, HABITAT_TILES[id], avoid);
      return route ? { id, length: route.length } : null;
    })
    .filter((c): c is { id: HabitatId; length: number } => c !== null)
    .sort((a, b) => a.length - b.length || a.id.localeCompare(b.id));
  return candidates[0]?.id ?? null;
}

/** How many of a tile's 4 orthogonal neighbours are themselves on the path network. */
function pathNeighbourCount(tile: TileCoord): number {
  return ROUTE_NEIGHBOUR_STEPS.filter((step) => PATH_TILE_KEY_SET.has(tileKeyOf({ x: tile.x + step.x, z: tile.z + step.z }))).length;
}

/**
 * Whether `tile` is a genuine FORK in the path network — 3 or more path
 * neighbours (a straight run has exactly 2, a dead end has 1). Written as a
 * real structural check rather than hardcoding `tile === COLOUR_GATE_TILE`
 * so it keeps working once Phase 3 (plan.yaml) makes the path network
 * player-buildable and forks become plural — today COLOUR_GATE_TILE is the
 * only tile in the fixed network with 3 neighbours (Nursery, at the trunk's
 * OTHER end, has 2: the trunk north and the Meadow run south), so this is
 * provably equivalent to that hardcoded check right now, just future-proof.
 */
export function isJunctionTile(tile: TileCoord): boolean {
  return PATH_TILE_KEY_SET.has(tileKeyOf(tile)) && pathNeighbourCount(tile) >= 3;
}

/**
 * Whether `tile` is a legal site for placing `automationId` (2026-08-01
 * manual-placement design, GameRules §9.8): on the path network, not already
 * occupied by the Nursery/a habitat/another placed automation, and — for the
 * Colour Gate specifically — a genuine junction (§9.8: "a Colour Gate cannot
 * be placed on a plain straight route; it needs a fork to govern").
 */
export function isValidAutomationSite(
  automationId: AutomationId,
  tile: TileCoord,
  occupiedSiteTiles: ReadonlyArray<TileCoord>,
  routeSegments: readonly ConveyorRouteSegment[] = [],
): boolean {
  const onRoute = PATH_TILE_KEY_SET.has(tileKeyOf(tile)) || routeSegments.some((segment) => tileDistance(segment.tile, tile) === 1);
  if (!onRoute) return false;
  if (sameTile(tile, NURSERY_TILE)) return false;
  if (habitatAtTile(tile)) return false;
  if (occupiedSiteTiles.some((t) => sameTile(t, tile))) return false;
  if (automationId === 'colourGate') return isJunctionTile(tile);
  return true;
}

/**
 * Whether `tile` is a legal site for a player-built habitat (Phase 2,
 * plan.yaml Phase 2.2): on the path network (so automations' rides can
 * actually reach it — `findPathRoute` requires both ends on the network),
 * not the Nursery, and not already occupied by anything standing there. The
 * caller is expected to pass EVERY occupied tile (all habitat instances +
 * all automation site tiles) as `occupiedTiles` — this function cannot know
 * about player-built instances itself, since the network it tests is the
 * static original one.
 */
export function isValidHabitatSite(
  tile: TileCoord,
  occupiedTiles: ReadonlyArray<TileCoord>,
  routeSegments: readonly ConveyorRouteSegment[] = [],
): boolean {
  const onRoute = PATH_TILE_KEY_SET.has(tileKeyOf(tile)) || routeSegments.some((segment) => tileDistance(segment.tile, tile) === 1);
  if (!onRoute) return false;
  if (sameTile(tile, NURSERY_TILE)) return false;
  return !occupiedTiles.some((t) => sameTile(t, tile));
}
