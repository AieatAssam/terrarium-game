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
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { PBRMetallicRoughnessMaterial } from '@babylonjs/core/Materials/PBR/pbrMetallicRoughnessMaterial';
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
  isReservedTile,
} from './layout';
import { prefersReducedMotion, watchReducedMotion } from './motion';
import { createPaintedMetalMaterial, createWoodBodyMaterial } from './pbrMaterials';
import {
  bodyRings,
  footprintRadius,
  halfHeight,
  AUTOMATION_BELT,
  AUTOMATION_BODIES,
  AUTOMATION_PREVIEW_BODY,
  type PropBody,
} from './propDims';
import { HABITATS } from '../data/habitats';
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

/** Standee card bounding footprint for a site marker and its placement ghost. */
const SITE_CAP_WIDTH = 1.0;
const SITE_CAP_HEIGHT = 0.68;
const PREVIEW_CAP_WIDTH = 1.05;
const PREVIEW_CAP_HEIGHT = 0.71;

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
  /** Flat cap plane's material — carries C's structure illustration (see
   * flatArt.ts: a CreateBox's default UV wraps a single flat illustration
   * around all 6 faces instead of showing it top-down, which is what made
   * these markers look like plain dark cubes). */
  material: PBRMetallicRoughnessMaterial;
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
}

