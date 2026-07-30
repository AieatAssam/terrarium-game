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
//                                  Nursery (8,8)
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
//   * the southern run to Sunflower Meadow is untouched — it leaves the Nursery
//     directly and is the fallback/manual route (GameRules §9.4's "fallback and
//     waiting paths"), along with the Nursery's own waiting area.
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

/** Where a player-built automation instance's ghost/site marker sits by default (before it's actually built). */
export const AUTOMATION_SITE_TILES: Record<AutomationId, TileCoord> = {
  gardenSlide: GARDEN_SLIDE_TILE,
  colourGate: COLOUR_GATE_TILE,
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
