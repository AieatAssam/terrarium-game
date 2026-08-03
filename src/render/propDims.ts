// SINGLE SOURCE OF TRUTH for the garden props' physical dimensions.
//
// Why this module exists: three separate places used to hard-code numbers that
// all describe the same surfaces, and they silently disagreed.
//
//   * `habitats.ts` built each drum with inline MeshBuilder options AND kept a
//     parallel `HABITAT_DIMS` table of half-heights/radii for sizing the
//     standee card, AND set `mesh.position.y` in a third place.
//   * `sprouts.ts` hard-coded y = 0.55 for a settled Sprout and y = 0.8 for a
//     floating one, with a comment claiming 0.55 "clears every habitat mesh's
//     top surface (tallest is emberNook at ~0.45)". It does not: the sprite is
//     `CreatePlane({ size: 0.7 })` and `position` places its CENTRE, so 0.55
//     put the card's bottom edge at 0.20 — a quarter of a unit INSIDE a drum
//     whose top face is at 0.45. Measured in-browser before the fix, the
//     floating Nursery Sprout's bounding box started at y = 0.4006 against a
//     mound top of 0.70. `attachStandee`'s callers got this right because they
//     pass `drumTop + cardHeight / 2`; the Sprout code did not.
//   * The habitat reaction effects had the same class of bug from the same
//     cause: `createSparkleBurst` was emitting at tile-centre y = 0 (+0.3
//     internal offset = 0.30, inside a 0.45-tall drum) and the Dew Pond ripple
//     ring at y = 0.02, inside a drum whose top is 0.325.
//
// So: every prop declares its body ONCE here, the mesh is built from it, and
// every "sits on top of that" height is derived with `topSurfaceY()` plus the
// dependent object's own half-height. Changing a drum's height or a sprite's
// size now moves everything that depends on it automatically.

import { drumProfile, type DrumProfileOptions, type PrismRing } from './geometry';
import type { AutomationId, HabitatId } from '../core/ids';
import { TILE_WORLD_SIZE, tileToWorld } from '../sim/grid';
import type { Port, TransitPortFacing } from '../sim/ports';

/**
 * A bevelled volume: where its pivot sits in world space, how big it is, and
 * the silhouette profile used to build it. `halfWidth === halfDepth ===
 * cornerRadius` means a round drum; a smaller `cornerRadius` means a
 * soft-cornered plinth. See src/render/geometry.ts.
 */
export interface PropBody {
  /** World Y of the mesh pivot — the vertical CENTRE of `height`, matching
   * MeshBuilder.CreateCylinder/CreateBox convention. */
  centreY: number;
  halfWidth: number;
  halfDepth: number;
  cornerRadius: number;
  radialSegments: number;
  profile: DrumProfileOptions;
}

/** World Y of a body's flat top face — what anything resting on it measures from. */
export function topSurfaceY(body: PropBody): number {
  return body.centreY + body.profile.height / 2;
}

/** Half of a body's height; the local-space offset from its pivot to its top face. */
export function halfHeight(body: PropBody): number {
  return body.profile.height / 2;
}

/**
 * Outer visual radius at ground level: `halfWidth` plus how far the foot
 * (see geometry.ts's `foot.outset`) flares beyond the main wall. This is what
 * a drop/hover hitbox needs to match — `halfWidth` alone is the wall radius,
 * which sits visibly inside the drum's actual footprint.
 */
export function footprintRadius(body: PropBody): number {
  return body.halfWidth + (body.profile.foot?.outset ?? 0);
}

export interface PortWorldPosition {
  x: number;
  y: number;
  z: number;
}

/** Maximum numerical drift allowed when a mesh declares the same port anchor. */
export const PORT_ANCHOR_TOLERANCE = 0.001;

/** Ground-level attachment height derived from the owning body's dimensions. */
export function portBaseY(body: PropBody): number {
  return body.centreY - halfHeight(body);
}

