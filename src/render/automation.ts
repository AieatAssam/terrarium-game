// Garden Slide / Colour Gate automation structures: a subtle "future build
// site" marker at their default site tiles until `automation:built` fires,
// then a solid, LIVING structure. Also exposes a ghost/preview API for
// Subagent F's build menu UI to call while the player is choosing a placement
// — the menu UI itself is F's job (docs/CONTRACTS.md), but the 3D placement
// preview and valid/invalid feedback in the scene is E's.
//
// ---------------------------------------------------------------------------
// Working / idle / blocked
// ---------------------------------------------------------------------------
// A built Slide used to be a completely static prop: it never moved, never
// showed load, and never showed why it had stopped. GameRules §9.3 requires it
// to carry Sprouts "with a fun movement animation" and to "show
// throughput/congestion simply", and §9.7 requires bottlenecks to be shown
// through animation or world state rather than hidden in a metrics panel.
//
// So each built structure now reads as one of three states, all derived from
// bus events (this module never touches SimState):
//
//   carrying — the sim is running a ride through this automation. A little
//              glowing parcel scoots across the front of the structure and the
//              body rocks in time with it. The pace comes from the SIM's own
//              ride duration (`sprout:transportStarted.durationMs`), so buying
//              Garden Slide Speed visibly quickens the machine itself, not just
//              the Sprout on it.
//   blocked  — the destination habitat is full, which is precisely when
//              `automationSystem` (src/sim/systems.ts) declines to dispatch.
//              The parcel parks at the outfeed end under a warm amber glow and
//              the structure settles into a slow nod: "this home is already
//              cosy and full", not an alarm.
//   idle     — built, nothing waiting for it. A barely-there breathing glow.
//
// A slowly decaying "recent deliveries" level rides on top as the simple
// throughput read: a busy Slide glows warmer than one that has just started.
//
// Reduced motion damps all of it to nothing while KEEPING the state readable:
// the parcel's presence, position and colour still separate the three states
// with no animation at all.

