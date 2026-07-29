// Canonical tile positions for the Nursery, the three habitats, and the two
// automation build sites — docs/CONTRACTS.md: "Sim owns tile positions; the
// renderer must map through tileToWorld and never invent its own
// screen-space math." Originally these lived in src/render/layout.ts, but
// sim's own spawn/transport systems need the same authoritative positions
// (to compute transport distance/duration), and sim must never import from
// render (enforced by tests/unit/architecture.sim-boundary.test.ts). This is
// the fix: sim owns the positions, and src/render/layout.ts re-exports them
// for the renderer's own path/scenery-scatter concerns.

import type { HabitatId, AutomationId } from '../core/ids';
import type { TileCoord } from './grid';

export const NURSERY_TILE: TileCoord = { x: 8, z: 8 };

export const HABITAT_TILES: Record<HabitatId, TileCoord> = {
  emberNook: { x: 4, z: 4 },
  dewPond: { x: 12, z: 4 },
  sunflowerMeadow: { x: 8, z: 13 },
};

/** Where a player-built automation instance's ghost/site marker sits by default (before it's actually built). */
export const AUTOMATION_SITE_TILES: Record<AutomationId, TileCoord> = {
  gardenSlide: { x: 6, z: 6 },
  colourGate: { x: 10, z: 6 },
};

/** Manhattan tile distance — used for transport duration (matches the renderer's own per-tile animation timing). */
export function tileDistance(a: TileCoord, b: TileCoord): number {
  return Math.abs(a.x - b.x) + Math.abs(a.z - b.z);
}