const FACING_VECTOR: Record<TransitPortFacing, { x: number; z: number }> = {
  north: { x: 0, z: -1 },
  east: { x: 1, z: 0 },
  south: { x: 0, z: 1 },
  west: { x: -1, z: 0 },
};

/**
 * Resolve a logical port to the tile seam used by its future mesh socket.
 * `body` supplies the base height and the body/socket split; the final point
 * stays on the shared half-tile seam, so opposite ports on adjacent tiles are
 * exactly coincident rather than separated by a guessed prop radius.
 */
export function portWorldPosition(port: Port, body: PropBody): PortWorldPosition {
  const world = tileToWorld(port.tile);
  const halfTile = TILE_WORLD_SIZE / 2;
  const bodyReach = Math.min(halfTile, footprintRadius(body));
  const socketDepth = halfTile - bodyReach;
  const edgeOffset = bodyReach + socketDepth;
  const facing = FACING_VECTOR[port.facing];
  return {
    x: world.x + facing.x * edgeOffset,
    y: portBaseY(body),
    z: world.z + facing.z * edgeOffset,
  };
}

export function bodyRings(body: PropBody): PrismRing[] {
  return drumProfile(body.profile);
}

/**
 * Habitat drums. Heights and outer radii are deliberately UNCHANGED from the
 * original faceted-cylinder pass (Ember Nook 0.5 tall centred at 0.2 → top
 * 0.45; Dew Pond 0.25 → 0.325; Sunflower Meadow 0.4 → 0.40, tapering from a
 * 2.2 base to a 2.6 top) so the standee `localY` values, the Sprout settle
 * heights and the reaction-effect heights all keep the same relationship.
 * What changed is purely fidelity: a round rather than 6/8-sided
 * cross-section, a rounded top rim, a chamfered base and a wider foot with a
 * shelf step for a two-tier silhouette.
 */
export const HABITAT_BODIES: Record<HabitatId, PropBody> = {
  emberNook: {
    centreY: 0.2,
    halfWidth: 1.1,
    halfDepth: 1.1,
    cornerRadius: 1.1,
    radialSegments: 48,
    profile: {
      height: 0.5,
      topBevel: 0.1,
      bottomBevel: 0.05,
      foot: { height: 0.12, outset: 0.1, bevel: 0.05 },
    },
  },
  dewPond: {
    centreY: 0.2,
    halfWidth: 1.3,
    halfDepth: 1.3,
    cornerRadius: 1.3,
    radialSegments: 56,
    profile: {
      height: 0.25,
      topBevel: 0.06,
      bottomBevel: 0.03,
      foot: { height: 0.07, outset: 0.09, bevel: 0.03 },
    },
  },
  sunflowerMeadow: {
    centreY: 0.2,
    halfWidth: 1.3,
    halfDepth: 1.3,
    cornerRadius: 1.3,
    radialSegments: 48,
    profile: {
      height: 0.4,
      topBevel: 0.09,
      bottomBevel: 0.05,
      // 0.2 reproduces the original diameterBottom 2.2 vs diameterTop 2.6.
      taperInset: 0.2,
      foot: { height: 0.1, outset: 0.07, bevel: 0.04 },
    },
  },
};

/** Nursery mound — top face stays at 0.70, which is what the Sprout float
 * height and the Pod standee's `localY` are both derived from. */
export const NURSERY_BODY: PropBody = {
  centreY: 0.35,
  halfWidth: 0.8,
  halfDepth: 0.8,
  cornerRadius: 0.8,
  radialSegments: 48,
  profile: {
    height: 0.7,
    topBevel: 0.1,
    bottomBevel: 0.05,
    taperInset: 0.06,
    foot: { height: 0.14, outset: 0.12, bevel: 0.05 },
  },
};

/** Automation build-site plinths — soft-cornered rather than round (garden
 * equipment, not a pot), replacing plain 0.8x0.5x0.8 `CreateBox` cubes. Top
 * face stays at 0.50 so the existing standee `localY` still lands on it. */