import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { PBRMetallicRoughnessMaterial } from '@babylonjs/core/Materials/PBR/pbrMetallicRoughnessMaterial';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Material } from '@babylonjs/core/Materials/material';
import '@babylonjs/core/Engines/Extensions/engine.dynamicTexture';
import '@babylonjs/core/Engines/WebGPU/Extensions/engine.dynamicTexture';
import type { Scene } from '@babylonjs/core/scene';
import type { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';

import { GARDEN_CAMERA_ALPHA } from './camera';
import { tileToWorld, type TileCoord } from './coords';
import { attachStandee, type FlatCap } from './flatArt';
import { createRoundedPrism } from './geometry';
import {
  AUTOMATION_SITE_TILES,
  COLOUR_GATE_LANE_HABITATS,
  COLOUR_GATE_LANE_LIST,
  HABITAT_TILES,
  NURSERY_TILE,
  isReservedTile,
} from './layout';
import { prefersReducedMotion, watchReducedMotion } from './motion';
import { createFoliageBodyMaterial, createPaintedMetalMaterial, createStoneBodyMaterial, createWoodBodyMaterial } from './pbrMaterials';
import {
  bodyRings,
  footprintRadius,
  halfHeight,
  AUTOMATION_BELT,
  AUTOMATION_BODIES,
  AUTOMATION_PREVIEW_BODY,
  SPROUT_CONVEYOR,
  SPROUT_CONVEYOR_BODY,
  GARDEN_SLIDE,
  TRANSIT_GROUNDING,
  type GardenSlidePathPoint,
  type PropBody,
} from './propDims';
import { HABITATS } from '../data/habitats';
import type { PricedTransitKind } from '../data/transit';
import { SPROUT_TYPES } from '../data/sproutTypes';
import type { EventBus } from '../events/bus';
import type { AutomationId, HabitatId, MoodId, SproutTypeId } from '../core/ids';
// Render is allowed to import from sim (only sim may never import render/ui/
// audio/input) — reused here so the hover-validity preview for a manual drop
// asks the exact same question `adjudicateAutomationDrop` will ask on the
// real drop, rather than a second, potentially-diverging guess.
import { colourGateDestination, moodBellDestination } from '../sim/systems';

const SITE_FALLBACK_COLOR: Record<AutomationId, Color3> = {
  gardenSlide: new Color3(0.55, 0.45, 0.7),
  colourGate: new Color3(0.4, 0.6, 0.55),
  moodBell: new Color3(0.75, 0.55, 0.35),
};
const GARDEN_SLIDE_BODY_COLOR = new Color3(0.42, 0.28, 0.3);
const GARDEN_SLIDE_CHANNEL_COLOR = new Color3(0.55, 0.36, 0.18);
const GARDEN_SLIDE_INSET_COLOR = new Color3(0.2, 0.4, 0.29);
const GARDEN_SLIDE_FRAME_COLOR = new Color3(0.82, 0.65, 0.36);
const GARDEN_SLIDE_SUPPORT_COLOR = new Color3(0.42, 0.33, 0.25);

/** Standee card bounding footprint for a site marker and its placement ghost. */
const SITE_CAP_WIDTH = 1.0;
const SITE_CAP_HEIGHT = 0.68;
const PREVIEW_CAP_WIDTH = 1.05;
const PREVIEW_CAP_HEIGHT = 0.71;
const PREVIEW_VALID = new Color3(0.2, 0.7, 0.3);
const PREVIEW_INVALID = new Color3(0.6, 0.15, 0.15);
const PREVIEW_BLOCKED = new Color3(0.85, 0.55, 0.15);

// ---------------------------------------------------------------------------
// Activity presentation constants
// ---------------------------------------------------------------------------

/** Warm cream — a parcel of light being carried. */
const CARRY_GLOW = new Color3(0.98, 0.9, 0.68);
/** Warm amber — "this home is full". Deliberately not red: GameRules §11
 * requires recovery states to be friendly, never punitive. */
const BLOCKED_GLOW = new Color3(1.0, 0.74, 0.38);

/** Diameter of a travelling parcel bead. */
const BEAD_DIAMETER = 0.17;
/** How far a bead travels across the front of the structure, end to end. */
const BEAD_TRAVEL = 0.78;
/**
 * Beads on the belt at once, evenly spaced in phase. More than one is what
 * makes this read as a CONVEYOR rather than a single object shuttling back and
 * forth: as one bead shrinks away at the outfeed another is already swelling in
 * at the intake, so the procession is unbroken and the loop point is invisible.
 * A single bead snapping from one end back to the other was the visible jump.
 */
const BEAD_COUNT = 3;
/**
 * How far the bead sits toward the viewer from the structure's centre. The
 * structure's illustration is a camera-facing standee card standing at that
 * centre (see flatArt.ts attachStandee), so anything at the centre would be
 * fighting it for depth — offsetting toward the camera keeps the bead cleanly
 * in front. That direction is a fixed world vector because the garden camera's
 * yaw is never rotated by any input path (see GARDEN_CAMERA_ALPHA), the same
 * invariant src/render/sprouts.ts relies on for its settle slots.
 */
const BEAD_FORWARD = AUTOMATION_BELT.forward;
/** Lane lamps sit UP on the plinth's own top face and well back from the
 * viewer-facing side, so they clear the conveyor frame that now occupies it.
 * Browser QA on the built Colour Gate showed the west lamp at the old
 * 0.12 rise / 0.30 forward mingling with the parcels at the belt's intake
 * end, where a lit lamp and a piece of cargo are exactly the two things that
 * must not be confused (GameRules §9.4). */
const LANE_LAMP_RISE = 0.2;

const VIEWER_X = Math.cos(GARDEN_CAMERA_ALPHA);
const VIEWER_Z = Math.sin(GARDEN_CAMERA_ALPHA);
const LATERAL_X = -Math.sin(GARDEN_CAMERA_ALPHA);
const LATERAL_Z = Math.cos(GARDEN_CAMERA_ALPHA);

/** Bead passes are a fraction of the ride they represent, clamped so neither a
 * fully upgraded Slide strobes nor a base one looks becalmed. */
const BEAD_PASSES_PER_RIDE = 4;
const BEAD_PASS_MIN_MS = 320;
const BEAD_PASS_MAX_MS = 1400;
const DEFAULT_BEAD_PASS_MS = 840;

/**
 * The belt NEVER stops turning while ambient motion is allowed — it only
 * changes pace. Previously the phase advance was gated on `carryBlend > 0`, so
 * a conveyor spun up, ran for one short ride, spun down and dead-stopped until
 * the next Sprout boarded: a visible start/stop hitch on every single delivery,
 * which is what "jerking and not looping smoothly" described. An idle machine
 * now keeps a slow, calm creep instead, and the difference between idle and
 * working is carried by pace + the parcels themselves (which stay gated on
 * `carryBlend`, so "an idle Slide carries nothing" is still unambiguous, per
 * GameRules §9.3/§9.7).
 */
const BELT_IDLE_RATE = 0.16 / DEFAULT_BEAD_PASS_MS;
/**
 * Time constant (ms) for easing the belt's RATE (phase units per ms) rather
 * than snapping it. `passMs` is reassigned on every `sprout:transportStarted`,
 * and while the accumulator kept the belt's POSITION continuous through that,
 * its VELOCITY stepped instantly — most visibly on the Colour Gate's two-leg
 * dispatch, where leg 2 begins at a different duration to leg 1 mid-journey.
 * Easing the rate makes speed changes a smooth pull rather than a jolt.
 */
const BELT_RATE_BLEND_MS = 280;
/**
 * Fraction of a pass a parcel spends fading in at the intake and out at the
 * outfeed. The wrap point is hidden by fading to zero there (unchanged
 * intent), but the old `sin(phase * PI)` profile did that by continuously
 * swelling and shrinking across the WHOLE pass, so the procession read as
 * pulsing in place rather than travelling. A short fade window at each end
 * leaves the middle ~70% at a steady size, which is what reads as conveyed
 * cargo.
 */
const BEAD_FADE_WINDOW = 0.15;

const TWO_PI = Math.PI * 2;

/** Smoothstep, so the parcel fade has no velocity discontinuity at either
 * end of its window. */
function smoothstep(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

// ---------------------------------------------------------------------------
// Belt geometry (the "flat" half of the report)
// ---------------------------------------------------------------------------
// The parcels were the only conveyor there was: three 0.17 spheres floating at
// BEAD_FORWARD = 0.46 in front of a plinth only 0.4 wide — i.e. hanging off the
// edge of the prop with nothing beneath them, in front of a billboarded flat
// illustration. There was no deck, no rails, no rollers, no support and no
// contact darkening, so the machine had no volume to catch light on and the
// cargo had no surface to belong to.
//
// Per docs/REFERENCE_BOARD.md's material/lighting mapping (judge by bevels, PBR
// response, normal detail, roughness variation, AO, contact shadows), and
// tiny-glade-02's transferable lesson — "construct every structure from visibly
// stacked sub-parts so it reads as a physical object, not a stamped box" — the
// belt is now assembled from real, separately-lit parts: a bevelled wood deck,
// two painted side rails, two turning end rollers and two cantilever brackets
// tying it back into the plinth wall. All original geometry, built here.

/**
 * A bevelled slab: a box whose top and bottom edges are chamfered and whose
 * vertical corners are rounded, so every silhouette edge catches a highlight
 * rolloff instead of terminating in a razor line. Uses the same
 * `createRoundedPrism` machinery the plinths and habitat drums already do.
 */
function bevelledSlab(
  scene: Scene,
  name: string,
  halfX: number,
  halfY: number,
  halfZ: number,
  bevel: number,
): Mesh {
  const b = Math.min(bevel, halfX * 0.9, halfY * 0.9, halfZ * 0.9);
  return createRoundedPrism(
    name,
    {
      halfWidth: halfX,
      halfDepth: halfZ,
      cornerRadius: Math.min(b * 1.5, halfX, halfZ),
      radialSegments: 16,
      rings: [
        { y: -halfY, inset: b },
        { y: -halfY + b, inset: 0 },
        { y: halfY - b, inset: 0 },
        { y: halfY, inset: b },
      ],
    },
    scene,
  );
}

interface BeltRig {
  /** Root node; belt-local +X is the camera-lateral travel axis, -Z faces the viewer. */
  root: TransformNode;
  /** End rollers, each inside its own pivot so it can spin about its own axis. */
  rollers: TransformNode[];
}

/**
 * Builds the conveyor attached to one plinth.
 *
 * Everything is authored axis-aligned inside a single node rotated by
 * `-(GARDEN_CAMERA_ALPHA + PI/2)`, which maps belt-local +X onto the world
 * camera-lateral axis the parcels already travel along (and belt-local -Z onto
 * the viewer direction). The garden camera's yaw is never rotated by any input
 * path, the same invariant the parcel offsets themselves rely on.
 *
 * The rollers need a nested node: Babylon's Euler order is Ry·Rx·Rz, so a spin
 * about the roller's OWN axis cannot be expressed as a fourth term on a mesh
 * already tilted flat — the pivot carries the fixed tilt, the mesh carries the
 * turning.
 */
function buildBeltRig(scene: Scene, parent: Mesh, name: string, deckMaterial: PBRMetallicRoughnessMaterial, frameMaterial: PBRMetallicRoughnessMaterial): BeltRig {
  const belt = AUTOMATION_BELT;
  const root = new TransformNode(`${name}.belt`, scene);
  root.parent = parent;
  root.position.set(VIEWER_X * belt.forward, 0, VIEWER_Z * belt.forward);
  root.rotation.y = -(GARDEN_CAMERA_ALPHA + Math.PI / 2);

  const deckCentreY = belt.topLocalY - belt.thickness / 2;

  const deck = bevelledSlab(scene, `${name}.belt.deck`, belt.halfLength, belt.thickness / 2, belt.halfWidth, 0.02);
  deck.parent = root;
  deck.position.y = deckCentreY;
  deck.material = deckMaterial;
  deck.isPickable = false;

  for (const side of [-1, 1]) {
    const rail = bevelledSlab(
      scene,
      `${name}.belt.rail.${side > 0 ? 'far' : 'near'}`,
      belt.halfLength + 0.015,
      belt.railHeight / 2,
      belt.railThickness / 2,
      0.014,
    );
    rail.parent = root;
    rail.position.set(0, belt.topLocalY + belt.railHeight / 2 - 0.018, side * (belt.halfWidth + belt.railThickness / 2 - 0.008));
    rail.material = frameMaterial;
    rail.isPickable = false;

    const bracket = bevelledSlab(
      scene,
      `${name}.belt.bracket.${side > 0 ? 'far' : 'near'}`,
      belt.bracketHalfWidth,
      belt.bracketThickness / 2,
      belt.forward * 0.42,
      0.014,
    );
    bracket.parent = root;
    // Runs back along belt-local +Z (away from the viewer) into the plinth wall.
    bracket.position.set(side * (belt.halfLength * 0.52), deckCentreY - belt.thickness / 2 - 0.012, belt.forward * 0.44);
    bracket.material = frameMaterial;
    bracket.isPickable = false;
  }

  const rollers: TransformNode[] = [];
  for (const end of [-1, 1]) {
    const pivot = new TransformNode(`${name}.belt.roller.${end > 0 ? 'out' : 'in'}.pivot`, scene);
    pivot.parent = root;
    pivot.position.set(end * belt.halfLength, deckCentreY, 0);
    pivot.rotation.x = Math.PI / 2; // lays the cylinder's axis across the belt
    const roller = MeshBuilder.CreateCylinder(
      `${name}.belt.roller.${end > 0 ? 'out' : 'in'}`,
      { diameter: belt.rollerRadius * 2, height: belt.halfWidth * 2 + belt.railThickness * 1.6, tessellation: 14 },
      scene,
    );
    roller.parent = pivot;
    roller.material = frameMaterial;
    roller.isPickable = false;
    rollers.push(roller);
  }

  return { root, rollers };
}

type ConveyorDirection = 0 | 1 | 2 | 3; // north, east, south, west

interface ConveyorVisualLayout {
  connections: ConveyorDirection[];
  flowDirection: ConveyorDirection | null;
  connected: boolean;
}

interface ConveyorMaterials {
  bedding: PBRMetallicRoughnessMaterial;
  channel: PBRMetallicRoughnessMaterial;
  inset: PBRMetallicRoughnessMaterial;
  rim: PBRMetallicRoughnessMaterial;
  marker: PBRMetallicRoughnessMaterial;
}

function conveyorDirectionRotation(direction: ConveyorDirection): number {
  if (direction === 0) return Math.PI;
  if (direction === 1) return Math.PI / 2;
  if (direction === 3) return -Math.PI / 2;
  return 0;
}

function directionVector(direction: ConveyorDirection): { x: number; z: number } {
  if (direction === 0) return { x: 0, z: -1 };
  if (direction === 1) return { x: 1, z: 0 };
  if (direction === 3) return { x: -1, z: 0 };
  return { x: 0, z: 1 };
}

/** A small raised leaf-shaped arrow. Its silhouette, rather than its tint,
 * carries direction so a desaturated or colour-impaired view still works. */
function buildConveyorArrow(scene: Scene, name: string, material: PBRMetallicRoughnessMaterial): Mesh {
  const width = 0.075;
  const length = 0.12;
  const depth = 0.026;
  const positions = [
    -width, 0, -length * 0.55,
    width, 0, -length * 0.55,
    0, 0, length,
    -width, -depth, -length * 0.55,
    width, -depth, -length * 0.55,
    0, -depth, length,
  ];
  const indices = [
    0, 1, 2,
    5, 4, 3,
    0, 3, 4, 0, 4, 1,
    1, 4, 5, 1, 5, 2,
    2, 5, 3, 2, 3, 0,
  ];
  const mesh = new Mesh(name, scene);
  const data = new VertexData();
  data.positions = positions;
  data.indices = indices;
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);
  data.normals = normals;
  data.applyToMesh(mesh);
  mesh.material = material;
  mesh.isPickable = false;
  return mesh;
}

function createConveyorMaterials(scene: Scene, prefix: string): ConveyorMaterials {
  const bedding = createFoliageBodyMaterial(scene, `${prefix}.bedding`, new Color3(0.22, 0.3, 0.18));
  const channel = createWoodBodyMaterial(scene, `${prefix}.channel`, new Color3(0.42, 0.28, 0.16));
  const inset = createFoliageBodyMaterial(scene, `${prefix}.inset`, new Color3(0.16, 0.32, 0.18));
  const rim = createStoneBodyMaterial(scene, `${prefix}.rim`, new Color3(0.62, 0.53, 0.37));
  const marker = createWoodBodyMaterial(scene, `${prefix}.marker`, new Color3(0.9, 0.74, 0.4));
  marker.emissiveColor = new Color3(0.08, 0.055, 0.02);
  return { bedding, channel, inset, rim, marker };
}

function buildConveyorVisual(
  scene: Scene,
  name: string,
  layout: ConveyorVisualLayout,
  materials: ConveyorMaterials,
): Mesh {
  // ponytail: one channel mesh per arm keeps the 30-segment cap responsive;
  // restore inset/rim detail after repeated transit geometry is batched.
  const root = buildAutomationMesh(scene, name, SPROUT_CONVEYOR_BODY);
  root.material = materials.bedding;
  root.isPickable = false;

  const deckLocalY = halfHeight(SPROUT_CONVEYOR_BODY) + SPROUT_CONVEYOR.channelThickness / 2;
  const centre = bevelledSlab(
    scene,
    `${name}.channel.centre`,
    SPROUT_CONVEYOR.channelHalfWidth,
    SPROUT_CONVEYOR.channelThickness / 2,
    SPROUT_CONVEYOR.channelHalfWidth,
    0.032,
  );
  centre.parent = root;
  centre.position.y = deckLocalY;
  centre.material = materials.channel;
  centre.isPickable = false;

  for (const direction of layout.connections) {
    const vector = directionVector(direction);
    const armRoot = new TransformNode(`${name}.arm.${direction}`, scene);
    armRoot.parent = root;
    armRoot.position.set(vector.x * SPROUT_CONVEYOR.armCentre, deckLocalY, vector.z * SPROUT_CONVEYOR.armCentre);
    armRoot.rotation.y = conveyorDirectionRotation(direction);

    const arm = bevelledSlab(
      scene,
      `${name}.arm.${direction}.channel`,
      SPROUT_CONVEYOR.channelHalfWidth,
      SPROUT_CONVEYOR.channelThickness / 2,
      SPROUT_CONVEYOR.armHalfLength,
      0.028,
    );
    arm.parent = armRoot;
    arm.material = materials.channel;
    arm.isPickable = false;

  }

  if (layout.flowDirection !== null && layout.connected) {
    const arrow = buildConveyorArrow(scene, `${name}.direction`, materials.marker);
    arrow.parent = root;
    arrow.position.set(
      directionVector(layout.flowDirection).x * SPROUT_CONVEYOR.arrowOffset,
      SPROUT_CONVEYOR.arrowY,
      directionVector(layout.flowDirection).z * SPROUT_CONVEYOR.arrowOffset,
    );
    arrow.rotation.y = conveyorDirectionRotation(layout.flowDirection);
  } else {
    // A loose segment is deliberately capped with a visible planted bud: it
    // reads as waiting for a neighbour, not as a broken industrial machine.
    const bud = MeshBuilder.CreateCylinder(`${name}.waiting.bud`, {
      diameter: 0.14,
      height: 0.045,
      tessellation: 8,
    }, scene);
    bud.parent = root;
    bud.position.y = SPROUT_CONVEYOR.arrowY;
    bud.material = materials.rim;
    bud.isPickable = false;
  }

  return root;
}

interface GardenSlideMaterials {
  channel: PBRMetallicRoughnessMaterial;
  inset: PBRMetallicRoughnessMaterial;
  frame: PBRMetallicRoughnessMaterial;
  support: PBRMetallicRoughnessMaterial;
}

interface GardenSlideRig {
  root: TransformNode;
  path: readonly GardenSlidePathPoint[];
}

/** Interpolates the authored south-entry -> north-exit slide path in-place. */
function setSlidePathPosition(mesh: Mesh, path: readonly GardenSlidePathPoint[], t: number): void {
  const progress = Math.min(1, Math.max(0, t)) * (path.length - 1);
  const index = Math.min(path.length - 2, Math.floor(progress));
  const local = progress - index;
  const from = path[index];
  const to = path[index + 1];
  mesh.position.set(0, from.y + (to.y - from.y) * local, from.z + (to.z - from.z) * local);
}

function slidePathYAt(path: readonly GardenSlidePathPoint[], t: number): number {
  const progress = Math.min(1, Math.max(0, t)) * (path.length - 1);
  const index = Math.min(path.length - 2, Math.floor(progress));
  const local = progress - index;
  return path[index].y + (path[index + 1].y - path[index].y) * local;
}

/**
 * The Garden Slide is deliberately not a billboard: the entry and exit are
 * physical north/south sockets. A shallow sequence of bevelled channel slabs
 * gives the trough a readable curve without turning the whole artifact into a
 * pipe; two thin rails, a framed mouth, feet, and a low exit lip complete the
 * silhouette. All children stay under the placed body so the existing shadow
 * and move/remove lifecycle continues to own the whole object.
 */
function buildGardenSlideRig(
  scene: Scene,
  parent: Mesh,
  name: string,
  materials: GardenSlideMaterials,
): GardenSlideRig {
  const root = new TransformNode(`${name}.slide`, scene);
  root.parent = parent;
  const path = GARDEN_SLIDE.path;

  const addSlabSegment = (
    suffix: string,
    width: number,
    thickness: number,
    material: PBRMetallicRoughnessMaterial,
    lift: number,
  ): void => {
    for (let index = 0; index < path.length - 1; index += 1) {
      const from = path[index];
      const to = path[index + 1];
      const length = Math.abs(from.z - to.z);
      const slab = bevelledSlab(
        scene,
        `${name}.${suffix}.${index}`,
        width,
        thickness / 2,
        length / 2 + 0.012,
        Math.min(0.024, thickness * 0.36),
      );
      slab.parent = root;
      slab.position.set(0, (from.y + to.y) / 2 + lift, (from.z + to.z) / 2);
      // Local +Z is the south end of each segment. This pitch makes the
      // channel meet both authored path heights instead of stepping between
      // them, while the bevels keep each join soft at gameplay distance.
      slab.rotation.x = Math.asin(Math.max(-0.8, Math.min(0.8, -(from.y - to.y) / length)));
      slab.material = material;
      slab.isPickable = false;
    }
  };

  addSlabSegment('channel', GARDEN_SLIDE.channelHalfWidth, GARDEN_SLIDE.channelThickness, materials.channel, 0);
  addSlabSegment('channel.inset', GARDEN_SLIDE.channelInset, 0.018, materials.inset, GARDEN_SLIDE.channelThickness / 2 + 0.012);

  for (const side of [-1, 1]) {
    const railPath = path.map((point) => new Vector3(
      side * (GARDEN_SLIDE.channelHalfWidth - GARDEN_SLIDE.railRadius * 0.55),
      point.y + GARDEN_SLIDE.railLift,
      point.z,
    ));
    const rail = MeshBuilder.CreateTube(
      `${name}.rail.${side > 0 ? 'east' : 'west'}`,
      { path: railPath, radius: GARDEN_SLIDE.railRadius, tessellation: 8, cap: Mesh.CAP_END },
      scene,
    );
    rail.parent = root;
    rail.material = materials.frame;
    rail.isPickable = false;
  }

  const groundY = GARDEN_SLIDE.path[GARDEN_SLIDE.path.length - 1].y - 0.1;
  const addPost = (suffix: string, x: number, z: number, topY: number): void => {
    const height = Math.max(0.08, topY - groundY);
    const post = bevelledSlab(
      scene,
      `${name}.${suffix}`,
      GARDEN_SLIDE.supportWidth / 2,
      height / 2,
      GARDEN_SLIDE.supportDepth / 2,
      0.018,
    );
    post.parent = root;
    post.position.set(x, groundY + height / 2, z);
    post.material = materials.support;
    post.isPickable = false;

    const foot = bevelledSlab(scene, `${name}.${suffix}.foot`, 0.08, 0.025, 0.08, 0.018);
    foot.parent = root;
    foot.position.set(x, groundY + 0.025, z);
    foot.material = materials.support;
    foot.isPickable = false;
  };

  const supportTs = [0.34, 0.58];
  for (const t of supportTs) {
    const z = GARDEN_SLIDE.entryZ + (GARDEN_SLIDE.exitZ - GARDEN_SLIDE.entryZ) * t;
    const topY = slidePathYAt(path, t) - GARDEN_SLIDE.channelThickness / 2;
    addPost(`support.${t}.west`, -GARDEN_SLIDE.supportX, z, topY);
    addPost(`support.${t}.east`, GARDEN_SLIDE.supportX, z, topY);
  }

  const brace = bevelledSlab(scene, `${name}.support.brace`, GARDEN_SLIDE.supportX + 0.055, 0.025, 0.04, 0.018);
  brace.parent = root;
  brace.position.set(0, groundY + 0.2, -0.02);
  brace.material = materials.frame;
  brace.isPickable = false;

  const entryTop = path[0].y + 0.035;
  const entryPostHeight = entryTop - groundY;
  for (const side of [-1, 1]) addPost(`entry.mouth.${side > 0 ? 'east' : 'west'}`, side * GARDEN_SLIDE.entryFrameHalfWidth, GARDEN_SLIDE.entryZ, entryTop);
  const entryHeader = bevelledSlab(
    scene,
    `${name}.entry.header`,
    GARDEN_SLIDE.entryFrameHalfWidth + 0.035,
    0.035,
    0.045,
    0.022,
  );
  entryHeader.parent = root;
  entryHeader.position.set(0, groundY + entryPostHeight, GARDEN_SLIDE.entryZ);
  entryHeader.material = materials.frame;
  entryHeader.isPickable = false;

  const exitLip = bevelledSlab(
    scene,
    `${name}.exit.lip`,
    GARDEN_SLIDE.channelHalfWidth + 0.035,
    GARDEN_SLIDE.exitLipHeight / 2,
    0.035,
    0.022,
  );
  exitLip.parent = root;
  exitLip.position.set(0, path[path.length - 1].y + GARDEN_SLIDE.exitLipHeight / 2, GARDEN_SLIDE.exitZ);
  exitLip.material = materials.frame;
  exitLip.isPickable = false;

  return { root, path };
}

/**
 * A soft, radially-fading darkening disc laid just above the ground under a
 * built site. The cast shadow alone leaves the plinth looking set down next to
 * the garden rather than into it (the shadow map is soft and directional, so it
 * does not darken the millimetres directly beneath the foot); this is the
 * contact-occlusion term that grounds it. Vertex alpha rather than an opacity
 * texture: no texture fetch, no extra memory, and the falloff is exactly the
 * geometric one we want.
 */
function buildContactPad(scene: Scene, name: string, radius: number, material: PBRMetallicRoughnessMaterial): Mesh {
  const segments = 28;
  const positions: number[] = [0, 0, 0];
  const colors: number[] = [1, 1, 1, 1];
  const indices: number[] = [];
  // Two rings: an inner plateau that holds most of the darkness, then a fade
  // to fully transparent at the rim, so the pad has no visible hard edge.
  const ringRadii = [radius * 0.55, radius];
  const ringAlpha = [0.85, 0];
  for (let ring = 0; ring < ringRadii.length; ring += 1) {
    for (let col = 0; col <= segments; col += 1) {
      const angle = (TWO_PI * col) / segments;
      positions.push(ringRadii[ring] * Math.cos(angle), 0, -ringRadii[ring] * Math.sin(angle));
      colors.push(1, 1, 1, ringAlpha[ring]);
    }
  }
  const ringStart = (ring: number): number => 1 + ring * (segments + 1);
  for (let col = 0; col < segments; col += 1) {
    indices.push(0, ringStart(0) + col + 1, ringStart(0) + col);
    indices.push(ringStart(0) + col, ringStart(0) + col + 1, ringStart(1) + col);
    indices.push(ringStart(1) + col, ringStart(0) + col + 1, ringStart(1) + col + 1);
  }
  const mesh = new Mesh(name, scene);
  const data = new VertexData();
  data.positions = positions;
  data.indices = indices;
  data.colors = colors;
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);
  data.normals = normals;
  data.applyToMesh(mesh);
  mesh.setVerticesData(VertexBuffer.ColorKind, colors, false, 4);
  mesh.hasVertexAlpha = true;
  mesh.material = material;
  mesh.isPickable = false;
  mesh.receiveShadows = false;
  mesh.setEnabled(false);
  return mesh;
}

