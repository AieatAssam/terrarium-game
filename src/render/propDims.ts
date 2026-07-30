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

export function habitatTopY(id: HabitatId): number {
  return topSurfaceY(HABITAT_BODIES[id]);
}

export function nurseryTopY(): number {
  return topSurfaceY(NURSERY_BODY);
}

export const AUTOMATION_BODIES: Record<AutomationId, PropBody> = {
  gardenSlide: AUTOMATION_BODY,
  colourGate: AUTOMATION_BODY,
};