export const AUTOMATION_BODY: PropBody = {
  centreY: 0.25,
  halfWidth: 0.4,
  halfDepth: 0.4,
  cornerRadius: 0.13,
  radialSegments: 32,
  profile: {
    height: 0.5,
    topBevel: 0.07,
    bottomBevel: 0.04,
    taperInset: 0.03,
    foot: { height: 0.09, outset: 0.06, bevel: 0.03 },
  },
};

/** Low, compact slide footing. The transit clearance/port body remains
 * `AUTOMATION_BODY`; this render body leaves the raised channel and supports
 * visible instead of hiding them inside a generic half-height box. */
export const GARDEN_SLIDE_BASE_BODY: PropBody = {
  centreY: 0.11,
  halfWidth: 0.3,
  halfDepth: 0.3,
  cornerRadius: 0.17,
  radialSegments: 32,
  profile: {
    height: 0.22,
    topBevel: 0.05,
    bottomBevel: 0.035,
    taperInset: 0.02,
    foot: { height: 0.06, outset: 0.045, bevel: 0.025 },
  },
};

/** Slightly larger twin of AUTOMATION_BODY used for the drag-placement ghost,
 * mirroring the original preview box's 0.85/0.55 vs 0.8/0.5 relationship. */
export const AUTOMATION_PREVIEW_BODY: PropBody = {
  centreY: 0.28,
  halfWidth: 0.425,
  halfDepth: 0.425,
  cornerRadius: 0.14,
  radialSegments: 32,
  profile: {
    height: 0.55,
    topBevel: 0.07,
    bottomBevel: 0.04,
    taperInset: 0.03,
    foot: { height: 0.1, outset: 0.06, bevel: 0.03 },
  },
};

/** Low, rounded bedding for one Sprout Conveyor tile. The channel is built
 * from this shared footprint plus directional arms, so neighbouring pieces
 * meet at the tile seam instead of looking like repeated floating markers. */
export const SPROUT_CONVEYOR_BODY: PropBody = {
  centreY: 0.065,
  halfWidth: 0.41,
  halfDepth: 0.41,
  cornerRadius: 0.12,
  radialSegments: 24,
  profile: {
    height: 0.13,
    topBevel: 0.035,
    bottomBevel: 0.025,
    taperInset: 0.02,
    foot: { height: 0.045, outset: 0.035, bevel: 0.02 },
  },
};

/** Local dimensions for the grown/carved channel laid over the bedding. */
export const SPROUT_CONVEYOR = {
  armHalfLength: TILE_WORLD_SIZE * 0.29,
  armCentre: TILE_WORLD_SIZE * 0.25,
  channelHalfWidth: 0.15,
  channelInsetHalfWidth: 0.095,
  channelThickness: 0.055,
  rimWidth: 0.042,
  rimHeight: 0.065,
  arrowY: 0.215,
  arrowOffset: 0.13,
} as const;

/** Shared low-profile grounding used by placed transit artifacts. The bed is
 * deliberately only a little wider than the artifact footprint: it finishes
 * the tile without becoming a new gameplay surface or hiding nearby paths. */
export const TRANSIT_GROUNDING = {
  beddingHeight: 0.035,
  beddingBevel: 0.018,
  beddingMargin: 0.06,
  contactY: 0.012,
  contactMargin: 0.26,
} as const;

export function habitatTopY(id: HabitatId): number {
  return topSurfaceY(HABITAT_BODIES[id]);
}

export function nurseryTopY(): number {
  return topSurfaceY(NURSERY_BODY);
}

/** Top face of a Garden Slide / Colour Gate plinth — both automation sites
 * share AUTOMATION_BODY, so one derivation covers both. What a carried
 * Sprout's ride height (src/render/sprouts.ts's SPROUT_RIDE_HEIGHT) measures
 * from: a ride used to float at the Nursery MOUND's clearance height
 * (~1.13) for its entire journey, which cleared the mound fine but put the
 * Sprout roughly twice the structure's own height above the belt while
 * passing beside a built Slide or Gate — reading as "floating unrelated
 * nearby" rather than "riding the conveyor" (player report). */
