import type { HabitatId } from '../core/ids';
import { COLOUR_GATE_TILE, HABITAT_TILES, NURSERY_TILE, type ColourGateLane } from './layout';
import type { TileCoord } from './grid';

/** The closed port vocabulary shared by every Garden Transit object. */
export const TRANSIT_PORT_KINDS = ['entry', 'exit', 'dock', 'lane'] as const;
export type TransitPortKind = (typeof TRANSIT_PORT_KINDS)[number];
export type TransitPortFacing = 'north' | 'east' | 'south' | 'west';
export type TransitPortDirection = TransitPortFacing;
export type TransitPortCompatibility = 'transit' | 'nursery' | 'habitat' | 'junction';
export const TRANSIT_PORT_FACINGS: readonly TransitPortFacing[] = ['north', 'east', 'south', 'west'];

/** A derived attachment point. It is never part of a saved artifact. */
export interface Port {
  ownerId: string;
  kind: TransitPortKind;
  tile: TileCoord;
  facing: TransitPortFacing;
  compatibility: TransitPortCompatibility;
}

/** Exhaustive ordered kind matrix; compatibility tags narrow these generic joins. */
export const PORT_KIND_COMPATIBILITY: Record<TransitPortKind, Record<TransitPortKind, boolean>> = {
  entry: { entry: false, exit: true, dock: true, lane: true },
  exit: { entry: true, exit: false, dock: true, lane: false },
  dock: { entry: true, exit: true, dock: false, lane: true },
  lane: { entry: true, exit: false, dock: true, lane: false },
};

const OPPOSITE_FACING: Record<TransitPortFacing, TransitPortFacing> = {
  north: 'south',
  east: 'west',
  south: 'north',
  west: 'east',
};

function makePort(
  ownerId: string,
  kind: TransitPortKind,
  tile: TileCoord,
  facing: TransitPortFacing,
  compatibility: TransitPortCompatibility,
): Port {
  return { ownerId, kind, tile, facing, compatibility };
}

/** Nursery's outbound port faces the shared trunk. */
export function getNurseryPorts(tile: TileCoord = NURSERY_TILE): { outboundDock: Port } {
  return { outboundDock: makePort('nursery', 'dock', tile, 'north', 'nursery') };
}

/** Garden Slide ports are derived from its tile and the route's flow direction. */
export function getSlidePorts(
  slide: { id: string; tile: TileCoord },
  flowFacing: TransitPortFacing = 'north',
): { entryPort: Port; exitPort: Port } {
  return {
    entryPort: makePort(slide.id, 'entry', slide.tile, oppositePortFacing(flowFacing), 'transit'),
    exitPort: makePort(slide.id, 'exit', slide.tile, flowFacing, 'transit'),
  };
}

/** Conveyor ports use the same straight-through contract as a Slide. */
export function getConveyorPorts(
  segment: { id: string; tile: TileCoord },
  flowFacing: TransitPortFacing = 'north',
): { entryPort: Port; exitPort: Port } {
  return {
    entryPort: makePort(segment.id, 'entry', segment.tile, oppositePortFacing(flowFacing), 'transit'),
    exitPort: makePort(segment.id, 'exit', segment.tile, flowFacing, 'transit'),
  };
}

export interface ColourGatePorts {
  inboundPort: Port;
  lanePorts: Record<ColourGateLane, Port>;
}

/** Colour Gate receives from the trunk and sends through its two fixed lanes. */
export function getColourGatePorts(tile: TileCoord = COLOUR_GATE_TILE): ColourGatePorts {
  return {
    inboundPort: makePort('colourGate', 'dock', tile, 'south', 'junction'),
    lanePorts: {
      west: makePort('colourGate', 'lane', tile, 'west', 'junction'),
      east: makePort('colourGate', 'lane', tile, 'east', 'junction'),
    },
  };
}

const HABITAT_APPROACH_FACING: Record<HabitatId, TransitPortFacing> = {
  emberNook: 'south',
  dewPond: 'south',
  sunflowerMeadow: 'north',
};

/** Each habitat exposes one approach dock toward the route that serves it. */
export function getHabitatPorts(
  ownerId: string,
  habitatId: HabitatId,
  tile: TileCoord = HABITAT_TILES[habitatId],
): { approachDock: Port } {
  return { approachDock: makePort(ownerId, 'dock', tile, HABITAT_APPROACH_FACING[habitatId], 'habitat') };
}

function compatibilityPairAllowed(a: Port, b: Port): boolean {
  if (a.compatibility === 'transit' && b.compatibility === 'transit') return true;
  if (a.compatibility === 'nursery' || b.compatibility === 'nursery') {
    const transit = a.compatibility === 'nursery' ? b : a;
    return transit.compatibility === 'transit' && transit.kind === 'entry';
  }
  if (a.compatibility === 'habitat' || b.compatibility === 'habitat') {
    const habitat = a.compatibility === 'habitat' ? a : b;
    const other = habitat === a ? b : a;
    return (other.compatibility === 'transit' && other.kind === 'exit') ||
      (other.compatibility === 'junction' && other.kind === 'lane');
  }
  if (a.compatibility === 'junction' || b.compatibility === 'junction') {
    const junction = a.compatibility === 'junction' ? a : b;
    const other = junction === a ? b : a;
    return junction.kind === 'dock'
      ? other.compatibility === 'transit' && other.kind === 'exit'
      : other.compatibility === 'transit' && other.kind === 'entry';
  }
  return false;
}

/** True when two distinct ports have legal kind and role compatibility. */
export function portsCompatible(a: Port, b: Port): boolean {
  return a.ownerId !== b.ownerId &&
    PORT_KIND_COMPATIBILITY[a.kind][b.kind] &&
    compatibilityPairAllowed(a, b);
}

function tileDistance(a: TileCoord, b: TileCoord): number {
  return Math.abs(a.x - b.x) + Math.abs(a.z - b.z);
}

function facingFromTo(from: TileCoord, to: TileCoord): TransitPortFacing | null {
  if (to.x === from.x && to.z === from.z - 1) return 'north';
  if (to.x === from.x + 1 && to.z === from.z) return 'east';
  if (to.x === from.x && to.z === from.z + 1) return 'south';
  if (to.x === from.x - 1 && to.z === from.z) return 'west';
  return null;
}

/** True when compatible ports occupy neighbouring grid tiles and share a seam. */
export function portsJoined(a: Port, b: Port): boolean {
  const aTowardB = facingFromTo(a.tile, b.tile);
  const bTowardA = facingFromTo(b.tile, a.tile);
  return portsCompatible(a, b) && tileDistance(a.tile, b.tile) === 1 && aTowardB !== null && bTowardA !== null && a.facing === aTowardB && b.facing === bTowardA;
}

/** Placement clearance is tile occupancy; physical radii are owned by propDims. */
export function hasTransitTileClearance(tile: TileCoord, blockedTiles: readonly TileCoord[]): boolean {
  return blockedTiles.every((blocked) => tileDistance(tile, blocked) !== 0);
}

export function oppositePortFacing(facing: TransitPortFacing): TransitPortFacing {
  return OPPOSITE_FACING[facing];
}