function buildTransitGrounding(
  scene: Scene,
  name: string,
  body: PropBody,
  beddingMaterial: PBRMetallicRoughnessMaterial,
  contactPadMaterial: PBRMetallicRoughnessMaterial,
): { terrainBed: Mesh; contactPad: Mesh } {
  const radius = footprintRadius(body) + TRANSIT_GROUNDING.beddingMargin;
  const terrainBed = bevelledSlab(
    scene,
    `${name}.terrainBed`,
    radius,
    TRANSIT_GROUNDING.beddingHeight / 2,
    radius,
    TRANSIT_GROUNDING.beddingBevel,
  );
  terrainBed.material = beddingMaterial;
  terrainBed.isPickable = false;
  terrainBed.receiveShadows = true;

  const contactPad = buildContactPad(
    scene,
    `${name}.contact`,
    footprintRadius(body) + TRANSIT_GROUNDING.contactMargin,
    contactPadMaterial,
  );
  return { terrainBed, contactPad };
}

/** Each completed delivery adds this much "recently busy", which then decays. */
const THROUGHPUT_PER_DELIVERY = 0.34;
/** Time constant (ms) of the throughput decay — a Slide left alone cools off over a few seconds. */
const THROUGHPUT_DECAY_MS = 6000;

/**
 * Time constant (ms) for the carrying/blocked cross-fades. Every state change
 * is eased rather than switched: without this, the belt stopped dead the
 * instant a ride ended and the body's rock snapped back to zero — a stutter on
 * every single delivery. `1 - exp(-dt/T)` is frame-rate independent, so this
 * behaves identically at 30fps and 144fps.
 */
const ACTIVITY_BLEND_MS = 220;

type SiteActivity = 'idle' | 'carrying' | 'blocked';

interface SiteMarker {
  id: AutomationId;
  mesh: Mesh;
  /** Optional flat cap material for the legacy Gate/Bell standees. */
  capMaterial: PBRMetallicRoughnessMaterial | null;
  bodyMaterial: PBRMetallicRoughnessMaterial;
  built: boolean;
  /**
   * Where the player actually placed this structure (2026-08-01, manual
   * placement — GameRules §9.8). Null until `automation:built` provides one.
   * There is no fixed default site anymore, so the mesh sits disabled at the
   * origin until this is set.
   */
  siteTile: TileCoord | null;
  /** World Y the body rests at, so the working bob always returns to it. */
  baseY: number;
  /** The one habitat this instance delivers to (Garden Slide). Null for the
   * Colour Gate, which routes each Sprout to its own matching habitat. */
  targetHabitatId: HabitatId | null;
  /** Sim says a ride is in flight through this automation right now. */
  carrying: boolean;
  /** Destination habitat is at capacity — exactly when automationSystem
   * declines to dispatch (src/sim/systems.ts, "target full — wait rather than
   * force a rejected delivery"). Only ever meaningful for a SINGLE fixed
   * `targetHabitatId` (the Garden Slide). The Mood Bell's destination varies
   * per ride, so it never gets a `targetHabitatId` here and this stays
   * `false` for it always — a deliberate v1 simplification (it shows idle
   * rather than blocked when its only eligible Sprout's habitat happens to
   * be full), not a bug. */
  destinationFull: boolean;
  /** ms for one bead pass, derived from the sim's own ride duration. */
  passMs: number;
  /** Decaying 0..1 "recent deliveries" level. */
  throughput: number;
  /**
   * ACCUMULATED belt phase in [0,1), advanced by `delta / passMs` every frame.
   * Deliberately not `(now % passMs) / passMs`: that form jumps the instant
   * `passMs` changes, which is exactly when a new ride starts at a different
   * upgraded speed — the belt would visibly hitch on every boarding. An
   * accumulator stays continuous through a speed change.
   */
  beltPhase: number;
  /**
   * Current belt speed in phase units per ms, EASED toward its target rather
   * than assigned. See BELT_RATE_BLEND_MS: `passMs` changes discontinuously on
   * every boarding, and easing the rate is what keeps the velocity (not just
   * the position) continuous through that.
   */
  beltRate: number;
  /** The conveyor rig — deck, rails, brackets and the two turning rollers. */
  belt: BeltRig;
  /** Soft contact-occlusion disc on the ground under this site. */
  contactPad: Mesh;
  /** Eased 0..1 weights for the two non-idle states; see ACTIVITY_BLEND_MS. */
  carryBlend: number;
  blockBlend: number;
  /** The procession on the belt (carrying). */
  beads: Mesh[];
  beadMaterial: PBRMetallicRoughnessMaterial;
  beadsVisible: boolean;
  /** The single parked parcel that says "nowhere to put this" (blocked). */
  waitBead: Mesh;
  waitMaterial: PBRMetallicRoughnessMaterial;
  waitVisible: boolean;
  /** Local Y both bead kinds ride at, cached so it isn't recomputed per frame. */
  beadLocalY: number;
  /** Garden Slide's physical south-entry -> north-exit path; null for Gate/Bell. */
  travelPath: readonly GardenSlidePathPoint[] | null;
}

interface TransitMarker {
  id: string;
  kind: PricedTransitKind;
  mesh: Mesh;
  bodyMaterial: PBRMetallicRoughnessMaterial;
  capMaterial: PBRMetallicRoughnessMaterial | null;
  tile: TileCoord;
  ownsBodyMaterial: boolean;
  terrainBed: Mesh;
  contactPad: Mesh;
  label: TransitLabelVisual | null;
  previewLine: Mesh | null;
}

interface TransitSlideVisualState {
  id: string;
  tile: TileCoord;
  acceptedKind: SproutTypeId | 'any';
  destination: HabitatId;
  enabled: boolean;
}

interface TransitSlidePreviewConfig {
  acceptedKind: SproutTypeId | 'any';
  destination: HabitatId;
  enabled: boolean;
}

interface TransitLabelVisual {
  mesh: Mesh;
  texture: DynamicTexture;
  material: PBRMetallicRoughnessMaterial;
  drawn: string;
}

