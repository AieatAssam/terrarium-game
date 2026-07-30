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
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { PBRMetallicRoughnessMaterial } from '@babylonjs/core/Materials/PBR/pbrMetallicRoughnessMaterial';
import type { Scene } from '@babylonjs/core/scene';
import type { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';

import { GARDEN_CAMERA_ALPHA } from './camera';
import { tileToWorld, type TileCoord } from './coords';
import { attachStandee, type FlatCap } from './flatArt';
import { createRoundedPrism } from './geometry';
import { AUTOMATION_SITE_TILES, HABITAT_TILES, isReservedTile } from './layout';
import { prefersReducedMotion, watchReducedMotion } from './motion';
import { createPaintedMetalMaterial } from './pbrMaterials';
import { bodyRings, halfHeight, AUTOMATION_BODIES, AUTOMATION_PREVIEW_BODY, type PropBody } from './propDims';
import type { EventBus } from '../events/bus';
import type { AutomationId, HabitatId } from '../core/ids';

const SITE_FALLBACK_COLOR: Record<AutomationId, Color3> = {
  gardenSlide: new Color3(0.55, 0.45, 0.7),
  colourGate: new Color3(0.4, 0.6, 0.55),
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
const BEAD_FORWARD = 0.46;
/** Height of the bead above the plinth's top face. */
const BEAD_RISE = 0.12;

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
  /** World Y the body rests at, so the working bob always returns to it. */
  baseY: number;
  /** The one habitat this instance delivers to (Garden Slide). Null for the
   * Colour Gate, which routes each Sprout to its own matching habitat. */
  targetHabitatId: HabitatId | null;
  /** Sim says a ride is in flight through this automation right now. */
  carrying: boolean;
  /** Destination habitat is at capacity — exactly when automationSystem
   * declines to dispatch (src/sim/systems.ts, "target full — wait rather than
   * force a rejected delivery"). */
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
  dispose: () => void;
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

  for (const id of Object.keys(AUTOMATION_SITE_TILES) as AutomationId[]) {
    const tile = AUTOMATION_SITE_TILES[id];
    const world = tileToWorld(tile);
    const body = AUTOMATION_BODIES[id];
    const mesh = buildAutomationMesh(scene, `terrarium.automation.${id}`, body);
    mesh.position.set(world.x, body.centreY, world.z);
    mesh.isPickable = false;
    const bodyMaterial = createPaintedMetalMaterial(scene, `terrarium.automation.${id}.body.mat`, SITE_FALLBACK_COLOR[id]);
    bodyMaterial.alpha = 0.4; // "not yet built" site marker
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
    cap.material.alpha = 0.4;

    const beadLocalY = halfHeight(body) + BEAD_RISE;

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
      baseY: body.centreY,
      targetHabitatId: null,
      carrying: false,
      destinationFull: false,
      passMs: DEFAULT_BEAD_PASS_MS,
      throughput: 0,
      beltPhase: 0,
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

  // Habitats known to be at capacity. Kept as a set rather than resolved
  // eagerly onto each site because `habitat:full` routinely fires BEFORE the
  // Garden Slide exists: the Slide unlocks at 20 correct manual placements,
  // which at base capacity means a habitat has already filled and reported it.
  // Seeded on load from `save:loaded`, since `habitat:full` never replays.
  const fullHabitats = new Set<HabitatId>();

  const markBuilt = (id: AutomationId, targetHabitatId: HabitatId | null): void => {
    const site = sites[id];
    if (!site) return;
    if (targetHabitatId) {
      site.targetHabitatId = targetHabitatId;
      site.destinationFull = fullHabitats.has(targetHabitatId);
    }
    if (site.built) return;
    site.built = true;
    site.material.alpha = 1;
    site.bodyMaterial.alpha = 1;
    shadowGenerator.addShadowCaster(site.mesh);
  };

  const unsubscribers = [
    bus.subscribe('automation:built', (e) => markBuilt(e.automationId, e.targetHabitatId ?? null)),

    // A restored save replays no `automation:built` — runtime.ts emits only
    // `save:loaded` with a snapshot — so without this an already-built Slide
    // came back as a translucent "not yet built" ghost after every reload, and
    // none of the activity states above would ever have shown.
    bus.subscribe('save:loaded', (e) => {
      for (const habitatId of e.snapshot.fullHabitats ?? []) fullHabitats.add(habitatId);
      const targets = e.snapshot.automationTargets ?? {};
      // Targets first, then fullHabitats above, so a garden that was jammed
      // when the player left still reads as jammed when they return.
      for (const id of e.snapshot.unlockedAutomations) markBuilt(id, targets[id] ?? null);
    }),

    bus.subscribe('sprout:transportStarted', (e) => {
      const site = sites[e.automationId];
      if (!site) return;
      // A ride implies the structure is built even if we missed the event.
      markBuilt(e.automationId, e.automationId === 'gardenSlide' ? habitatAtTile(e.toTile) : null);
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
    }),

    // More room means the queue can move again. Phase 1 habitats never lose a
    // settled Sprout, so a capacity upgrade is the only way out of "full".
    bus.subscribe('upgrade:purchased', (e) => {
      if (e.upgradeId !== 'habitatCapacity') return;
      fullHabitats.clear();
      for (const site of Object.values(sites)) site.destinationFull = false;
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

      // The belt keeps turning while the carry weight is still bleeding off, so
      // it eases to a stop rather than freezing mid-stride.
      if (ambient > 0 && site.carryBlend > 0) {
        site.beltPhase += deltaMs / site.passMs;
        if (site.beltPhase >= 1) site.beltPhase -= Math.floor(site.beltPhase);
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
          // sin() reaches exactly 0 at both ends, so a parcel is invisible at
          // the moment it wraps — no pop, no snap-back.
          const swell = Math.sin(held * Math.PI) * site.carryBlend;
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

  const dispose = (): void => {
    for (const unsubscribe of unsubscribers) unsubscribe();
    scene.onBeforeRenderObservable.remove(activityObserver);
    stopReducedMotionWatch();
    clearPreview();
    for (const site of Object.values(sites)) {
      site.mesh.dispose(); // recursively disposes the cap + every bead child mesh too
      site.material.dispose();
      site.bodyMaterial.dispose();
      site.beadMaterial.dispose();
      site.waitMaterial.dispose();
    }
  };

  return { previewAt, clearPreview, dispose };
}

/** Whether a tile is free for an automation build (inside grid, not on the reserved nursery/habitat/path/other-site layout). Exposed for input's ghost-preview validity check. */
export function isBuildableTile(tile: TileCoord): boolean {
  return !isReservedTile(tile);
}