export function automationSiteTopY(): number {
  return topSurfaceY(AUTOMATION_BODY);
}

/**
 * The conveyor deck an automation site carries on its viewer-facing side, in
 * the plinth mesh's LOCAL space (so every value here is measured from
 * `AUTOMATION_BODY.centreY`, exactly like `halfHeight`).
 *
 * Deliberately additive: `AUTOMATION_BODY`'s own `height`/`centreY` are NOT
 * touched by this, because `automationSiteTopY()` feeds
 * `src/render/sprouts.ts`'s `SPROUT_RIDE_HEIGHT` — moving the plinth's top
 * face to make room for a belt would silently move every carried Sprout too.
 *
 * `forward` is why this exists at all: the travelling parcels were already
 * being drawn 0.46 out toward the camera from a plinth only 0.4 wide, i.e.
 * hanging in mid-air off the edge of the prop with nothing under them. The
 * deck, its rails, its end rollers and the two brackets that cantilever it
 * off the plinth wall are what those parcels now ride on.
 */
export const AUTOMATION_BELT = {
  /** Offset from the plinth centre toward the viewer (world units). */
  forward: 0.46,
  /** Half-length along the travel axis. Comfortably covers BEAD_TRAVEL/2. */
  halfLength: 0.48,
  /** Half-width across the travel axis. */
  halfWidth: 0.14,
  /** Deck slab thickness. */
  thickness: 0.075,
  /** Local Y of the deck's top face — just under the plinth's own top face,
   * so the belt reads as a side attachment rather than a hat. */
  topLocalY: halfHeight(AUTOMATION_BODY) - 0.02,
  /** Side rail above the deck: how tall, and how thick across the belt. */
  railHeight: 0.05,
  railThickness: 0.034,
  /** End-roller radius; also sets how far the rollers overhang each end. */
  rollerRadius: 0.066,
  /** Cantilever brackets joining the deck back to the plinth wall. */
  bracketHalfWidth: 0.032,
  bracketThickness: 0.05,
  /** How far the parcel's own centre floats above the deck's top face. */
  loadClearance: 0.012,
} as const;

/** Local-space Garden Slide silhouette, anchored to the south entry and north
 * exit ports derived in `src/sim/ports.ts`. Y values are relative to the
 * automation body centre, so changing the shared body moves the whole slide
 * without leaving floating supports behind. */
export interface GardenSlidePathPoint {
  z: number;
  y: number;
}

const AUTOMATION_GROUND_LOCAL_Y = -GARDEN_SLIDE_BASE_BODY.centreY;

export const GARDEN_SLIDE = {
  channelHalfWidth: 0.16,
  channelThickness: 0.075,
  channelInset: 0.095,
  railRadius: 0.026,
  railLift: 0.11,
  supportX: 0.22,
  supportZ: 0.12,
  supportWidth: 0.055,
  supportDepth: 0.055,
  entryZ: 0.44,
  exitZ: -0.44,
  entryFrameHalfWidth: 0.2,
  exitLipHeight: 0.07,
  path: [
    { z: 0.44, y: AUTOMATION_GROUND_LOCAL_Y + 0.4 },
    { z: 0.29, y: AUTOMATION_GROUND_LOCAL_Y + 0.47 },
    { z: 0.1, y: AUTOMATION_GROUND_LOCAL_Y + 0.5 },
    { z: -0.1, y: AUTOMATION_GROUND_LOCAL_Y + 0.42 },
    { z: -0.28, y: AUTOMATION_GROUND_LOCAL_Y + 0.25 },
    { z: -0.44, y: AUTOMATION_GROUND_LOCAL_Y + 0.1 },
  ] as readonly GardenSlidePathPoint[],
} as const;

export const AUTOMATION_BODIES: Record<AutomationId, PropBody> = {
  gardenSlide: GARDEN_SLIDE_BASE_BODY,
  colourGate: AUTOMATION_BODY,
  moodBell: AUTOMATION_BODY,
};