export interface AutomationManager {
  previewAt: (automationId: AutomationId, tile: TileCoord, status: boolean | 'valid' | 'invalid' | 'blocked') => void;
  previewTransitAt: (kind: PricedTransitKind, tile: TileCoord, status: 'valid' | 'invalid' | 'blocked') => void;
  previewTransitConfiguration: (slideId: string, configuration: TransitSlidePreviewConfig | null) => void;
  clearPreview: () => void;
  /**
   * The nearest BUILT automation site within `marginTiles` of `world`, or
   * null. Mirrors `habitats.ts`'s `nearestWithin` exactly (continuous
   * Euclidean distance against the structure's real footprint, not a
   * round-to-tile Manhattan check) so a Sprout drop resolves against
   * automation sites the same forgiving way it already resolves against
   * habitats (GameRules §10: "generous snapping ... no pixel-perfect
   * placement"). A site that hasn't been built yet is never a candidate —
   * its translucent "not yet built" marker is not a valid drop target.
   */
  nearestBuiltWithin: (world: { x: number; z: number }, marginTiles: number) => AutomationId | null;
  nearestTransitWithin: (world: { x: number; z: number }, marginTiles: number) => { id: string; kind: PricedTransitKind } | null;
  /**
   * Whether `automationId` would currently accept `sproutType` — an
   * approximation for the drag-hover tint only (mirrors habitats.ts's own
   * `matchSproutType` hover check, which likewise ignores capacity). The
   * real, authoritative answer is `adjudicateAutomationDrop` on the actual
   * drop; this exists purely so a held Sprout dims/brightens while hovering
   * an automation site the same way it already does while hovering a
   * habitat, not to gate anything. Null if the site isn't built (no site to
   * ask), true/false once it is.
   */
  matchesSprout: (automationId: AutomationId, sproutType: SproutTypeId, mood: MoodId) => boolean | null;
  dispose: () => void;
}

// ---------------------------------------------------------------------------
// The Colour Gate's active rule, shown in the world
// ---------------------------------------------------------------------------
// GameRules §9.4 requires the Gate to "visibly show its active rule" — not only
// inside its panel. The Gate stands on the fork with a lane running west and a
// lane running east, so it carries one glowing lamp over each lane, lit in that
// lane's chosen Sprout colour.
//
// Colour is not the only signal (§4.1, §11 accessibility): an unset or refused
// lane's lamp goes dark and small, so "this lane is carrying somebody" versus
// "this lane is quiet" reads by brightness and size as well as hue, and the
// panel states the same rule in words. The lamps are placed on the world ±X
// axis (not the camera's lateral axis) because west and east are facts about
// the garden, not about where the camera happens to be.

/** How far out along world ±X the lane lamps sit from the Gate's centre. */
const LANE_LAMP_OFFSET = 0.44;
/** Nudge toward the viewer so a lamp is never lost behind the billboarded card. */
const LANE_LAMP_FORWARD = 0.14;
const LANE_LAMP_DIAMETER = 0.19;
/** Tint for a lane nobody is assigned to — a lamp that is simply not lit. */
const LANE_LAMP_UNSET = new Color3(0.4, 0.44, 0.42);

function laneColour(sproutType: SproutTypeId | null): Color3 {
  if (!sproutType) return LANE_LAMP_UNSET.clone();
  const hex = SPROUT_TYPES[sproutType]?.primaryColor;
  const parsed = hex && /^#[0-9a-f]{6}$/i.test(hex) ? Color3.FromHexString(hex) : null;
  return parsed ?? LANE_LAMP_UNSET.clone();
}

/**
 * Automation plinth body. Previously a plain `MeshBuilder.CreateBox` — a
 * literal cube with six razor-sharp edges, which is what "extremely blocky"
 * described. Now a `createRoundedPrism` with a soft-cornered rounded-rectangle
 * cross-section (garden equipment, not a pot: the corner radius is well under
 * the half-extent so it still reads as a square plinth), a chamfered top and
 * base, a wider foot with a shelf step, and a slight taper. Built as ONE mesh
 * deliberately: these markers are semi-transparent until built, and stacking
 * separate tier meshes would double-darken through the alpha blend.
 */
function buildAutomationMesh(scene: Scene, name: string, body: PropBody): Mesh {
  return createRoundedPrism(
    name,
    {
      halfWidth: body.halfWidth,
      halfDepth: body.halfDepth,
      cornerRadius: body.cornerRadius,
      radialSegments: body.radialSegments,
      rings: bodyRings(body),
    },
    scene,
  );
}

/** Which habitat a destination tile belongs to, or null. Lets a restored save
 * (which replays no `automation:built`) still learn a Slide's destination from
 * the first ride it runs. */
function habitatAtTile(tile: TileCoord): HabitatId | null {
  for (const [id, habitatTile] of Object.entries(HABITAT_TILES) as [HabitatId, TileCoord][]) {
    if (habitatTile.x === tile.x && habitatTile.z === tile.z) return id;
  }
  return null;
}

function activityOf(site: SiteMarker): SiteActivity {
  if (!site.built) return 'idle';
  if (site.carrying) return 'carrying';
  if (site.destinationFull) return 'blocked';
  return 'idle';
}

const TRANSIT_LABEL_TEXTURE = { width: 640, height: 192 };
const TRANSIT_LABEL_WIDTH = 2.05;
const TRANSIT_LABEL_HEIGHT = 0.62;
const TRANSIT_LABEL_Y = 1.18;
const TRANSIT_PREVIEW_Y = 0.16;

function highContrastLabels(): boolean {
  return typeof document !== 'undefined' && document.documentElement?.getAttribute('data-contrast') === 'high';
}

function sproutLabelColour(acceptedKind: SproutTypeId | 'any'): string {
  if (acceptedKind === 'any') return '#ffe08a';
  return SPROUT_TYPES[acceptedKind]?.primaryColor ?? '#ffe08a';
}