export interface AutomationManager {
  previewAt: (automationId: AutomationId, tile: TileCoord, valid: boolean) => void;
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

export function createAutomationManager(scene: Scene, bus: EventBus, shadowGenerator: ShadowGenerator): AutomationManager {
  const sites = {} as Record<AutomationId, SiteMarker>;

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
    const bodyMaterial = createPaintedMetalMaterial(scene, `terrarium.automation.${id}.body.mat`, SITE_FALLBACK_COLOR[id]);
    bodyMaterial.alpha = 1; // opaque once built — no more translucent "not yet built" marker at a fixed default
    mesh.material = bodyMaterial;

    // Structure illustration standing upright as a billboarded card (see
    // src/render/flatArt.ts's attachStandee), not lying flat on the box top.
    // width:height ~1.54:1 roughly matches the source art's real 400x260
    // aspect (the texture itself is also letterboxed within its canvas, so
    // this doesn't need to be exact). attachStandee is handed the plinth's TOP
    // FACE (its own half-height) and does the anchoring itself, so the card's
    // bottom edge stays just clear of that face even after the content crop
    // resizes it.
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

    const belt = buildBeltRig(scene, mesh, `terrarium.automation.${id}`, deckMaterial, frameMaterial);
    const contactPad = buildContactPad(
      scene,
      `terrarium.automation.${id}.contact`,
      footprintRadius(body) + 0.26,
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
    waitBead.position.set(
      LATERAL_X * (BEAD_TRAVEL * 0.5) + VIEWER_X * BEAD_FORWARD,
      beadLocalY,
      LATERAL_Z * (BEAD_TRAVEL * 0.5) + VIEWER_Z * BEAD_FORWARD,
    );
    waitBead.setEnabled(false);
    const waitMaterial = createPaintedMetalMaterial(scene, `terrarium.automation.${id}.wait.mat`, BLOCKED_GLOW.clone());
    waitMaterial.emissiveColor = BLOCKED_GLOW.scale(0.6);
    waitBead.material = waitMaterial;

    sites[id] = {
      id,
      mesh,
      material: cap.material,
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

  // Habitats known to be at capacity. Kept as a set rather than resolved
  // eagerly onto each site because `habitat:full` routinely fires BEFORE the
  // Garden Slide exists: the Slide unlocks at 20 correct manual placements,
  // which at base capacity means a habitat has already filled and reported it.
  // Seeded on load from `save:loaded`, since `habitat:full` never replays.
  const fullHabitats = new Set<HabitatId>();

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
      const waiting = assigned !== null && (!welcome || fullHabitats.has(home));
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
      site.destinationFull = fullHabitats.has(targetHabitatId);
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
    site.contactPad.position.set(world.x, 0.012, world.z);
    site.contactPad.setEnabled(true);
    site.built = true;
    shadowGenerator.addShadowCaster(site.mesh); // includes the belt rig's descendants
  };

  const unsubscribers = [
    bus.subscribe('automation:built', (e) => markBuilt(e.automationId, e.siteTile, e.targetHabitatId ?? null)),

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
      for (const habitatId of e.snapshot.fullHabitats ?? []) fullHabitats.add(habitatId);
      const targets = e.snapshot.automationTargets ?? {};
      const restoredSites = e.snapshot.automationSites ?? {};
      // Targets first, then fullHabitats above, so a garden that was jammed
      // when the player left still reads as jammed when they return.
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
      fullHabitats.add(e.habitatId);
      for (const site of Object.values(sites)) {
        if (site.targetHabitatId === e.habitatId) site.destinationFull = true;
      }
      // The Colour Gate has no single `targetHabitatId` — it routes per lane, so
      // its congestion lives on the lamps rather than on the structure.
      refreshLaneLamps();
    }),

    // More room means the queue can move again. Phase 1 habitats never lose a
    // settled Sprout, so a capacity upgrade is the only way out of "full".
    bus.subscribe('upgrade:purchased', (e) => {
      if (e.upgradeId !== 'habitatCapacity') return;
      fullHabitats.clear();
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
          site.beads[k].position.set(
            LATERAL_X * lateral + VIEWER_X * BEAD_FORWARD,
            site.beadLocalY,
            LATERAL_Z * lateral + VIEWER_Z * BEAD_FORWARD,
          );
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

  const previewAt = (automationId: AutomationId, tile: TileCoord, valid: boolean): void => {
    clearPreview();
    const world = tileToWorld(tile);
    const mesh = buildAutomationMesh(scene, 'terrarium.automation.preview', AUTOMATION_PREVIEW_BODY);
    mesh.position.set(world.x, AUTOMATION_PREVIEW_BODY.centreY, world.z);
    mesh.isPickable = false;
    const tint = valid ? new Color3(0.2, 0.7, 0.3) : new Color3(0.6, 0.15, 0.15);
    const bodyMaterial = createPaintedMetalMaterial(scene, 'terrarium.automation.preview.body.mat', SITE_FALLBACK_COLOR[automationId]);
    bodyMaterial.alpha = 0.55;
    bodyMaterial.emissiveColor = tint;
    mesh.material = bodyMaterial;

    const cap = attachStandee(
      scene,
      mesh,
      'terrarium.automation.preview.cap',
      `structure.${automationId}.base`,
      SITE_FALLBACK_COLOR[automationId],
      PREVIEW_CAP_WIDTH,
      PREVIEW_CAP_HEIGHT,
      halfHeight(AUTOMATION_PREVIEW_BODY),
    );
    cap.material.alpha = 0.55;
    cap.material.emissiveColor = tint;

    previewMesh = mesh;
    previewBodyMaterial = bodyMaterial;
    previewCap = cap;
  };

  const clearPreview = (): void => {
    previewMesh?.dispose(); // recursively disposes the cap child mesh too
    previewBodyMaterial?.dispose();
    previewCap?.material.dispose();
    previewMesh = undefined;
    previewBodyMaterial = undefined;
    previewCap = undefined;
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

  const dispose = (): void => {
    for (const unsubscribe of unsubscribers) unsubscribe();
    scene.onBeforeRenderObservable.remove(activityObserver);
    stopReducedMotionWatch();
    clearPreview();
    for (const lamp of Object.values(laneLamps)) lamp.material.dispose(); // meshes are children of the Gate, disposed below
    deckMaterial.dispose();
    frameMaterial.dispose();
    contactPadMaterial.dispose();
    for (const site of Object.values(sites)) {
      site.contactPad.dispose(); // deliberately unparented (see markBuilt), so not covered below
      site.mesh.dispose(); // recursively disposes the cap + every bead + the belt rig + lane lamp child mesh too
      site.material.dispose();
      site.bodyMaterial.dispose();
      site.beadMaterial.dispose();
      site.waitMaterial.dispose();
    }
  };

  return { previewAt, clearPreview, nearestBuiltWithin, matchesSprout, dispose };
}

/** Whether a tile is free for an automation build (inside grid, not on the reserved nursery/habitat/path/other-site layout). Exposed for input's ghost-preview validity check. */
export function isBuildableTile(tile: TileCoord): boolean {
  return !isReservedTile(tile);
}
