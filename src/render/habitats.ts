// The three habitat areas (Ember Nook / Dew Pond / Sunflower Meadow):
// base meshes + their "visibly react to correct Sprouts" behavior (glow
// pulse + particle burst, ripple for Dew Pond) and a gentle, non-punishing
// wobble on an incorrect placement ("friendly retry", never a fail state).

import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Material } from '@babylonjs/core/Materials/material';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
// Side-effect imports: register createDynamicTexture on whichever backend
// src/core/engine.ts picked. See the long note in src/render/particles.ts —
// deep-imported Babylon modules don't auto-register engine extensions, and
// without these `new DynamicTexture(...)` throws at runtime only.
import '@babylonjs/core/Engines/Extensions/engine.dynamicTexture';
import '@babylonjs/core/Engines/WebGPU/Extensions/engine.dynamicTexture';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { PBRMetallicRoughnessMaterial } from '@babylonjs/core/Materials/PBR/pbrMetallicRoughnessMaterial';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import type { Scene } from '@babylonjs/core/scene';
import type { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';

import { swapManifestMaterialTexture } from './assets';
import { GARDEN_CAMERA_ALPHA } from './camera';
import { tileToWorld, tileDistance, type TileCoord } from './coords';
import { attachStandee } from './flatArt';
import { createRoundedPrism } from './geometry';
import { HABITAT_TILES } from './layout';
import type { MotionConfig } from './motion';
import { createRippleRing, createSparkleBurst } from './particles';
import { createStoneBodyMaterial } from './pbrMaterials';
import { bodyRings, halfHeight, HABITAT_BODIES, habitatTopY } from './propDims';
import type { HabitatId } from '../core/ids';

const HABITAT_FALLBACK_COLOR: Record<HabitatId, Color3> = {
  emberNook: new Color3(0.62, 0.32, 0.22),
  dewPond: new Color3(0.3, 0.5, 0.65),
  sunflowerMeadow: new Color3(0.68, 0.6, 0.22),
};

const HABITAT_GLOW_COLOR: Record<HabitatId, Color3> = {
  emberNook: new Color3(1, 0.55, 0.25),
  dewPond: new Color3(0.5, 0.8, 1),
  sunflowerMeadow: new Color3(1, 0.9, 0.4),
};

interface HabitatVisual {
  id: HabitatId;
  mesh: Mesh;
  /** The flat cap disc's material — this is what actually shows C's habitat
   * illustration (see buildHabitatMesh / flatArt.ts) and what reactive glow
   * pulses/hover highlights are applied to. */
  material: PBRMetallicRoughnessMaterial;
  /** The drum body's procedural stone/ceramic PBR material (see
   * src/render/pbrMaterials.ts createStoneBodyMaterial) — kept in sync with
   * `material`'s emissive tint so the glow/wobble reads as "the whole
   * habitat," not just its lid. */
  bodyMaterial: PBRMetallicRoughnessMaterial;
  tile: TileCoord;
  worldCenter: { x: number; y: number; z: number };
  /** Tile centre lifted to this drum's TOP face — where reaction effects have
   * to be emitted from. Emitting at `worldCenter` (tile y = 0) put the sparkle
   * burst and the Dew Pond ripple ring *inside* the opaque drum; see
   * src/render/propDims.ts for the full note on that bug class. */
  topCenter: { x: number; y: number; z: number };
  baseEmissive: Color3;
}

export interface HabitatManager {
  get: (id: HabitatId) => HabitatVisual;
  all: () => HabitatVisual[];
  /** Nearest habitat to a world point within `radiusTiles`, or null. Used by input for drop-target + hover detection. */
  nearestWithin: (world: { x: number; z: number }, radiusTiles: number) => HabitatId | null;
  setHover: (id: HabitatId | null, valid: boolean | null) => void;
  reactCorrect: (id: HabitatId, motion: MotionConfig) => void;
  reactIncorrect: (id: HabitatId, motion: MotionConfig) => void;
  dispose: () => void;
}

/**
 * Habitat drum body. Previously three raw `MeshBuilder.CreateCylinder` calls
 * with tessellation 6 (Ember Nook) / 8 (Sunflower Meadow) / 28 (Dew Pond) —
 * i.e. two of the three read as visibly faceted hexagonal/octagonal prisms
 * with razor-sharp unbevelled vertical edges, which is exactly what the brief
 * forbids and what the player reported as "extremely blocky".
 *
 * Now every drum is a `createRoundedPrism` built from its `HABITAT_BODIES`
 * entry: a round cross-section at 48-56 segments, a rounded top rim, a
 * chamfered base, a wider foot with a shelf step, and (for the Sunflower
 * Meadow) the same taper its original diameterTop/diameterBottom gave. Heights
 * and outer radii are unchanged, so nothing that measures off the top face
 * moved.
 */
function buildHabitatMesh(scene: Scene, id: HabitatId): Mesh {
  const body = HABITAT_BODIES[id];
  return createRoundedPrism(
    `terrarium.habitat.${id}`,
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

export function createHabitatManager(scene: Scene, shadowGenerator: ShadowGenerator): HabitatManager {
  const visuals = {} as Record<HabitatId, HabitatVisual>;

  for (const id of Object.keys(HABITAT_TILES) as HabitatId[]) {
    const tile = HABITAT_TILES[id];
    const world = tileToWorld(tile);
    const body = HABITAT_BODIES[id];
    const mesh = buildHabitatMesh(scene, id);
    mesh.position.set(world.x, body.centreY, world.z);
    mesh.receiveShadows = true;
    mesh.isPickable = true;
    mesh.metadata = { kind: 'habitat', habitatId: id, tile };
    shadowGenerator.addShadowCaster(mesh);

    // Drum body: no manifest texture (see flatArt.ts for why — default
    // CreateCylinder UV wraps a single flat illustration around the side
    // wall instead of showing it top-down) but a real PBR stone/ceramic
    // material — rounded bevels + bump + roughness variation + AO rather
    // than a flat StandardMaterial fill.
    const bodyMaterial = createStoneBodyMaterial(scene, `terrarium.habitat.${id}.body.mat`, HABITAT_FALLBACK_COLOR[id]);
    bodyMaterial.emissiveColor = Color3.Black();
    mesh.material = bodyMaterial;

    // Habitat scene illustration standing upright as a billboarded card
    // (see src/render/flatArt.ts's attachStandee) rather than lying flat on
    // top of the drum. Sized relative to the drum's own top radius so
    // bigger habitats get a proportionally bigger card. attachStandee crops
    // to the source art's real content aspect ratio, so this is a maximum
    // bounding footprint, not the final rendered size — kept modest (0.9x
    // rather than an earlier 1.5x) so the card can't grow tall enough to
    // occlude a settled Sprout resting on top (see src/render/sprouts.ts's
    // derived settle height) — verified in browser QA, see
    // docs/ART_QA_REPORT.md.
    const standeeSize = body.halfWidth * 0.9;
    const cap = attachStandee(
      scene,
      mesh,
      `terrarium.habitat.${id}.cap`,
      `habitat.${id}.base`,
      HABITAT_FALLBACK_COLOR[id],
      standeeSize,
      standeeSize,
      halfHeight(body),
    );
    cap.material.emissiveColor = Color3.Black();

    visuals[id] = {
      id,
      mesh,
      material: cap.material,
      bodyMaterial,
      tile,
      worldCenter: world,
      topCenter: { x: world.x, y: habitatTopY(id), z: world.z },
      baseEmissive: Color3.Black(),
    };
  }

  const nearestWithin = (world: { x: number; z: number }, radiusTiles: number): HabitatId | null => {
    const tile = { x: Math.round(world.x), z: Math.round(world.z) };
    let best: HabitatId | null = null;
    let bestDist = Infinity;
    for (const visual of Object.values(visuals)) {
      const d = tileDistance(tile, visual.tile);
      if (d <= radiusTiles && d < bestDist) {
        bestDist = d;
        best = visual.id;
      }
    }
    return best;
  };

  const setGlow = (visual: HabitatVisual, color: Color3): void => {
    visual.material.emissiveColor = color;
    visual.bodyMaterial.emissiveColor = color;
  };

  const setHover = (id: HabitatId | null, valid: boolean | null): void => {
    for (const visual of Object.values(visuals)) {
      if (visual.id !== id) {
        setGlow(visual, Color3.Black());
        visual.mesh.scaling.set(1, 1, 1);
        continue;
      }
      if (valid === true) {
        setGlow(visual, HABITAT_GLOW_COLOR[id].scale(0.35));
        visual.mesh.scaling.set(1.05, 1.05, 1.05);
      } else if (valid === false) {
        setGlow(visual, new Color3(0.15, 0.05, 0.05));
        visual.mesh.scaling.set(0.97, 0.97, 0.97);
      } else {
        setGlow(visual, Color3.Black());
        visual.mesh.scaling.set(1, 1, 1);
      }
    }
  };

  const reactCorrect = (id: HabitatId, motion: MotionConfig): void => {
    const visual = visuals[id];
    visual.mesh.scaling.set(1, 1, 1);
    // Emitted from the drum's TOP face, not its tile centre: the burst's own
    // +0.3 internal offset off a tile-centre y of 0 landed at 0.30, inside an
    // Ember Nook drum whose top face is at 0.45, and the ripple ring's +0.02
    // landed at 0.02 inside a Dew Pond drum whose top is at 0.325 — so the
    // "you got it right" feedback was rendering *inside* opaque geometry.
    createSparkleBurst(scene, visual.topCenter, {
      color: undefined,
      count: Math.round(28 * motion.particleDensity) || 1,
    });
    if (id === 'dewPond') createRippleRing(scene, visual.topCenter, 900 * (motion.backgroundMotion > 0 ? 1 : 0.6));

    swapManifestMaterialTexture(scene, visual.material, `habitat.${id}.base`); // re-affirm base texture in case a future "growth" variant key gets swapped in on repeated correct placements

    const durationMs = motion.placementDurationMs;
    const start = performance.now();
    const glow = HABITAT_GLOW_COLOR[id];
    const observer = scene.onBeforeRenderObservable.add(() => {
      const t = Math.min(1, (performance.now() - start) / durationMs);
      const pulse = Math.sin(Math.min(1, t) * Math.PI); // up then down within the duration
      setGlow(visual, glow.scale(0.6 * pulse));
      const bump = 1 + 0.12 * motion.ambientIntensity * pulse + (motion.ambientIntensity === 0 ? 0.04 * pulse : 0);
      visual.mesh.scaling.set(bump, bump, bump);
      if (t >= 1) {
        scene.onBeforeRenderObservable.remove(observer);
        setGlow(visual, Color3.Black());
        visual.mesh.scaling.set(1, 1, 1);
      }
    });
  };

  const reactIncorrect = (id: HabitatId, motion: MotionConfig): void => {
    const visual = visuals[id];
    const durationMs = Math.max(220, motion.placementDurationMs * 0.7);
    const start = performance.now();
    const amplitude = 0.06 * (motion.ambientIntensity > 0 ? 1 : 0.4);
    const observer = scene.onBeforeRenderObservable.add(() => {
      const t = Math.min(1, (performance.now() - start) / durationMs);
      visual.mesh.rotation.z = Math.sin(t * Math.PI * 4) * amplitude * (1 - t);
      if (t >= 1) {
        scene.onBeforeRenderObservable.remove(observer);
        visual.mesh.rotation.z = 0;
      }
    });
  };

  const dispose = (): void => {
    for (const visual of Object.values(visuals)) {
      visual.mesh.dispose(); // recursively disposes the cap child mesh too
      visual.material.dispose();
      visual.bodyMaterial.dispose();
    }
  };

  return {
    get: (id) => visuals[id],
    all: () => Object.values(visuals),
    nearestWithin,
    setHover,
    reactCorrect,
    reactIncorrect,
    dispose,
  };
}

// ===========================================================================
// Habitat occupancy signs ("how many live here")
// ===========================================================================
//
// WHY THIS EXISTS
// ---------------
// Settled Sprouts are parked in deterministic slots on a habitat's
// viewer-facing side (src/render/sprouts.ts `sproutSettleOffset`). That slot
// table is 3 columns x 2 rows = SIX distinct positions, and the index wraps
// with `% SETTLE_ROWS` — so the SEVENTH settled Sprout is placed at the
// *identical* world position as the first. Above six it is not merely a dense
// pile: it is coincident billboard geometry, z-fighting with itself, hiding
// the habitat art behind it and impossible to read or count. Habitats hold 8
// by default and up to 17 with Habitat Capacity maxed, so every player reaches
// that state.
//
// The fix has two halves, and the split matters:
//
//   1. The crowd is CAPPED at the six real slots, and those six visibly
//      TIGHTEN as the population grows (see `settleCrowdSpacing` in
//      sprouts.ts). Occupancy therefore still reads from the world itself —
//      a busy habitat has a visibly packed huddle, a full one is shoulder to
//      shoulder — which is what GameRules §8.1 asks for when it says capacity
//      must be communicated through occupied spaces and warns against relying
//      on text.
//   2. Past the sixth Sprout a garden-label sign is planted in the soil in
//      front of the habitat carrying the PRECISE number, because once the
//      crowd stops growing the visual alone can no longer carry an exact
//      count. The sign is a supplement, never the whole story: it also draws
//      a proportional fill meter (length, not colour), a Sprout-cluster
//      pictogram, and — when the home is full — extra SHAPE cues (double
//      border, cross-hatched meter, an end-stop bracket, a roof arch over the
//      pictogram). Nothing on it is conveyed by colour alone.
//
// It is a ground-planted plant label rather than anything mounted on the drum
// on purpose: standing on the soil in front of the habitat it can never
// occlude the habitat's own standee card (which is anchored at the drum
// centre and rises from the drum top) nor the settled Sprouts (which stand on
// the drum top, well above it), and it reads as garden equipment rather than
// a UI panel dropped into the world.

/** Unit XZ vector from a habitat's centre toward the viewer, and the vector
 * across the screen. Both are derived from the standing camera-yaw invariant
 * documented on GARDEN_CAMERA_ALPHA (no input path rotates alpha), which is
 * the same invariant src/render/sprouts.ts uses to lay settled Sprouts out on
 * the camera-facing side. Duplicated from there rather than shared, because
 * sprouts.ts imports THIS module for the sign factory and the reverse import
 * would be a cycle; both derive from the one exported constant so they cannot
 * drift. */
const SIGN_VIEWER_X = Math.cos(GARDEN_CAMERA_ALPHA);
const SIGN_VIEWER_Z = Math.sin(GARDEN_CAMERA_ALPHA);
const SIGN_LATERAL_X = -Math.sin(GARDEN_CAMERA_ALPHA);
const SIGN_LATERAL_Z = Math.cos(GARDEN_CAMERA_ALPHA);

/** How far toward the viewer, and how far across, the sign is planted from the
 * habitat's tile centre. hypot(1.05, 1.15) = 1.56 clears the widest drum's
 * foot (Dew Pond / Sunflower Meadow: 1.3 + 0.09 outset = 1.39), so the sign
 * always stands on open soil rather than intersecting the pot. */
const SIGN_FORWARD = 1.05;
const SIGN_LATERAL = 1.15;
/** World size of the whole card (label plaque + stake + baked ground shadow).
 * Sized by MEASUREMENT, not by eye: projected at the default camera
 * (radius 19, fov 0.55) on a 1440x900 viewport, this puts the count numeral's
 * cap height at ~26px and the whole plaque at ~53px, comfortably clear of the
 * "tiny unreadable icons" GameRules §4.1 rules out and still legible on a
 * smaller 1280x720 window. Anything much larger starts competing with the
 * habitat's own art for attention. */
const SIGN_WIDTH = 0.95;
const SIGN_HEIGHT = 0.95;
/** Gap between the soil and the card's bottom edge — same anti-z-fight reason
 * as flatArt.ts's STANDEE_GROUND_CLEARANCE. */
const SIGN_GROUND_CLEARANCE = 0.02;

const SIGN_TEXTURE_WIDTH = 256;
const SIGN_TEXTURE_HEIGHT = 256;

/** Everything the sign needs to draw itself, derived purely from the sim-side
 * numbers. Split out as a pure function so the threshold behaviour is unit
 * testable without a Babylon scene. */
export interface OccupancySignState {
  /** Whether the sign should be on screen at all. */
  visible: boolean;
  /** Settled Sprouts living here, including the ones no longer drawn individually. */
  count: number;
  /** Effective capacity, i.e. including the Habitat Capacity upgrade. */
  capacity: number;
  /** 0..1 occupancy, for the meter's filled length. */
  fill: number;
  full: boolean;
}

/**
 * The sign appears only once the population outgrows the `visibleSlots` real
 * standing slots — below that the crowd IS the display and a sign would be
 * redundant clutter in an early, quiet garden. Because the smallest capacity
 * (8) is above the slot count (6), a habitat can never reach "full" while the
 * sign is still hidden.
 */
export function occupancySignState(count: number, capacity: number, visibleSlots: number): OccupancySignState {
  const safeCapacity = Math.max(1, capacity);
  return {
    visible: count > visibleSlots,
    count,
    capacity: safeCapacity,
    fill: Math.min(1, Math.max(0, count / safeCapacity)),
    full: count >= safeCapacity,
  };
}

interface SignPalette {
  plaqueTop: string;
  plaqueBottom: string;
  border: string;
  ink: string;
  track: string;
  fill: string;
  hatch: string;
  stake: string;
  stakeShade: string;
  shadow: string;
  borderWidth: number;
}

/**
 * Two fully-specified palettes rather than a tint applied to one. High
 * contrast is not "the same sign, slightly darker": it drops every warm
 * mid-tone, goes pure black ink on pure white, and thickens every stroke, so
 * the numeral and the meter's filled/empty boundary stay unambiguous for a
 * player who turned the mode on precisely because subtle tonal differences
 * do not read for them. Both palettes are opaque with a heavy dark border, so
 * the sign is legible in front of ANY habitat's colour and against soil,
 * water, grass or shadow alike.
 */
const SIGN_PALETTE: SignPalette = {
  plaqueTop: '#fbf1dc',
  plaqueBottom: '#e8d5ae',
  border: '#3b2a1b',
  ink: '#2e2013',
  track: '#e0cfae',
  fill: '#7a4f2c',
  hatch: '#e8d5ae',
  stake: '#8a6239',
  stakeShade: '#5d3f22',
  shadow: 'rgba(28, 20, 12, 0.32)',
  borderWidth: 7,
};

const SIGN_PALETTE_HIGH_CONTRAST: SignPalette = {
  plaqueTop: '#ffffff',
  plaqueBottom: '#ffffff',
  border: '#000000',
  ink: '#000000',
  track: '#ffffff',
  fill: '#000000',
  hatch: '#ffffff',
  stake: '#000000',
  stakeShade: '#ffffff',
  shadow: 'rgba(0, 0, 0, 0.5)',
  borderWidth: 11,
};

/** The attribute src/ui/prefs.ts reflects the resolved high-contrast
 * preference onto (`root.dataset.contrast = 'high' | 'normal'`). Read the same
 * way src/render/motion.ts reads `data-reduced-motion` — guarded so calling
 * this under jsdom or headless tooling never throws. MotionConfig carries no
 * contrast field today; see the report note about adding one. */
const CONTRAST_ATTRIBUTE = 'data-contrast';

function prefersHighContrast(): boolean {
  if (typeof document === 'undefined') return false;
  return document.documentElement?.getAttribute(CONTRAST_ATTRIBUTE) === 'high';
}

function roundedRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x, y + radius);
  ctx.closePath();
}

/**
 * A little huddle of Sprout silhouettes: two behind, one in front with a leaf
 * sprig and two eyes. This is what stops the numeral from being a bare number
 * — it says WHAT is being counted without a word of text, and it is drawn at
 * ~22px on screen at the default camera rather than as a decorative speck.
 * The front figure is separated from the two behind it by a thick plaque-
 * coloured outline, so the "several creatures" reading survives being a
 * single-colour silhouette (no colour coding involved).
 */
function drawSproutCluster(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  palette: SignPalette,
  full: boolean,
): void {
  ctx.fillStyle = palette.ink;
  // Two figures behind.
  for (const cx of [x + w * 0.26, x + w * 0.74]) {
    ctx.beginPath();
    ctx.ellipse(cx, y + h * 0.45, w * 0.26, h * 0.28, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // Front figure, ringed in plaque colour so the three read as three.
  ctx.strokeStyle = palette.plaqueTop;
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.ellipse(x + w * 0.5, y + h * 0.68, w * 0.33, h * 0.32, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fill();
  // Sprig.
  ctx.lineWidth = 6;
  ctx.strokeStyle = palette.ink;
  ctx.beginPath();
  ctx.moveTo(x + w * 0.5, y + h * 0.4);
  ctx.lineTo(x + w * 0.5, y + h * 0.24);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(x + w * 0.62, y + h * 0.22, w * 0.14, h * 0.07, -0.5, 0, Math.PI * 2);
  ctx.fill();
  // Eyes, punched back out in plaque colour.
  ctx.fillStyle = palette.plaqueTop;
  for (const cx of [x + w * 0.4, x + w * 0.6]) {
    ctx.beginPath();
    ctx.ellipse(cx, y + h * 0.66, w * 0.055, h * 0.05, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  if (full) {
    // "No more room": a roof arch closes over the huddle. A SHAPE cue, so it
    // survives greyscale, colour-blindness and high-contrast mode alike.
    ctx.strokeStyle = palette.ink;
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.arc(x + w * 0.5, y + h * 0.6, w * 0.62, Math.PI * 1.16, Math.PI * 1.84);
    ctx.stroke();
  }
}

/** The proportional occupancy meter: a capsule whose FILLED LENGTH is the
 * at-a-glance signal, hatched so the filled region is distinguishable by
 * texture as well as by tone, and capped with a heavy end-stop bracket plus a
 * cross-hatch once the habitat is full. */
function drawOccupancyMeter(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  palette: SignPalette,
  state: OccupancySignState,
): void {
  const radius = h / 2;
  roundedRectPath(ctx, x, y, w, h, radius);
  ctx.fillStyle = palette.track;
  ctx.fill();

  ctx.save();
  roundedRectPath(ctx, x, y, w, h, radius);
  ctx.clip();
  const filled = w * state.fill;
  ctx.fillStyle = palette.fill;
  ctx.fillRect(x, y, filled, h);
  // Diagonal hatch inside the filled run (cross-hatched when full).
  ctx.strokeStyle = palette.hatch;
  ctx.lineWidth = 3;
  for (let i = -h; i < filled + h; i += 11) {
    ctx.beginPath();
    ctx.moveTo(x + i, y + h);
    ctx.lineTo(x + i + h, y);
    ctx.stroke();
  }
  if (state.full) {
    for (let i = -h; i < filled + h; i += 11) {
      ctx.beginPath();
      ctx.moveTo(x + i, y);
      ctx.lineTo(x + i + h, y + h);
      ctx.stroke();
    }
  }
  // Dashed guide through the empty run, so "room left" is a visible gap with
  // its own texture rather than merely a paler colour.
  if (!state.full) {
    ctx.strokeStyle = palette.ink;
    ctx.lineWidth = 3;
    ctx.setLineDash([7, 9]);
    ctx.beginPath();
    ctx.moveTo(x + filled + 8, y + h / 2);
    ctx.lineTo(x + w - 6, y + h / 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();

  roundedRectPath(ctx, x, y, w, h, radius);
  ctx.strokeStyle = palette.border;
  ctx.lineWidth = 5;
  ctx.stroke();

  if (state.full) {
    // End-stop bracket: the meter visibly runs out of track.
    ctx.strokeStyle = palette.border;
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(x + w + 4, y - 5);
    ctx.lineTo(x + w + 4, y + h + 5);
    ctx.stroke();
  }
}

function drawSign(ctx: CanvasRenderingContext2D, state: OccupancySignState, palette: SignPalette): void {
  const W = SIGN_TEXTURE_WIDTH;
  const H = SIGN_TEXTURE_HEIGHT;
  ctx.clearRect(0, 0, W, H);

  // Baked contact shadow, so a billboarded card reads as PLANTED in the soil
  // rather than floating (the brief's "every placeable must feel attached to
  // the garden floor"). Baked rather than a real shadow caster: a Y-billboard
  // casting a dynamic shadow swims as the card turns.
  ctx.fillStyle = palette.shadow;
  ctx.beginPath();
  ctx.ellipse(W / 2, 246, 66, 10, 0, 0, Math.PI * 2);
  ctx.fill();

  // Stake.
  ctx.fillStyle = palette.stake;
  ctx.beginPath();
  ctx.moveTo(113, 180);
  ctx.lineTo(143, 180);
  ctx.lineTo(137, 242);
  ctx.lineTo(119, 242);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = palette.stakeShade;
  ctx.beginPath();
  ctx.moveTo(134, 180);
  ctx.lineTo(143, 180);
  ctx.lineTo(137, 242);
  ctx.lineTo(130, 242);
  ctx.closePath();
  ctx.fill();

  // Plaque: painted enamel label with a top-to-bottom sheen so it has
  // material depth rather than reading as a flat rectangle.
  const gradient = ctx.createLinearGradient(0, 8, 0, 194);
  gradient.addColorStop(0, palette.plaqueTop);
  gradient.addColorStop(1, palette.plaqueBottom);
  roundedRectPath(ctx, 8, 8, 240, 186, 24);
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.strokeStyle = palette.border;
  ctx.lineWidth = palette.borderWidth;
  ctx.stroke();
  if (state.full) {
    // Second, inset border — the "this one is finished / closed" shape cue.
    roundedRectPath(ctx, 20, 20, 216, 162, 16);
    ctx.lineWidth = 4;
    ctx.stroke();
  }

  // Rivets, for hand-made craft rather than UI-panel flatness.
  ctx.fillStyle = palette.border;
  for (const cx of [32, 224]) {
    ctx.beginPath();
    ctx.arc(cx, 30, 6, 0, Math.PI * 2);
    ctx.fill();
  }

  drawSproutCluster(ctx, 20, 58, 58, 80, palette, state.full);

  // The count. Auto-shrunk to fit so a three-digit future capacity cannot
  // overflow the plaque; at the shipped 1..17 range it always draws at the
  // full size, ~25px of cap height on screen at the default camera.
  const label = String(state.count);
  const regionX = 86;
  const regionW = 152;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  let fontSize = 126;
  ctx.font = `700 ${fontSize}px 'Segoe UI', system-ui, -apple-system, sans-serif`;
  const measured = ctx.measureText(label).width;
  if (measured > regionW) {
    fontSize = Math.floor((fontSize * regionW) / measured);
    ctx.font = `700 ${fontSize}px 'Segoe UI', system-ui, -apple-system, sans-serif`;
  }
  ctx.fillStyle = palette.ink;
  ctx.fillText(label, regionX + regionW / 2, 140);

  drawOccupancyMeter(ctx, 22, 156, 206, 28, palette, state);
}

interface SignVisual {
  mesh: Mesh;
  material: PBRMetallicRoughnessMaterial;
  texture: DynamicTexture;
  /** Last drawn signature, so an unchanged update never repaints the canvas. */
  drawn: string;
  popObserver: ReturnType<Scene['onBeforeRenderObservable']['add']> | null;
}

export interface HabitatOccupancySigns {
  /**
   * Shows/hides and (re)paints one habitat's sign. Cheap and idempotent: a
   * call whose state and contrast mode match the last paint touches no canvas
   * and allocates nothing. `animate` is false for a restored save, which must
   * hydrate silently rather than replay a celebration for a population the
   * player settled long ago.
   */
  set: (id: HabitatId, state: OccupancySignState, motion: MotionConfig, animate: boolean) => void;
  dispose: () => void;
}

export function createHabitatOccupancySigns(scene: Scene): HabitatOccupancySigns {
  const signs = {} as Record<HabitatId, SignVisual>;

  for (const id of Object.keys(HABITAT_TILES) as HabitatId[]) {
    const world = tileToWorld(HABITAT_TILES[id]);
    const mesh = MeshBuilder.CreatePlane(
      `terrarium.habitat.${id}.occupancy`,
      { width: SIGN_WIDTH, height: SIGN_HEIGHT },
      scene,
    );
    mesh.billboardMode = Mesh.BILLBOARDMODE_Y;
    mesh.position.set(
      world.x + SIGN_VIEWER_X * SIGN_FORWARD + SIGN_LATERAL_X * SIGN_LATERAL,
      SIGN_GROUND_CLEARANCE + SIGN_HEIGHT / 2,
      world.z + SIGN_VIEWER_Z * SIGN_FORWARD + SIGN_LATERAL_Z * SIGN_LATERAL,
    );
    mesh.isPickable = false; // never a drop target, never steals a Sprout pick
    mesh.setEnabled(false);

    const texture = new DynamicTexture(
      `terrarium.habitat.${id}.occupancy.tex`,
      { width: SIGN_TEXTURE_WIDTH, height: SIGN_TEXTURE_HEIGHT },
      scene,
      true,
      Texture.TRILINEAR_SAMPLINGMODE,
    );
    texture.hasAlpha = true;

    const material = new PBRMetallicRoughnessMaterial(`terrarium.habitat.${id}.occupancy.mat`, scene);
    material.baseTexture = texture;
    material.baseColor = Color3.White();
    material.metallic = 0;
    material.roughness = 0.62; // painted enamel: satin, not plastic-glossy
    material.backFaceCulling = false;
    // A self-lit floor so the numeral stays readable where the sign falls on a
    // habitat's shadow side — but driven by the label's OWN texture rather than
    // by a flat emissiveColor. A flat grey emissive adds the same light to every
    // texel, which lifts the ink as much as the plaque: measured in-browser, a
    // flat 0.16 turned near-black ink into mid-grey and drained the warm cream
    // to a chalky white, i.e. it destroyed exactly the contrast the sign exists
    // to provide. Scaling the emissive by the texture keeps dark ink dark and
    // only brightens the plaque behind it.
    material.emissiveTexture = texture;
    material.emissiveColor = new Color3(0.34, 0.34, 0.34);
    // Same internal-flag workaround as assets.ts createManifestMaterial —
    // PBRMetallicRoughnessMaterial has no public useAlphaFromAlbedoTexture.
    (material as unknown as { _useAlphaFromAlbedoTexture: boolean })._useAlphaFromAlbedoTexture = true;
    material.transparencyMode = Material.MATERIAL_ALPHABLEND;
    mesh.material = material;

    signs[id] = { mesh, material, texture, drawn: '', popObserver: null };
  }

  const paint = (sign: SignVisual, state: OccupancySignState): void => {
    const highContrast = prefersHighContrast();
    const signature = `${state.count}/${state.capacity}/${state.full ? 'f' : 'o'}/${highContrast ? 'hc' : 'n'}`;
    if (sign.drawn === signature) return;
    sign.drawn = signature;
    const ctx = sign.texture.getContext() as unknown as CanvasRenderingContext2D;
    drawSign(ctx, state, highContrast ? SIGN_PALETTE_HIGH_CONTRAST : SIGN_PALETTE);
    // invertY = true (the DynamicTexture default): a plane's v = 0 is its
    // BOTTOM edge while the canvas's row 0 is its TOP, so an un-inverted
    // upload renders the whole label upside down. src/render/assets.ts uploads
    // with invertY = false instead, but only because src/render/flatArt.ts
    // compensates with a negative vScale — this module has no such crop step.
    sign.texture.update();
  };

  const pop = (sign: SignVisual, motion: MotionConfig): void => {
    if (sign.popObserver) {
      scene.onBeforeRenderObservable.remove(sign.popObserver);
      sign.popObserver = null;
    }
    // Core "a new arrival was counted" feedback, so it is damped rather than
    // dropped under reduced motion — the same rule motion.ts applies to
    // placementDurationMs (never zero, just calmer).
    const amplitude = 0.1 * (motion.ambientIntensity > 0 ? 1 : 0.35);
    const durationMs = motion.placementDurationMs;
    const start = performance.now();
    sign.popObserver = scene.onBeforeRenderObservable.add(() => {
      const t = Math.min(1, (performance.now() - start) / durationMs);
      const scale = 1 + Math.sin(t * Math.PI) * amplitude;
      sign.mesh.scaling.set(scale, scale, 1);
      if (t >= 1 && sign.popObserver) {
        scene.onBeforeRenderObservable.remove(sign.popObserver);
        sign.popObserver = null;
        sign.mesh.scaling.set(1, 1, 1);
      }
    });
  };

  const set = (id: HabitatId, state: OccupancySignState, motion: MotionConfig, animate: boolean): void => {
    const sign = signs[id];
    if (!sign) return;
    if (!state.visible) {
      sign.mesh.setEnabled(false);
      return;
    }
    const wasHidden = !sign.mesh.isEnabled();
    const before = sign.drawn;
    paint(sign, state);
    sign.mesh.setEnabled(true);
    if (animate && (wasHidden || before !== sign.drawn)) pop(sign, motion);
  };

  // A player toggling High contrast mid-session must see the signs redraw, not
  // keep the palette they happened to be painted with. Same mechanism
  // motion.ts uses to watch the reduced-motion attribute.
  let contrastObserver: MutationObserver | undefined;
  const lastState = new Map<HabitatId, OccupancySignState>();
  if (typeof MutationObserver === 'function' && typeof document !== 'undefined' && document.documentElement) {
    contrastObserver = new MutationObserver(() => {
      for (const [id, state] of lastState) paint(signs[id], state);
    });
    contrastObserver.observe(document.documentElement, { attributes: true, attributeFilter: [CONTRAST_ATTRIBUTE] });
  }

  return {
    set: (id, state, motion, animate) => {
      lastState.set(id, state);
      set(id, state, motion, animate);
    },
    dispose: () => {
      contrastObserver?.disconnect();
      lastState.clear();
      for (const sign of Object.values(signs) as SignVisual[]) {
        if (sign.popObserver) scene.onBeforeRenderObservable.remove(sign.popObserver);
        sign.mesh.dispose();
        sign.material.dispose();
        sign.texture.dispose();
      }
    },
  };
}