function drawTransitLabel(
  label: TransitLabelVisual,
  state: TransitSlideVisualState,
  preview: TransitSlidePreviewConfig | null,
): void {
  const config = preview ?? state;
  const contrast = highContrastLabels();
  const acceptedName = config.acceptedKind === 'any' ? 'ANY SPROUT' : SPROUT_TYPES[config.acceptedKind]?.displayName.toUpperCase() ?? 'ANY SPROUT';
  const destinationName = HABITATS[config.destination]?.displayName.toUpperCase() ?? 'HOME';
  const status = preview ? 'PREVIEW · APPLY' : config.enabled ? 'READY · ROUTE OPEN' : 'PAUSED · ENABLE TO RESUME';
  const signature = `${acceptedName}/${destinationName}/${status}/${contrast}`;
  if (label.drawn === signature) return;
  label.drawn = signature;

  const ctx = label.texture.getContext() as unknown as CanvasRenderingContext2D;
  const { width, height } = TRANSIT_LABEL_TEXTURE;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = contrast ? '#ffffff' : 'rgba(22, 34, 25, 0.94)';
  ctx.strokeStyle = contrast ? '#000000' : '#d8b56b';
  ctx.lineWidth = contrast ? 10 : 7;
  ctx.beginPath();
  ctx.roundRect(8, 8, width - 16, height - 16, 22);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = contrast ? '#000000' : '#fff4d5';
  ctx.font = '700 29px Segoe UI, sans-serif';
  ctx.textBaseline = 'top';
  ctx.fillText(`✦ GARDEN SLIDE  →  ${destinationName}`, 28, 24);
  ctx.fillStyle = sproutLabelColour(config.acceptedKind);
  ctx.beginPath();
  ctx.arc(41, 97, 14, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = contrast ? '#000000' : '#fff4d5';
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.fillStyle = contrast ? '#000000' : '#fff4d5';
  ctx.font = '700 27px Segoe UI, sans-serif';
  ctx.fillText(`${acceptedName}  →  ${status}`, 70, 81);
  label.texture.update();
}

export function createAutomationManager(scene: Scene, bus: EventBus, shadowGenerator: ShadowGenerator): AutomationManager {
  const sites = {} as Record<AutomationId, SiteMarker>;
  const transitMarkers = new Map<string, TransitMarker>();
  const conveyorMaterials = createConveyorMaterials(scene, 'terrarium.transit.conveyor');
  let knownSlides: TransitSlideVisualState[] = [];
  let knownConveyors: Array<{ id: string; tile: TileCoord }> = [];
  const previewConfigs = new Map<string, TransitSlidePreviewConfig>();
  const previewRouteMaterial = new StandardMaterial('terrarium.transit.preview.route.mat', scene);
  previewRouteMaterial.diffuseColor = new Color3(0.96, 0.78, 0.35);
  previewRouteMaterial.emissiveColor = new Color3(0.34, 0.2, 0.06);
  previewRouteMaterial.alpha = 0.76;
  let contrastObserver: MutationObserver | undefined;
  const slideMaterials: GardenSlideMaterials = {
    channel: createWoodBodyMaterial(scene, 'terrarium.automation.slide.channel.mat', GARDEN_SLIDE_CHANNEL_COLOR.clone()),
    inset: createWoodBodyMaterial(scene, 'terrarium.automation.slide.inset.mat', GARDEN_SLIDE_INSET_COLOR.clone()),
    frame: createWoodBodyMaterial(scene, 'terrarium.automation.slide.frame.mat', GARDEN_SLIDE_FRAME_COLOR.clone()),
    support: createStoneBodyMaterial(scene, 'terrarium.automation.slide.support.mat', GARDEN_SLIDE_SUPPORT_COLOR.clone()),
  };
  slideMaterials.frame.emissiveColor = new Color3(0.08, 0.055, 0.02);

  const tileKey = (tile: TileCoord): string => `${tile.x},${tile.z}`;
  const directionOffsets: Array<{ x: number; z: number }> = [
    { x: 0, z: -1 },
    { x: 1, z: 0 },
    { x: 0, z: 1 },
    { x: -1, z: 0 },
  ];

  const updateTransitLabel = (marker: TransitMarker, state: TransitSlideVisualState): void => {
    if (marker.kind !== 'gardenSlide') return;
    if (!marker.label) {
      const mesh = MeshBuilder.CreatePlane(`terrarium.transit.${marker.id}.rule`, {
        width: TRANSIT_LABEL_WIDTH,
        height: TRANSIT_LABEL_HEIGHT,
      }, scene);
      mesh.billboardMode = Mesh.BILLBOARDMODE_Y;
      mesh.isPickable = false;
      const texture = new DynamicTexture(
        `terrarium.transit.${marker.id}.rule.tex`,
        TRANSIT_LABEL_TEXTURE,
        scene,
        true,
        Texture.TRILINEAR_SAMPLINGMODE,
      );
      texture.hasAlpha = true;
      const material = new PBRMetallicRoughnessMaterial(`terrarium.transit.${marker.id}.rule.mat`, scene);
      material.baseTexture = texture;
      material.emissiveTexture = texture;
      material.emissiveColor = new Color3(0.42, 0.42, 0.42);
      material.metallic = 0;
      material.roughness = 0.8;
      material.backFaceCulling = false;
      (material as unknown as { _useAlphaFromAlbedoTexture: boolean })._useAlphaFromAlbedoTexture = true;
      material.transparencyMode = Material.MATERIAL_ALPHABLEND;
      mesh.material = material;
      marker.label = { mesh, texture, material, drawn: '' };
    }
    const world = tileToWorld(marker.tile);
    marker.label.mesh.position.set(world.x, TRANSIT_LABEL_Y, world.z);
    drawTransitLabel(marker.label, state, previewConfigs.get(marker.id) ?? null);
  };

  const clearTransitPreview = (marker: TransitMarker): void => {
    marker.previewLine?.dispose();
    marker.previewLine = null;
    if (marker.label) marker.label.drawn = '';
  };

  const updateTransitPreview = (marker: TransitMarker, state: TransitSlideVisualState): void => {
    clearTransitPreview(marker);
    const preview = previewConfigs.get(marker.id);
    if (!preview || marker.kind !== 'gardenSlide') {
      updateTransitLabel(marker, state);
      return;
    }
    const destinationTile = HABITAT_TILES[preview.destination];
    const from = tileToWorld(marker.tile);
    const to = tileToWorld(destinationTile);
    const line = MeshBuilder.CreateDashedLines(`terrarium.transit.${marker.id}.preview`, {
      points: [
        new Vector3(from.x, TRANSIT_PREVIEW_Y, from.z),
        new Vector3(to.x, TRANSIT_PREVIEW_Y, to.z),
      ],
      dashNb: 12,
      dashSize: 0.18,
      gapSize: 0.12,
    }, scene);
    line.isPickable = false;
    line.material = previewRouteMaterial;
    marker.previewLine = line;
    updateTransitLabel(marker, state);
  };

  const conveyorVisuals = (): Map<string, ConveyorVisualLayout> => {
    const endpointTiles = [
      NURSERY_TILE,
      ...knownSlides.map((slide) => slide.tile),
      ...Object.values(HABITAT_TILES),
    ];
    const nodeTiles = [...knownConveyors.map((conveyor) => conveyor.tile), ...endpointTiles];
    const nodeKeys = new Set(nodeTiles.map(tileKey));
    const distance = new Map<string, number>();
    const frontier: TileCoord[] = [];
    for (const tile of [...knownSlides.map((slide) => slide.tile), NURSERY_TILE]) {
      const key = tileKey(tile);
      if (distance.has(key)) continue;
      distance.set(key, 0);
      frontier.push(tile);
    }
    for (let index = 0; index < frontier.length; index += 1) {
      const tile = frontier[index];
      const here = distance.get(tileKey(tile)) as number;
      for (const offset of directionOffsets) {
        const neighbour = { x: tile.x + offset.x, z: tile.z + offset.z };
        const key = tileKey(neighbour);
        if (!nodeKeys.has(key) || distance.has(key)) continue;
        distance.set(key, here + 1);
        frontier.push(neighbour);
      }
    }

    const visuals = new Map<string, ConveyorVisualLayout>();
    for (const conveyor of knownConveyors) {
      const here = distance.get(tileKey(conveyor.tile));
      const connections = directionOffsets
        .map((offset, direction) => ({
          direction: direction as ConveyorDirection,
          key: tileKey({ x: conveyor.tile.x + offset.x, z: conveyor.tile.z + offset.z }),
        }))
        .filter(({ key }) => nodeKeys.has(key))
        .map(({ direction }) => direction);
      const outward = connections.find((direction) => {
        const offset = directionOffsets[direction];
        return (distance.get(tileKey({ x: conveyor.tile.x + offset.x, z: conveyor.tile.z + offset.z })) ?? -1) > (here ?? -1);
      });
      visuals.set(conveyor.id, {
        connections,
        flowDirection: outward ?? connections[0] ?? null,
        connected: here !== undefined,
      });
    }
    return visuals;
  };

  const refreshConveyorVisuals = (): void => {
    const visuals = conveyorVisuals();
    for (const marker of transitMarkers.values()) {
      if (marker.kind !== 'sproutConveyor') continue;
      const oldMesh = marker.mesh;
      const mesh = buildConveyorVisual(
        scene,
        `terrarium.transit.${marker.kind}.${marker.id}`,
        visuals.get(marker.id) ?? { connections: [], flowDirection: null, connected: false },
        conveyorMaterials,
      );
      const world = tileToWorld(marker.tile);
      mesh.position.set(world.x, SPROUT_CONVEYOR_BODY.centreY, world.z);
      mesh.metadata = { kind: 'transit', transitKind: marker.kind, artifactId: marker.id, tile: marker.tile };
      marker.mesh = mesh;
      marker.bodyMaterial = conveyorMaterials.bedding;
      oldMesh.dispose(false, false);
    }
  };

  const addTransitMarker = (
    id: string,
    kind: PricedTransitKind,
    tile: TileCoord,
    slideState?: TransitSlideVisualState,
  ): void => {
    const existing = transitMarkers.get(id);
    if (existing) {
      existing.tile = tile;
      const world = tileToWorld(tile);
      existing.mesh.position.set(world.x, kind === 'sproutConveyor' ? SPROUT_CONVEYOR_BODY.centreY : AUTOMATION_BODIES.gardenSlide.centreY, world.z);
      existing.terrainBed.position.set(world.x, TRANSIT_GROUNDING.beddingHeight / 2, world.z);
      existing.contactPad.position.set(world.x, TRANSIT_GROUNDING.contactY, world.z);
      existing.mesh.metadata = { kind: 'transit', transitKind: kind, artifactId: id, tile };
      if (slideState) updateTransitPreview(existing, slideState);
      return;
    }
    if (kind === 'sproutConveyor') {
      const mesh = buildConveyorVisual(
        scene,
        `terrarium.transit.${kind}.${id}`,
        conveyorVisuals().get(id) ?? { connections: [], flowDirection: null, connected: false },
        conveyorMaterials,
      );
      const world = tileToWorld(tile);
      mesh.position.set(world.x, SPROUT_CONVEYOR_BODY.centreY, world.z);
      mesh.metadata = { kind: 'transit', transitKind: kind, artifactId: id, tile };
      const grounding = buildTransitGrounding(
        scene,
        `terrarium.transit.${kind}.${id}`,
        SPROUT_CONVEYOR_BODY,
        conveyorMaterials.bedding,
        contactPadMaterial,
      );
      // ponytail: the body already carries bedding; batch these pads before
      // re-enabling per-segment grounding at the cap.
      grounding.terrainBed.setEnabled(false);
      grounding.contactPad.setEnabled(false);
      grounding.terrainBed.position.set(world.x, TRANSIT_GROUNDING.beddingHeight / 2, world.z);
      grounding.contactPad.position.set(world.x, TRANSIT_GROUNDING.contactY, world.z);
      transitMarkers.set(id, {
        id,
        kind,
        mesh,
        bodyMaterial: conveyorMaterials.bedding,
        capMaterial: null,
        tile,
        ownsBodyMaterial: false,
        terrainBed: grounding.terrainBed,
        contactPad: grounding.contactPad,
        label: null,
        previewLine: null,
      });
      return;
    }
    const body = AUTOMATION_BODIES.gardenSlide;
    const mesh = buildAutomationMesh(scene, `terrarium.transit.${kind}.${id}`, body);
    const bodyMaterial = kind === 'gardenSlide'
      ? createWoodBodyMaterial(scene, `terrarium.transit.${kind}.${id}.body.mat`, GARDEN_SLIDE_BODY_COLOR.clone())
      : createPaintedMetalMaterial(scene, `terrarium.transit.${kind}.${id}.body.mat`, SITE_FALLBACK_COLOR.gardenSlide.clone());
    bodyMaterial.alpha = 1;
    mesh.material = bodyMaterial;
    let capMaterial: PBRMetallicRoughnessMaterial | null = null;
    if (kind === 'gardenSlide') {
      buildGardenSlideRig(scene, mesh, `terrarium.transit.${kind}.${id}`, slideMaterials);
    } else {
      const cap = attachStandee(
        scene,
        mesh,
        `terrarium.transit.${kind}.${id}.cap`,
        'structure.gardenSlide.base',
        SITE_FALLBACK_COLOR.gardenSlide,
        SITE_CAP_WIDTH,
        SITE_CAP_HEIGHT,
        halfHeight(body),
      );
      cap.material.alpha = 1;
      capMaterial = cap.material;
    }
    mesh.isPickable = false;
    const world = tileToWorld(tile);
    mesh.position.set(world.x, body.centreY, world.z);
    mesh.metadata = { kind: 'transit', transitKind: kind, artifactId: id, tile };
    const grounding = buildTransitGrounding(
      scene,
      `terrarium.transit.${kind}.${id}`,
      body,
      conveyorMaterials.bedding,
      contactPadMaterial,
    );
    grounding.terrainBed.position.set(world.x, TRANSIT_GROUNDING.beddingHeight / 2, world.z);
    grounding.contactPad.position.set(world.x, TRANSIT_GROUNDING.contactY, world.z);
    shadowGenerator.addShadowCaster(mesh);
    shadowGenerator.addShadowCaster(grounding.terrainBed);
    const marker: TransitMarker = {
      id,
      kind,
      mesh,
      bodyMaterial,
      capMaterial,
      tile,
      ownsBodyMaterial: true,
      terrainBed: grounding.terrainBed,
      contactPad: grounding.contactPad,
      label: null,
      previewLine: null,
    };
    transitMarkers.set(id, marker);
    if (slideState) updateTransitPreview(marker, slideState);
  };

  const removeTransitMarker = (id: string): void => {
    const marker = transitMarkers.get(id);
    if (!marker) return;
    marker.previewLine?.dispose();
    marker.label?.mesh.dispose();
    marker.label?.material.dispose();
    marker.label?.texture.dispose();
    marker.terrainBed.dispose();
    marker.contactPad.dispose();
    marker.mesh.dispose();
    if (marker.ownsBodyMaterial) marker.bodyMaterial.dispose();
    marker.capMaterial?.dispose();
    transitMarkers.delete(id);
  };

  const syncTransitMarkers = (
    slides: TransitSlideVisualState[] | undefined,
    conveyors: Array<{ id: string; tile: TileCoord }> | undefined,
  ): void => {
    knownSlides = slides ?? [];
    knownConveyors = conveyors ?? [];
    const next = new Map<string, { kind: PricedTransitKind; tile: TileCoord }>();
    for (const slide of slides ?? []) next.set(slide.id, { kind: 'gardenSlide', tile: slide.tile });
    for (const conveyor of conveyors ?? []) next.set(conveyor.id, { kind: 'sproutConveyor', tile: conveyor.tile });
    for (const id of transitMarkers.keys()) if (!next.has(id)) removeTransitMarker(id);
    for (const [id, marker] of next) {
      addTransitMarker(id, marker.kind, marker.tile, slides?.find((slide) => slide.id === id));
    }
    refreshConveyorVisuals();
  };

  // Shared across every automation site (there are only three, but this is the
  // "shared PBR materials, not one texture set per object" rule and it keeps
  // the belt's four extra sub-meshes per site to two extra materials TOTAL).
  // Deliberately two different families so the belt is not one uniform
  // surface: a warm wood-grain deck (rougher, streaked bump) against painted
  // satin metal rails/rollers/brackets, which is what gives the machine
  // material contrast at gameplay distance rather than one flat paint job.
  const deckMaterial = createWoodBodyMaterial(scene, 'terrarium.automation.belt.deck.mat', new Color3(0.42, 0.31, 0.22));
  const frameMaterial = createPaintedMetalMaterial(scene, 'terrarium.automation.belt.frame.mat', new Color3(0.89, 0.84, 0.72));
  // A small constant lift on both belt surfaces. The default backend supplies
  // no environment/IBL term (see src/render/environment.ts, and the metallic
  // note in pbrMaterials.ts's PAINTED_METAL_RECIPE), so a surface facing away
  // from the key light has literally nothing filling it — the rails and rollers
  // measured as near-black in browser QA at the default camera despite a 0.89
  // paint tint. This is the stylised stand-in for that missing bounce, kept
  // deliberately low so it lifts the shaded side without flattening the
  // light-to-shade rolloff the bevels exist to produce.
  frameMaterial.emissiveColor = new Color3(0.16, 0.15, 0.13);
  deckMaterial.emissiveColor = new Color3(0.07, 0.055, 0.04);
  // Deliberately NOT a textured family material: this is an occlusion term, not
  // a surface. Fully rough and near-black so it contributes no specular sheen
  // of its own under the key light — it only darkens what is already there.
  const contactPadMaterial = new PBRMetallicRoughnessMaterial('terrarium.automation.contact.mat', scene);
  contactPadMaterial.baseColor = new Color3(0.05, 0.04, 0.04);
  contactPadMaterial.metallic = 0;
  contactPadMaterial.roughness = 1;
  contactPadMaterial.alpha = 0.34;
  // Two-sided on purpose. The pad's disc is hand-built here rather than via
  // geometry.ts's `discVertexData`, so its winding is not guaranteed to match
  // the rest of the scene's convention — and a flat ground decal gains nothing
  // from culling. This removes the entire "invisible from above because the
  // triangles wound the other way" failure class.
  contactPadMaterial.backFaceCulling = false;

  // 2026-08-01 (manual placement, GameRules §9.8): there is no fixed default
  // site per automationId anymore — the player chooses where each structure
  // stands. Every mesh starts DISABLED at the world origin; markBuilt below
  // repositions and enables it the moment a real siteTile arrives (from
  // `automation:built` or a restored save's `automationSites` snapshot).
  // `AUTOMATION_SITE_TILES` still exists purely as the list of valid
  // AutomationIds to iterate here (and as the historical-default fallback
  // src/persistence/save.ts's v4->v5 migration uses for pre-existing saves).
  for (const id of Object.keys(AUTOMATION_SITE_TILES) as AutomationId[]) {
    const body = AUTOMATION_BODIES[id];
    const mesh = buildAutomationMesh(scene, `terrarium.automation.${id}`, body);
    mesh.position.set(0, body.centreY, 0);
    mesh.isPickable = false;
    mesh.setEnabled(false);
    const bodyMaterial = id === 'gardenSlide'
      ? createWoodBodyMaterial(scene, `terrarium.automation.${id}.body.mat`, GARDEN_SLIDE_BODY_COLOR.clone())
      : createPaintedMetalMaterial(scene, `terrarium.automation.${id}.body.mat`, SITE_FALLBACK_COLOR[id]);
    bodyMaterial.alpha = 1; // opaque once built — no more translucent "not yet built" marker at a fixed default
    mesh.material = bodyMaterial;

    let capMaterial: PBRMetallicRoughnessMaterial | null = null;
    if (id === 'gardenSlide') {
      buildGardenSlideRig(scene, mesh, `terrarium.automation.${id}`, slideMaterials);
    } else {
      const cap = attachStandee(
        scene,
        mesh,
        `terrarium.automation.${id}.cap`,
        `structure.${id}.base`,
        SITE_FALLBACK_COLOR[id],
        SITE_CAP_WIDTH,
        SITE_CAP_HEIGHT,
        halfHeight(body),
      );
      cap.material.alpha = 1;
      capMaterial = cap.material;
    }

    const belt = buildBeltRig(scene, mesh, `terrarium.automation.${id}`, deckMaterial, frameMaterial);
    if (id === 'gardenSlide') belt.root.setEnabled(false);
    const contactPad = buildContactPad(
      scene,
      `terrarium.automation.${id}.contact`,
      footprintRadius(body) + TRANSIT_GROUNDING.contactMargin,
      contactPadMaterial,
    );

    // Parcels ride ON the deck now, instead of floating a fixed distance above
    // the plinth with nothing under them.
    const beadLocalY = AUTOMATION_BELT.topLocalY + BEAD_DIAMETER / 2 + AUTOMATION_BELT.loadClearance;

    // The procession of parcels on the belt. All parented to the body so the
    // working rock carries them along, and all sharing one material (their
    // individual scale, not their colour, is what animates). Local X/Z are set
    // per frame to a point in front of the standee card.
    //
    // Cloned tint: createPaintedMetalMaterial assigns the Color3 it is handed
    // straight onto `baseColor`, so passing the shared module constant would
    // hand two materials the same mutable instance.
    const beadMaterial = createPaintedMetalMaterial(scene, `terrarium.automation.${id}.bead.mat`, CARRY_GLOW.clone());
    beadMaterial.emissiveColor = CARRY_GLOW.scale(0.6);
    const beads: Mesh[] = [];
    for (let k = 0; k < BEAD_COUNT; k += 1) {
      const bead = MeshBuilder.CreateSphere(`terrarium.automation.${id}.bead.${k}`, { diameter: BEAD_DIAMETER, segments: 8 }, scene);
      bead.parent = mesh;
      bead.isPickable = false;
      bead.material = beadMaterial;
      bead.setEnabled(false);
      beads.push(bead);
    }

    // The parked parcel shown while blocked. A separate mesh from the belt
    // procession so neither state has to teleport a shared object into the
    // other's place — each simply scales in and out on its own blend weight.
    const waitBead = MeshBuilder.CreateSphere(`terrarium.automation.${id}.wait`, { diameter: BEAD_DIAMETER, segments: 8 }, scene);
    waitBead.parent = mesh;
    waitBead.isPickable = false;
    if (id === 'gardenSlide') setSlidePathPosition(waitBead, GARDEN_SLIDE.path, 0.88);
    else {
      waitBead.position.set(
        LATERAL_X * (BEAD_TRAVEL * 0.5) + VIEWER_X * BEAD_FORWARD,
        beadLocalY,
        LATERAL_Z * (BEAD_TRAVEL * 0.5) + VIEWER_Z * BEAD_FORWARD,
      );
    }
    waitBead.setEnabled(false);
    const waitMaterial = createPaintedMetalMaterial(scene, `terrarium.automation.${id}.wait.mat`, BLOCKED_GLOW.clone());
    waitMaterial.emissiveColor = BLOCKED_GLOW.scale(0.6);
    waitBead.material = waitMaterial;

    sites[id] = {
      id,
      mesh,
      capMaterial,
      bodyMaterial,
      built: false,
      siteTile: null,
      baseY: body.centreY,
      targetHabitatId: null,
      carrying: false,
      destinationFull: false,
      passMs: DEFAULT_BEAD_PASS_MS,
      throughput: 0,
      // Staggered per site so three machines standing near each other are not
      // visibly locked in lockstep.
      beltPhase: (Object.keys(sites).length * 0.37) % 1,
      beltRate: BELT_IDLE_RATE,
      belt,
      contactPad,
      carryBlend: 0,
      blockBlend: 0,
      beads,
      beadMaterial,
      beadsVisible: false,
      waitBead,
      waitMaterial,
      waitVisible: false,
      beadLocalY,
      travelPath: id === 'gardenSlide' ? GARDEN_SLIDE.path : null,
    };
  }

  // --- Colour Gate lane lamps -------------------------------------------------
  // Built once, on the Gate's own plinth, and simply left dark until a rule
  // arrives. `automation:colourGateRuleChanged` fires when the Gate is built
  // (with its default rule) and on every player change, and `save:loaded`
  // carries the restored rule — so these are correct in all three cases.
  const gateSite = sites.colourGate;
  const laneLamps = {} as Record<(typeof COLOUR_GATE_LANE_LIST)[number], { mesh: Mesh; material: PBRMetallicRoughnessMaterial }>;
  if (gateSite) {
    for (const lane of COLOUR_GATE_LANE_LIST) {
      const sign = lane === 'west' ? -1 : 1;
      const mesh = MeshBuilder.CreateSphere(
        `terrarium.automation.colourGate.lane.${lane}`,
        { diameter: LANE_LAMP_DIAMETER, segments: 10 },
        scene,
      );
      mesh.parent = gateSite.mesh;
      mesh.isPickable = false;
      mesh.position.set(
        sign * LANE_LAMP_OFFSET + VIEWER_X * LANE_LAMP_FORWARD,
        halfHeight(AUTOMATION_BODIES.colourGate) + LANE_LAMP_RISE,
        VIEWER_Z * LANE_LAMP_FORWARD,
      );
      const material = createPaintedMetalMaterial(scene, `terrarium.automation.colourGate.lane.${lane}.mat`, LANE_LAMP_UNSET.clone());
      material.emissiveColor = LANE_LAMP_UNSET.scale(0.15);
      mesh.material = material;
      mesh.scaling.setAll(0.7); // dim + small until a kind is assigned
      laneLamps[lane] = { mesh, material };
    }
  }

  // Habitats known to be at capacity. Kept per INSTANCE (Phase 2) rather than
  // resolved eagerly onto each site because `habitat:full` routinely fires
  // BEFORE the Garden Slide exists: the Slide unlocks at 20 correct manual
  // placements, which at base capacity means a habitat has already filled and
  // reported it. Seeded on load from `save:loaded`, since `habitat:full`
  // never replays.
  const fullHabitatInstances = new Set<string>();
  // Every instance of each kind, so "is this kind blocked by fullness" can be
  // derived as "every instance of it is full" — a player-built second Ember
  // Nook with room still takes deliveries even while the original is full.
  // Fed from the seeded originals + `save:loaded.habitatInstances` +
  // `habitat:built`. The originals MUST be seeded here (mirroring
  // createHabitatManager in habitats.ts) or `kindBlocked` returns false for
  // every kind on a FRESH load — no `save:loaded` and no `habitat:built` for
  // seeded instances means the map stays empty, `destinationFull` never gets
  // set from `habitat:full`, and the Slide can never show its blocked wait
  // bead even with a genuinely full destination.
  const habitatInstancesByKind = new Map<HabitatId, Set<string>>();
  const registerHabitatInstance = (habitatId: HabitatId, instanceId: string): void => {
    let instances = habitatInstancesByKind.get(habitatId);
    if (!instances) {
      instances = new Set();
      habitatInstancesByKind.set(habitatId, instances);
    }
    instances.add(instanceId);
  };
  for (const habitatId of Object.keys(HABITAT_TILES) as HabitatId[]) {
    registerHabitatInstance(habitatId, `${habitatId}-1`);
  }
  const kindBlocked = (habitatId: HabitatId): boolean => {
    const instances = habitatInstancesByKind.get(habitatId);
    if (!instances || instances.size === 0) return false;
    for (const id of instances) if (!fullHabitatInstances.has(id)) return false;
    return true;
  };

  /** The Gate's rule as last announced, so a lamp can be re-evaluated when a
   * home fills or frees up without waiting for the rule itself to change. */
  let gateLanes: { west: SproutTypeId | null; east: SproutTypeId | null } = { west: null, east: null };

  /** The Mood Bell's rule as last announced — mirrors `gateLanes` above,
   * simpler shape (one mood, not a 2-lane map). No lamp system in v1: the
   * Bell has no per-lane visual, only `matchesSprout`'s hover-validity check
   * reads this. */
  let moodBellRule: MoodId = 'sunny';

  /**
   * Lights each lane lamp for what that lane is actually DOING right now, in
   * three readable states — GameRules §9.4 wants the active rule visible, and
   * §9.7 wants a blockage shown through world state rather than left to a panel:
   *
   *   quiet   — no kind assigned: small and unlit.
   *   waiting — a kind is assigned but nobody is going that way, because the
   *             lane's home is full or because that home is not a home for that
   *             kind at all. Warm amber (never red: §11), full size.
   *   sending — the lane is carrying somebody: lit in that kind's own colour.
   *
   * Size and brightness carry the distinction as well as hue, so the three
   * states stay apart without colour vision.
   */
  const refreshLaneLamps = (): void => {
    for (const lane of COLOUR_GATE_LANE_LIST) {
      const lamp = laneLamps[lane];
      if (!lamp) continue;
      const assigned = gateLanes[lane];
      const home = COLOUR_GATE_LANE_HABITATS[lane];
      const welcome = assigned ? SPROUT_TYPES[assigned]?.habitatId === home : false;
      const waiting = assigned !== null && (!welcome || kindBlocked(home));
      const colour = waiting ? BLOCKED_GLOW.clone() : laneColour(assigned);
      lamp.material.baseColor.copyFrom(colour);
      lamp.material.emissiveColor.copyFrom(colour.scale(assigned ? 0.75 : 0.15));
      lamp.mesh.scaling.setAll(assigned ? 1 : 0.7);
    }
  };

  const applyGateRule = (lanes: { west: SproutTypeId | null; east: SproutTypeId | null }): void => {
    gateLanes = { ...lanes };
    refreshLaneLamps();
  };

  const markBuilt = (id: AutomationId, siteTile: TileCoord | null, targetHabitatId: HabitatId | null): void => {
    const site = sites[id];
    if (!site) return;
    if (targetHabitatId) {
      site.targetHabitatId = targetHabitatId;
      site.destinationFull = kindBlocked(targetHabitatId);
    }
    if (site.built) return;
    // siteTile is only absent from the sprout:transportStarted fallback path
    // below (a ride implies the structure exists, but the event carries no
    // placement info) — if we already missed the real automation:built,
    // there is nothing to reposition to, so this call becomes a no-op until
    // a real siteTile eventually arrives.
    if (!siteTile) return;
    site.siteTile = siteTile;
    const world = tileToWorld(siteTile);
    site.mesh.position.set(world.x, site.baseY, world.z);
    site.mesh.setEnabled(true);
    // Ground contact: the pad is NOT parented to the plinth, because the plinth
    // bobs and rocks — a parented pad would sink through the ground on the down
    // stroke and tilt with the machine, which is exactly the "floating" read it
    // exists to prevent.
    site.contactPad.position.set(world.x, TRANSIT_GROUNDING.contactY, world.z);
    site.contactPad.setEnabled(true);
    site.built = true;
    shadowGenerator.addShadowCaster(site.mesh); // includes the belt rig's descendants
  };

  const unsubscribers = [
    bus.subscribe('automation:built', (e) => markBuilt(e.automationId, e.siteTile, e.targetHabitatId ?? null)),

    bus.subscribe('transit:slideBuilt', (e) => syncTransitMarkers([...knownSlides.filter((slide) => slide.id !== e.slide.id), e.slide], knownConveyors)),
    bus.subscribe('transit:slideConfigured', (e) => syncTransitMarkers([...knownSlides.filter((slide) => slide.id !== e.slide.id), e.slide], knownConveyors)),
    bus.subscribe('transit:conveyorBuilt', (e) => syncTransitMarkers(knownSlides, [...knownConveyors.filter((conveyor) => conveyor.id !== e.conveyor.id), { id: e.conveyor.id, tile: e.conveyor.tile }])),
    bus.subscribe('transit:artifactMoved', (e) => syncTransitMarkers(
      e.artifactKind === 'gardenSlide'
        ? knownSlides.map((slide) => slide.id === e.artifactId ? { ...slide, tile: e.tile } : slide)
        : knownSlides,
      e.artifactKind === 'sproutConveyor'
        ? knownConveyors.map((conveyor) => conveyor.id === e.artifactId ? { ...conveyor, tile: e.tile } : conveyor)
        : knownConveyors,
    )),
    bus.subscribe('transit:artifactRemoved', (e) => syncTransitMarkers(
      e.artifactKind === 'gardenSlide' ? knownSlides.filter((slide) => slide.id !== e.artifactId) : knownSlides,
      e.artifactKind === 'sproutConveyor' ? knownConveyors.filter((conveyor) => conveyor.id !== e.artifactId) : knownConveyors,
    )),

    bus.subscribe('automation:colourGateRuleChanged', (e) => applyGateRule(e.lanes)),

    bus.subscribe('automation:moodBellRuleChanged', (e) => {
      moodBellRule = e.mood;
    }),

    // A restored save replays no `automation:built` — runtime.ts emits only
    // `save:loaded` with a snapshot — so without this an already-built Slide
    // came back as a disabled, unplaced mesh after every reload, and none of
    // the activity states above would ever have shown. Only automations that
    // are actually PLACED appear in `automationSites` (2026-08-01, manual
    // placement) — an unlocked-but-unplaced automation has nothing to mark
    // built yet.
    bus.subscribe('save:loaded', (e) => {
      syncTransitMarkers((e.snapshot.slides ?? []).map((slide) => ({
        id: slide.id,
        tile: slide.tile,
        acceptedKind: slide.acceptedKind ?? 'any',
        destination: slide.destination ?? 'sunflowerMeadow',
        enabled: slide.enabled ?? true,
      })), e.snapshot.conveyors);
      for (const instanceId of e.snapshot.fullHabitatInstances ?? []) fullHabitatInstances.add(instanceId);
      for (const instance of e.snapshot.habitatInstances ?? []) registerHabitatInstance(instance.habitatId, instance.id);
      const targets = e.snapshot.automationTargets ?? {};
      const restoredSites = e.snapshot.automationSites ?? {};
      // Targets first, then fullHabitatInstances above, so a garden that was
      // jammed when the player left still reads as jammed when they return.
      for (const id of Object.keys(restoredSites) as AutomationId[]) {
        const siteTile = restoredSites[id];
        if (siteTile) markBuilt(id, siteTile, targets[id] ?? null);
      }
      if (e.snapshot.colourGateLanes) applyGateRule(e.snapshot.colourGateLanes);
      if (e.snapshot.moodBellRule) moodBellRule = e.snapshot.moodBellRule;
    }),

    bus.subscribe('sprout:transportStarted', (e) => {
      const site = sites[e.automationId];
      if (!site) return;
      // A ride implies the structure is built even if we missed the
      // automation:built event — but we also missed its siteTile, so this is
      // a no-op reposition-wise (see markBuilt's own guard); it only still
      // matters for inferring targetHabitatId. Only the Slide gets one
      // inferred here: its destination is fixed, so `habitatAtTile(e.toTile)`
      // is a safe stand-in for the `automation:built.targetHabitatId` we
      // might have missed. The Mood Bell's destination varies per ride —
      // inferring one from a single past delivery would wrongly pin its
      // `destinationFull` tracking to whichever habitat that one ride
      // happened to visit (see this module's own "no dedicated blocked
      // visual for the Bell in v1" note near SITE_FALLBACK_COLOR/markBuilt),
      // so it stays null here.
      markBuilt(e.automationId, null, e.automationId === 'gardenSlide' ? habitatAtTile(e.toTile) : null);
      site.carrying = true;
      // Pace straight from the sim's own ride duration, so the Garden Slide
      // Speed upgrade is visible on the machine as well as on its passenger.
      const rideMs = Number.isFinite(e.durationMs) && e.durationMs > 0 ? e.durationMs : DEFAULT_BEAD_PASS_MS * BEAD_PASSES_PER_RIDE;
      site.passMs = Math.min(BEAD_PASS_MAX_MS, Math.max(BEAD_PASS_MIN_MS, rideMs / BEAD_PASSES_PER_RIDE));
    }),

    bus.subscribe('sprout:transportCompleted', (e) => {
      const site = sites[e.automationId];
      if (!site) return;
      site.carrying = false;
      site.throughput = Math.min(1, site.throughput + THROUGHPUT_PER_DELIVERY);
    }),

    // Congestion, straight from the sim's own notion of it: `habitat:full`
    // fires on the exact tick a habitat reaches capacity, which is the same
    // condition automationSystem checks before declining to dispatch.
    bus.subscribe('habitat:full', (e) => {
      fullHabitatInstances.add(e.habitatInstanceId);
      for (const site of Object.values(sites)) {
        if (site.targetHabitatId === e.habitatId) site.destinationFull = kindBlocked(e.habitatId);
      }
      // The Colour Gate has no single `targetHabitatId` — it routes per lane, so
      // its congestion lives on the lamps rather than on the structure.
      refreshLaneLamps();
    }),

    // A brand-new habitat starts empty, so its kind is never blocked by
    // fullness the moment one is built (Phase 2 — even if another copy is
    // full, the new one takes deliveries).
    bus.subscribe('habitat:built', (e) => {
      registerHabitatInstance(e.habitatId, e.habitatInstanceId);
      for (const site of Object.values(sites)) {
        if (site.targetHabitatId === e.habitatId) site.destinationFull = kindBlocked(e.habitatId);
      }
      refreshLaneLamps();
    }),

    // More room means the queue can move again. Phase 1 habitats never lose a
    // settled Sprout, so a capacity upgrade is the only way out of "full".
    bus.subscribe('upgrade:purchased', (e) => {
      if (e.upgradeId !== 'habitatCapacity') return;
      fullHabitatInstances.clear();
      for (const site of Object.values(sites)) site.destinationFull = false;
      refreshLaneLamps();
    }),
  ];

  // ---------------------------------------------------------------------------
  // Activity animation
  // ---------------------------------------------------------------------------
  // Driven from this module's own render observer rather than a `update(motion)`
  // method called by src/render/index.ts, so the whole feature stays inside this
  // file. Reduced motion is tracked as a single scalar (not a MotionConfig
  // object) specifically so nothing is allocated per frame.
  //
  // Everything below is CONTINUOUS by construction, which is the whole point:
  //
  //   * the belt runs off an accumulated phase advanced by frame delta, so it
  //     never jumps when the ride speed changes (a new upgrade level) and never
  //     restarts when a new Sprout boards;
  //   * BEAD_COUNT parcels are evenly spaced in that phase and scale to zero at
  //     both ends of their pass, so the procession has no visible loop point;
  //   * carrying/blocked are eased weights rather than branches, so the belt
  //     spins down and the body settles instead of snapping between states.
  //
  // Reduced motion (`ambient === 0`) freezes the phase and holds the beads at a
  // fixed, still, readable arrangement — damped, not merely slowed.
  let ambient = prefersReducedMotion() ? 0 : 1;
  const stopReducedMotionWatch = watchReducedMotion((reduced) => {
    ambient = reduced ? 0 : 1;
  });

  let lastFrameMs = performance.now();
  const activityObserver = scene.onBeforeRenderObservable.add(() => {
    const now = performance.now();
    // Clamped so a backgrounded tab resuming can't fling the belt forward.
    const deltaMs = Math.min(120, Math.max(0, now - lastFrameMs));
    lastFrameMs = now;

    for (const id of Object.keys(sites) as AutomationId[]) {
      const site = sites[id];
      if (!site.built) continue;

      if (site.throughput > 0) {
        site.throughput = site.throughput * Math.exp(-deltaMs / THROUGHPUT_DECAY_MS);
        if (site.throughput < 0.001) site.throughput = 0;
      }

      const activity = activityOf(site);
      // Frame-rate-independent exponential approach toward each state's weight.
      const blendStep = 1 - Math.exp(-deltaMs / ACTIVITY_BLEND_MS);
      site.carryBlend += ((activity === 'carrying' ? 1 : 0) - site.carryBlend) * blendStep;
      site.blockBlend += ((activity === 'blocked' ? 1 : 0) - site.blockBlend) * blendStep;
      if (site.carryBlend < 0.0005) site.carryBlend = 0;
      if (site.blockBlend < 0.0005) site.blockBlend = 0;
      const idleBlend = Math.max(0, 1 - site.carryBlend - site.blockBlend);

      // --- belt speed --------------------------------------------------------
      // The belt never stops and never jumps. Its RATE is eased between a calm
      // idle creep and the sim's own ride pace, so:
      //   * a delivery ending no longer dead-stops the machine (the old
      //     `carryBlend > 0` gate did exactly that between every ride, which is
      //     the start/stop hitch the report described);
      //   * a new ride arriving with a different `passMs` (a speed upgrade, or
      //     the Colour Gate's second dispatch leg) pulls the belt up to speed
      //     instead of stepping its velocity mid-stride.
      const targetRate = BELT_IDLE_RATE + (1 / site.passMs - BELT_IDLE_RATE) * site.carryBlend;
      site.beltRate += (targetRate - site.beltRate) * (1 - Math.exp(-deltaMs / BELT_RATE_BLEND_MS));
      if (ambient > 0) {
        site.beltPhase += deltaMs * site.beltRate;
        if (site.beltPhase >= 1) site.beltPhase -= Math.floor(site.beltPhase);
      }

      // The end rollers turn with the belt — the one cue that keeps reading as
      // "this machine is running" once the parcels have gone. Continuous across
      // the phase wrap because a full turn is 2*PI.
      for (const roller of site.belt.rollers) {
        roller.rotation.y = ambient > 0 ? site.beltPhase * TWO_PI : 0;
      }

      // --- belt procession ---------------------------------------------------
      const beadsWanted = site.carryBlend > 0.001;
      if (beadsWanted !== site.beadsVisible) {
        site.beadsVisible = beadsWanted;
        for (const bead of site.beads) bead.setEnabled(beadsWanted);
      }
      if (beadsWanted) {
        for (let k = 0; k < site.beads.length; k += 1) {
          // Evenly spaced phases: as bead k shrinks out at the outfeed, bead
          // k+1 is already a third of the way along.
          let phase = site.beltPhase + k / site.beads.length;
          if (phase >= 1) phase -= 1;
          const held = ambient > 0 ? phase : (k + 0.5) / site.beads.length; // still but still legible
          const lateral = (held - 0.5) * BEAD_TRAVEL;
          // Still exactly 0 at both ends, so a parcel is invisible at the
          // moment it wraps — no pop, no snap-back — but now via a short
          // smoothstep window at each end rather than a full-pass sine, so the
          // middle of the run holds a steady size and reads as cargo being
          // CARRIED rather than as a bead pulsing in place.
          const edge = Math.min(held, 1 - held) / BEAD_FADE_WINDOW;
          const swell = smoothstep(edge) * site.carryBlend;
          if (site.travelPath) setSlidePathPosition(site.beads[k], site.travelPath, held);
          else {
            site.beads[k].position.set(
              LATERAL_X * lateral + VIEWER_X * BEAD_FORWARD,
              site.beadLocalY,
              LATERAL_Z * lateral + VIEWER_Z * BEAD_FORWARD,
            );
          }
          site.beads[k].scaling.set(swell, swell, swell);
        }
      }

      // --- parked parcel (blocked) ------------------------------------------
      const waitWanted = site.blockBlend > 0.001;
      if (waitWanted !== site.waitVisible) {
        site.waitVisible = waitWanted;
        site.waitBead.setEnabled(waitWanted);
      }
      const blockPulse = ambient > 0 ? 0.5 + 0.5 * Math.sin(now / 900) : 0.5;
      if (waitWanted) {
        const waitScale = site.blockBlend * (0.86 + 0.08 * blockPulse);
        site.waitBead.scaling.set(waitScale, waitScale, waitScale);
        const waitK = 0.55 + 0.35 * blockPulse;
        site.waitMaterial.emissiveColor.set(BLOCKED_GLOW.r * waitK, BLOCKED_GLOW.g * waitK, BLOCKED_GLOW.b * waitK);
      }

      // --- body motion, all three states summed by weight ---------------------
      const rock = ambient > 0 ? Math.sin(site.beltPhase * Math.PI * 2) : 0;
      const nod = ambient > 0 ? Math.sin(now / 900) : 0;
      const breathe = ambient > 0 ? Math.sin(now / 1400) : 0;
      site.mesh.position.y =
        site.baseY + rock * 0.022 * site.carryBlend + breathe * 0.009 * idleBlend;
      site.mesh.rotation.z = rock * 0.04 * site.carryBlend;
      site.mesh.rotation.x = nod * 0.022 * site.blockBlend;

      // Emissive is likewise a weighted sum, so the warm working glow fades
      // into the amber waiting glow (or back to the resting tint) rather than
      // switching between them.
      const tint = SITE_FALLBACK_COLOR[id];
      const carryK = 0.16 + 0.2 * site.throughput + 0.07 * rock;
      const blockK = 0.12 + 0.1 * blockPulse;
      const idleK = 0.05 + 0.06 * site.throughput + 0.02 * breathe;
      site.bodyMaterial.emissiveColor.set(
        CARRY_GLOW.r * carryK * site.carryBlend + BLOCKED_GLOW.r * blockK * site.blockBlend + tint.r * idleK * idleBlend,
        CARRY_GLOW.g * carryK * site.carryBlend + BLOCKED_GLOW.g * blockK * site.blockBlend + tint.g * idleK * idleBlend,
        CARRY_GLOW.b * carryK * site.carryBlend + BLOCKED_GLOW.b * blockK * site.blockBlend + tint.b * idleK * idleBlend,
      );
    }
  });

  let previewMesh: Mesh | undefined;
  let previewBodyMaterial: PBRMetallicRoughnessMaterial | undefined;
  let previewCap: FlatCap | undefined;
  let previewSlideMaterials: PBRMetallicRoughnessMaterial[] = [];
  let previewConveyorMaterials: PBRMetallicRoughnessMaterial[] = [];
  let previewCentreY = AUTOMATION_PREVIEW_BODY.centreY;
  let previewKey: string | undefined;

  const clearPreview = (): void => {
    previewMesh?.dispose(); // recursively disposes the cap child mesh too
    if (previewBodyMaterial && !previewConveyorMaterials.includes(previewBodyMaterial)) previewBodyMaterial.dispose();
    previewCap?.material.dispose();
    for (const material of previewSlideMaterials) material.dispose();
    for (const material of previewConveyorMaterials) material.dispose();
    previewMesh = undefined;
    previewBodyMaterial = undefined;
    previewCap = undefined;
    previewSlideMaterials = [];
    previewConveyorMaterials = [];
    previewCentreY = AUTOMATION_PREVIEW_BODY.centreY;
    previewKey = undefined;
  };

  const ensurePreview = (key: string, artId: AutomationId, transitKind?: PricedTransitKind): void => {
    if (previewMesh && previewBodyMaterial && previewKey === key) return;
    clearPreview();
    if (transitKind === 'sproutConveyor') {
      const materials = createConveyorMaterials(scene, 'terrarium.automation.preview.conveyor');
      previewConveyorMaterials = Object.values(materials);
      for (const material of previewConveyorMaterials) material.alpha = 0.55;
      const mesh = buildConveyorVisual(
        scene,
        'terrarium.automation.preview.conveyor',
        { connections: [0, 1, 2, 3], flowDirection: 2, connected: true },
        materials,
      );
      previewMesh = mesh;
      previewBodyMaterial = materials.bedding;
      previewCentreY = SPROUT_CONVEYOR_BODY.centreY;
      previewKey = key;
      return;
    }
    const mesh = buildAutomationMesh(scene, 'terrarium.automation.preview', AUTOMATION_PREVIEW_BODY);
    mesh.isPickable = false;
    const bodyMaterial = artId === 'gardenSlide'
      ? createWoodBodyMaterial(scene, 'terrarium.automation.preview.body.mat', GARDEN_SLIDE_BODY_COLOR.clone())
      : createPaintedMetalMaterial(scene, 'terrarium.automation.preview.body.mat', SITE_FALLBACK_COLOR[artId].clone());
    bodyMaterial.alpha = 0.55;
    mesh.material = bodyMaterial;
    if (artId === 'gardenSlide') {
      const materials: GardenSlideMaterials = {
        channel: createWoodBodyMaterial(scene, 'terrarium.automation.preview.slide.channel.mat', GARDEN_SLIDE_CHANNEL_COLOR.clone()),
        inset: createWoodBodyMaterial(scene, 'terrarium.automation.preview.slide.inset.mat', GARDEN_SLIDE_INSET_COLOR.clone()),
        frame: createWoodBodyMaterial(scene, 'terrarium.automation.preview.slide.frame.mat', GARDEN_SLIDE_FRAME_COLOR.clone()),
        support: createStoneBodyMaterial(scene, 'terrarium.automation.preview.slide.support.mat', GARDEN_SLIDE_SUPPORT_COLOR.clone()),
      };
      previewSlideMaterials = Object.values(materials);
      for (const material of previewSlideMaterials) material.alpha = 0.55;
      buildGardenSlideRig(scene, mesh, 'terrarium.automation.preview', materials);
    } else {
      const cap = attachStandee(
        scene,
        mesh,
        'terrarium.automation.preview.cap',
        `structure.${artId}.base`,
        SITE_FALLBACK_COLOR[artId],
        PREVIEW_CAP_WIDTH,
        PREVIEW_CAP_HEIGHT,
        halfHeight(AUTOMATION_PREVIEW_BODY),
      );
      cap.material.alpha = 0.55;
      previewCap = cap;
    }
    previewMesh = mesh;
    previewBodyMaterial = bodyMaterial;
    previewCentreY = AUTOMATION_PREVIEW_BODY.centreY;
    previewKey = key;
  };

  const updatePreview = (tile: TileCoord, status: 'valid' | 'invalid' | 'blocked'): void => {
    if (!previewMesh || !previewBodyMaterial) return;
    const world = tileToWorld(tile);
    previewMesh.position.set(world.x, previewCentreY, world.z);
    const tint = status === 'valid' ? PREVIEW_VALID : status === 'blocked' ? PREVIEW_BLOCKED : PREVIEW_INVALID;
    previewBodyMaterial.emissiveColor.copyFrom(tint);
    previewCap?.material.emissiveColor.copyFrom(tint);
    for (const material of previewSlideMaterials) material.emissiveColor.copyFrom(tint);
    for (const material of previewConveyorMaterials) material.emissiveColor.copyFrom(tint);
    previewMesh.scaling.setAll(status === 'blocked' ? 1.08 : status === 'invalid' ? 0.96 : 1);
  };

  const previewAt = (automationId: AutomationId, tile: TileCoord, status: boolean | 'valid' | 'invalid' | 'blocked'): void => {
    ensurePreview(`automation:${automationId}`, automationId);
    updatePreview(tile, typeof status === 'boolean' ? (status ? 'valid' : 'invalid') : status);
  };

  const previewTransitAt = (kind: PricedTransitKind, tile: TileCoord, status: 'valid' | 'invalid' | 'blocked'): void => {
    ensurePreview(`transit:${kind}`, 'gardenSlide', kind);
    updatePreview(tile, status);
  };

  const previewTransitConfiguration = (slideId: string, configuration: TransitSlidePreviewConfig | null): void => {
    const state = knownSlides.find((slide) => slide.id === slideId);
    const marker = transitMarkers.get(slideId);
    if (!state || !marker) return;
    for (const id of previewConfigs.keys()) {
      if (id === slideId) continue;
      previewConfigs.delete(id);
      const oldMarker = transitMarkers.get(id);
      const oldState = knownSlides.find((slide) => slide.id === id);
      if (oldMarker && oldState) updateTransitPreview(oldMarker, oldState);
    }
    if (configuration) previewConfigs.set(slideId, configuration);
    else previewConfigs.delete(slideId);
    updateTransitPreview(marker, state);
  };

  const nearestBuiltWithin = (world: { x: number; z: number }, marginTiles: number): AutomationId | null => {
    let best: AutomationId | null = null;
    let bestDist = Infinity;
    for (const id of Object.keys(sites) as AutomationId[]) {
      const site = sites[id];
      if (!site.built || !site.siteTile) continue;
      const centre = tileToWorld(site.siteTile);
      const dx = world.x - centre.x;
      const dz = world.z - centre.z;
      const d = Math.hypot(dx, dz);
      const limit = footprintRadius(AUTOMATION_BODIES[id]) + marginTiles;
      if (d <= limit && d < bestDist) {
        bestDist = d;
        best = id;
      }
    }
    return best;
  };

  const nearestTransitWithin = (world: { x: number; z: number }, marginTiles: number): { id: string; kind: PricedTransitKind } | null => {
    let best: { id: string; kind: PricedTransitKind } | null = null;
    let bestDist = Infinity;
    for (const marker of transitMarkers.values()) {
      const centre = tileToWorld(marker.tile);
      const distance = Math.hypot(world.x - centre.x, world.z - centre.z);
      const limit = footprintRadius(marker.kind === 'sproutConveyor' ? SPROUT_CONVEYOR_BODY : AUTOMATION_BODIES.gardenSlide) + marginTiles;
      if (distance <= limit && distance < bestDist) {
        bestDist = distance;
        best = { id: marker.id, kind: marker.kind };
      }
    }
    return best;
  };

  const matchesSprout = (automationId: AutomationId, sproutType: SproutTypeId, mood: MoodId): boolean | null => {
    const site = sites[automationId];
    if (!site || !site.built) return null;
    if (automationId === 'gardenSlide') {
      return site.targetHabitatId ? HABITATS[site.targetHabitatId].matchSproutType === sproutType : false;
    }
    if (automationId === 'moodBell') {
      return mood === moodBellRule && moodBellDestination(sproutType) !== null;
    }
    return colourGateDestination(gateLanes, sproutType) !== null;
  };

  if (typeof MutationObserver === 'function' && typeof document !== 'undefined' && document.documentElement) {
    contrastObserver = new MutationObserver(() => {
      for (const state of knownSlides) {
        const marker = transitMarkers.get(state.id);
        if (marker?.label) {
          marker.label.drawn = '';
          updateTransitLabel(marker, state);
        }
      }
    });
    contrastObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-contrast'] });
  }

  const dispose = (): void => {
    for (const unsubscribe of unsubscribers) unsubscribe();
    scene.onBeforeRenderObservable.remove(activityObserver);
    stopReducedMotionWatch();
    contrastObserver?.disconnect();
    clearPreview();
    for (const lamp of Object.values(laneLamps)) lamp.material.dispose(); // meshes are children of the Gate, disposed below
    deckMaterial.dispose();
    frameMaterial.dispose();
    contactPadMaterial.dispose();
    for (const site of Object.values(sites)) {
      site.contactPad.dispose(); // deliberately unparented (see markBuilt), so not covered below
      site.mesh.dispose(); // recursively disposes the cap + every bead + the belt rig + lane lamp child mesh too
      site.capMaterial?.dispose();
      site.bodyMaterial.dispose();
      site.beadMaterial.dispose();
      site.waitMaterial.dispose();
    }
    for (const marker of transitMarkers.values()) {
      marker.previewLine?.dispose();
      marker.label?.mesh.dispose();
      marker.label?.material.dispose();
      marker.label?.texture.dispose();
      marker.terrainBed.dispose();
      marker.contactPad.dispose();
      marker.mesh.dispose();
      if (marker.ownsBodyMaterial) marker.bodyMaterial.dispose();
      marker.capMaterial?.dispose();
    }
    transitMarkers.clear();
    conveyorMaterials.bedding.dispose();
    conveyorMaterials.channel.dispose();
    conveyorMaterials.inset.dispose();
    conveyorMaterials.rim.dispose();
    conveyorMaterials.marker.dispose();
    slideMaterials.channel.dispose();
    slideMaterials.inset.dispose();
    slideMaterials.frame.dispose();
    slideMaterials.support.dispose();
    previewRouteMaterial.dispose();
  };

  return { previewAt, previewTransitAt, previewTransitConfiguration, clearPreview, nearestBuiltWithin, nearestTransitWithin, matchesSprout, dispose };
}

/** Whether a tile is free for an automation build (inside grid, not on the reserved nursery/habitat/path/other-site layout). Exposed for input's ghost-preview validity check. */
export function isBuildableTile(tile: TileCoord): boolean {
  return !isReservedTile(tile);
}
