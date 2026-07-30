// Sprout visuals: one billboarded sprite mesh per live Sprout instance,
// created/updated/animated from GameEvent bus traffic. Texture per
// idle/walk/happy/reveal state is loaded via the exact manifest key pattern
// from docs/CONTRACTS.md (`sprout.<type>.<state>`).
//
// Drag position updates (every pointermove while held) are NOT bus events —
// there's no such member in the GameEvent union, and spamming the bus with a
// per-frame position wouldn't fit its "discrete moments" shape anyway — so
// src/input calls `setDragPosition` directly. Discrete moments (picked up,
// dropped, placed, settled, transported) all come through bus subscriptions
// like every other system.

import { Color3 } from '@babylonjs/core/Maths/math.color';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { PBRMetallicRoughnessMaterial } from '@babylonjs/core/Materials/PBR/pbrMetallicRoughnessMaterial';
import type { Scene } from '@babylonjs/core/scene';

import { createManifestMaterial, swapManifestMaterialTexture } from './assets';
import { GARDEN_CAMERA_ALPHA } from './camera';
import { tileToWorld, type TileCoord } from './coords';
import { HABITAT_TILES, NURSERY_TILE } from './layout';
import { easingFn, type MotionConfig } from './motion';
import { createSparkleBurst } from './particles';
import { habitatTopY, nurseryTopY } from './propDims';
import type { EventBus } from '../events/bus';
import type { HabitatId, SproutTypeId } from '../core/ids';
import { SPROUT_TYPES } from '../data/sproutTypes';

export type SproutVisualState = 'reveal' | 'idle' | 'walk' | 'happy' | 'settled';

// ---------------------------------------------------------------------------
// Sprite heights
// ---------------------------------------------------------------------------
// These used to be two hard-coded magic numbers (0.8 floating, 0.55 settled)
// whose comments claimed they cleared the props underneath. They did not: a
// Sprout is a `CreatePlane({ size: SPROUT_SPRITE_SIZE })` billboard and
// `mesh.position` places its CENTRE, so 0.8 put the card's bottom edge at
// 0.8 - 0.35 = 0.45 against a Nursery mound whose top face is 0.70, and 0.55
// put a settled card's bottom edge at 0.20 against an Ember Nook top face of
// 0.45. Both buried roughly a quarter of a unit of artwork inside opaque
// geometry. Measured in-browser before the fix: the floating Nursery Sprout's
// bounding box ran 0.4006 -> 1.1006 while the mound top was 0.70.
//
// (`attachStandee`'s callers never had this bug because they pass
// `surfaceTop + cardHeight / 2` — the same arithmetic now used here.)
//
// So every height below is DERIVED: the surface's own top face (from the
// shared prop-dimension table in src/render/propDims.ts, which is also what
// builds those meshes) plus this sprite's own half-height plus an explicit
// clearance. Change a drum's height or the sprite size and these follow.

/** Edge length of the Sprout billboard plane. */
const SPROUT_SPRITE_SIZE = 0.7;
/** Offset from the sprite's centre (what `position` sets) to its bottom edge. */
const SPROUT_HALF_HEIGHT = SPROUT_SPRITE_SIZE / 2;
/** Air gap left between a surface and the sprite's bottom edge. */
const SPROUT_SURFACE_CLEARANCE = 0.03;
/** Peak amplitude of the idle bob in `update` below. The floating height has
 * to budget for it: without this term the bob's DOWNWARD half would dip the
 * card's bottom edge back under the Nursery's top face. */
const SPROUT_BOB_AMPLITUDE = 0.05;

/**
 * Resting/drag/transport height for a Sprout that is NOT settled — clears the
 * Nursery mound (the tallest thing a Sprout hovers over) by its own
 * half-height plus the bob amplitude plus the clearance. Exported because
 * src/input/index.ts's pointer-to-world drag plane has to sit at exactly this
 * height, and tests/e2e/helpers.ts projects it to find the pickup point.
 */
export const SPROUT_FLOAT_HEIGHT = nurseryTopY() + SPROUT_BOB_AMPLITUDE + SPROUT_SURFACE_CLEARANCE + SPROUT_HALF_HEIGHT;

/** Resting height for a Sprout settled on a given habitat's top face. Settled
 * Sprouts don't bob (see `update`), so no bob budget is needed. */
function sproutSettleHeight(habitatId: HabitatId): number {
  return habitatTopY(habitatId) + SPROUT_SURFACE_CLEARANCE + SPROUT_HALF_HEIGHT;
}

// Where settled Sprouts stand on a habitat's top face.
//
// The original ring (`angle = count * 0.9`, `radius = 0.35 + (count % 4) * 0.1`)
// swept the full circle around the drum centre, which put roughly half of all
// settled Sprouts BEHIND the habitat's own standee card — and that card is a
// camera-facing billboard standing at the drum centre, so it cut the Sprout in
// half. Confirmed in browser QA: a Sprout settled on the Ember Nook rendered as
// a partial sliver poking out from behind the habitat symbol.
//
// Fix: lay the slots out on the VIEWER-FACING side of the card only. That is
// well-defined because the garden camera's yaw is a fixed invariant — no input
// path rotates alpha (see GARDEN_CAMERA_ALPHA in src/render/camera.ts) — so
// "toward the viewer" is one constant world direction for the whole session.
// The same invariant is what makes the lit billboard treatment safe (see
// `spawn` below).
/** Unit XZ vector from a habitat's centre toward the viewer. */
const VIEWER_X = Math.cos(GARDEN_CAMERA_ALPHA);
const VIEWER_Z = Math.sin(GARDEN_CAMERA_ALPHA);
/** Unit XZ vector across the screen (perpendicular to the above). */
const LATERAL_X = -Math.sin(GARDEN_CAMERA_ALPHA);
const LATERAL_Z = Math.cos(GARDEN_CAMERA_ALPHA);
const SETTLE_SLOTS_PER_ROW = 3;
const SETTLE_ROWS = 2;
const SETTLE_SLOT_SPACING = 0.34;
/** How far in front of the card the first row stands. Kept small enough that
 * even the smallest habitat's FLAT top face (Ember Nook: 1.1 outer radius less
 * its 0.1 rim bevel = 1.0) comfortably contains every slot — the furthest is
 * hypot(0.62, 0.34) = 0.71 from the centre. */
const SETTLE_FRONT_DISTANCE = 0.62;
const SETTLE_ROW_SPACING = 0.26;

/** Deterministic XZ offset from a habitat's centre for the Nth settled Sprout —
 * a small crowd standing in front of the habitat's sign, never behind it. */
function sproutSettleOffset(index: number): { x: number; z: number } {
  const row = Math.floor(index / SETTLE_SLOTS_PER_ROW) % SETTLE_ROWS;
  const column = index % SETTLE_SLOTS_PER_ROW;
  const lateral = (column - (SETTLE_SLOTS_PER_ROW - 1) / 2) * SETTLE_SLOT_SPACING;
  const forward = SETTLE_FRONT_DISTANCE - row * SETTLE_ROW_SPACING;
  return {
    x: VIEWER_X * forward + LATERAL_X * lateral,
    z: VIEWER_Z * forward + LATERAL_Z * lateral,
  };
}

export interface SproutVisual {
  id: string;
  sproutType: SproutTypeId;
  mesh: Mesh;
  material: PBRMetallicRoughnessMaterial;
  state: SproutVisualState;
  tile: TileCoord;
  held: boolean;
  settledHabitat: HabitatId | null;
  wanderSeed: number;
}

export interface SproutManager {
  get: (id: string) => SproutVisual | undefined;
  all: () => SproutVisual[];
  meshes: () => Mesh[];
  setDragPosition: (id: string, worldX: number, worldZ: number) => void;
  setDragValidity: (id: string, valid: boolean | null) => void;
  update: (motion: MotionConfig, nowMs: number) => void;
  dispose: () => void;
}

function parseHexColor(hex: string | undefined, fallback: Color3): Color3 {
  if (!hex) return fallback;
  const match = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!match) return fallback;
  return Color3.FromHexString(hex);
}

const TYPE_FALLBACK_COLOR: Record<SproutTypeId, Color3> = {
  ember: new Color3(0.9, 0.4, 0.25),
  dew: new Color3(0.4, 0.65, 0.9),
  sun: new Color3(0.95, 0.8, 0.3),
  star: new Color3(0.75, 0.55, 0.95),
};

export function createSproutManager(scene: Scene, bus: EventBus): SproutManager {
  const visuals = new Map<string, SproutVisual>();

  const textureKey = (type: SproutTypeId, state: 'idle' | 'walk' | 'happy' | 'reveal'): string =>
    `sprout.${type}.${state}`;

  const setState = (visual: SproutVisual, state: SproutVisualState): void => {
    visual.state = state;
    const key = state === 'settled' ? 'happy' : state;
    if (key === 'idle' || key === 'walk' || key === 'happy' || key === 'reveal') {
      swapManifestMaterialTexture(scene, visual.material, textureKey(visual.sproutType, key));
    }
  };

  const spawn = (id: string, sproutType: SproutTypeId, podId: string): void => {
    void podId;
    if (visuals.has(id)) return;
    const nurseryWorld = tileToWorld(NURSERY_TILE);
    const mesh = MeshBuilder.CreatePlane(`terrarium.sprout.${id}`, { size: SPROUT_SPRITE_SIZE }, scene);
    mesh.billboardMode = Mesh.BILLBOARDMODE_Y;
    mesh.position.set(nurseryWorld.x, SPROUT_FLOAT_HEIGHT, nurseryWorld.z);
    mesh.scaling.set(0.01, 0.01, 0.01); // pop-in from nothing during reveal
    mesh.isPickable = true;

    const fallback = parseHexColor(SPROUT_TYPES[sproutType]?.primaryColor, TYPE_FALLBACK_COLOR[sproutType]);
    const material = createManifestMaterial(scene, `terrarium.sprout.${id}.mat`, textureKey(sproutType, 'reveal'), fallback);
    // Lit, not unlit-disableLighting — the brief explicitly calls out Sprouts
    // as an "interactive focal asset" that must not be a flat unlit sticker.
    // This is safe from the inconsistent-billboard-lighting risk that would
    // normally make a lit camera-facing sprite look odd as the camera
    // orbits: src/render/camera.ts's ArcRotateCamera alpha (yaw) is never
    // rotated by any input path (pan/zoom only), so a BILLBOARDMODE_Y
    // sprite's world-facing direction — and therefore its lit response to
    // the fixed key light — is constant for the whole session, not
    // per-frame-varying. Roughness/metallic stay at PBRMetallicRoughnessMaterial
    // defaults (waxy/matte, non-metal); a modest emissive keeps the design
    // readable even in the fill light's cooler shadow side.
    material.roughness = 0.55;
    material.metallic = 0;
    material.emissiveColor = fallback.scale(0.35);
    mesh.material = material;

    const visual: SproutVisual = {
      id,
      sproutType,
      mesh,
      material,
      state: 'reveal',
      tile: NURSERY_TILE,
      held: false,
      settledHabitat: null,
      wanderSeed: Math.random() * 1000,
    };
    mesh.metadata = { kind: 'sprout', sproutId: id };
    visuals.set(id, visual);

    // Emitted from the mound's top face, not the tile centre: the burst adds
    // its own +0.3 internally, so a tile-centre y of 0 put the whole reveal
    // sparkle at 0.30 — inside a mound whose top face is at 0.70.
    createSparkleBurst(scene, { x: nurseryWorld.x, y: nurseryTopY(), z: nurseryWorld.z }, { count: 16, color: undefined });

    const revealStart = performance.now();
    const observer = scene.onBeforeRenderObservable.add(() => {
      const durationMs = 420; // reveal always plays at a fixed, readable pace regardless of motion config's ambient scaling
      const t = Math.min(1, (performance.now() - revealStart) / durationMs);
      const eased = easingFn('bounce')(t);
      const scale = 0.01 + eased * 0.99;
      mesh.scaling.set(scale, scale, scale);
      if (t >= 1) {
        scene.onBeforeRenderObservable.remove(observer);
        mesh.scaling.set(1, 1, 1);
        if (visual.state === 'reveal') setState(visual, 'idle');
      }
    });
  };

  const remove = (id: string): void => {
    const visual = visuals.get(id);
    if (!visual) return;
    visual.mesh.dispose();
    visual.material.dispose();
    visuals.delete(id);
  };

  const unsubscribers = [
    bus.subscribe('sprout:spawned', (e) => spawn(e.sproutId, e.sproutType, e.podId)),
    bus.subscribe('sprout:pickedUp', (e) => {
      const visual = visuals.get(e.sproutId);
      if (!visual) return;
      visual.held = true;
      setState(visual, 'walk');
    }),
    bus.subscribe('sprout:dropped', (e) => {
      const visual = visuals.get(e.sproutId);
      if (!visual) return;
      visual.held = false;
      if (!e.overHabitat) setState(visual, 'idle');
    }),
    bus.subscribe('sprout:placed:correct', (e) => {
      const visual = visuals.get(e.sproutId);
      if (!visual) return;
      setState(visual, 'happy');
      createSparkleBurst(scene, { x: visual.mesh.position.x, y: visual.mesh.position.y, z: visual.mesh.position.z }, { count: 20 });
    }),
    bus.subscribe('sprout:placed:incorrect', (e) => {
      const visual = visuals.get(e.sproutId);
      if (!visual) return;
      // Friendly retry: walk back toward the nursery, no fail-state framing
      // (a gentle habitat wobble plays separately, see habitats.ts).
      setState(visual, 'walk');
      const from = { x: visual.mesh.position.x, z: visual.mesh.position.z };
      const nurseryWorld = tileToWorld(NURSERY_TILE);
      const durationMs = 480;
      const start = performance.now();
      const observer = scene.onBeforeRenderObservable.add(() => {
        const t = Math.min(1, (performance.now() - start) / durationMs);
        const eased = easingFn('easeOut')(t);
        visual.mesh.position.x = from.x + (nurseryWorld.x - from.x) * eased;
        visual.mesh.position.z = from.z + (nurseryWorld.z - from.z) * eased;
        if (t >= 1) {
          scene.onBeforeRenderObservable.remove(observer);
          visual.tile = NURSERY_TILE;
          if (visual.state === 'walk') setState(visual, 'idle');
        }
      });
    }),
    bus.subscribe('sprout:settled', (e) => {
      const visual = visuals.get(e.sproutId);
      if (!visual) return;
      visual.settledHabitat = e.habitatId;
      visual.mesh.isPickable = false;
      setState(visual, 'settled');
      const habitatTile = HABITAT_TILES[e.habitatId];
      const world = tileToWorld(habitatTile);
      // Deterministic slot on the habitat's viewer-facing side so multiple
      // settled Sprouts neither overlap each other nor hide behind the
      // habitat's standee card — see sproutSettleOffset.
      const alreadySettled = Array.from(visuals.values()).filter(
        (v) => v.settledHabitat === e.habitatId && v.id !== e.sproutId,
      ).length;
      const offset = sproutSettleOffset(alreadySettled);
      visual.mesh.position.set(world.x + offset.x, sproutSettleHeight(e.habitatId), world.z + offset.z);
    }),
    bus.subscribe('sprout:transportStarted', (e) => {
      const visual = visuals.get(e.sproutId);
      if (!visual) return;
      setState(visual, 'walk');
      const from = tileToWorld(e.fromTile);
      const to = tileToWorld(e.toTile);
      const distanceTiles = Math.max(1, Math.abs(e.toTile.x - e.fromTile.x) + Math.abs(e.toTile.z - e.fromTile.z));
      const durationMs = 420 * distanceTiles;
      const start = performance.now();
      const observer = scene.onBeforeRenderObservable.add(() => {
        const t = Math.min(1, (performance.now() - start) / durationMs);
        visual.mesh.position.x = from.x + (to.x - from.x) * t;
        visual.mesh.position.z = from.z + (to.z - from.z) * t;
        visual.mesh.position.y = SPROUT_FLOAT_HEIGHT + Math.sin(t * Math.PI) * 0.25;
        if (t >= 1) {
          scene.onBeforeRenderObservable.remove(observer);
          visual.tile = e.toTile;
        }
      });
    }),
    bus.subscribe('sprout:transportCompleted', (e) => {
      const visual = visuals.get(e.sproutId);
      if (!visual) return;
      setState(visual, 'idle');
    }),
  ];

  const setDragPosition = (id: string, worldX: number, worldZ: number): void => {
    const visual = visuals.get(id);
    if (!visual || !visual.held) return;
    visual.mesh.position.x = worldX;
    visual.mesh.position.z = worldZ;
    visual.mesh.position.y = SPROUT_FLOAT_HEIGHT;
  };

  /**
   * Tints the dragged Sprout itself so the "ghost" being carried reads as
   * valid (bright/normal) vs invalid (dim/red-tinge) drop target, alongside
   * the habitat-level highlight in habitats.ts. `null` clears the tint.
   */
  const setDragValidity = (id: string, valid: boolean | null): void => {
    const visual = visuals.get(id);
    if (!visual) return;
    const base = parseHexColor(SPROUT_TYPES[visual.sproutType]?.primaryColor, TYPE_FALLBACK_COLOR[visual.sproutType]);
    if (valid === false) {
      visual.material.emissiveColor = new Color3(0.35, 0.08, 0.08);
      visual.mesh.visibility = 0.6;
    } else if (valid === true) {
      visual.material.emissiveColor = base.scale(1.1);
      visual.mesh.visibility = 1;
    } else {
      visual.material.emissiveColor = base.scale(0.9);
      visual.mesh.visibility = 1;
    }
  };

  const update = (motion: MotionConfig, nowMs: number): void => {
    for (const visual of visuals.values()) {
      if (visual.held || visual.state === 'reveal' || visual.state === 'settled') continue;
      if (motion.ambientIntensity <= 0) {
        visual.mesh.position.y = SPROUT_FLOAT_HEIGHT;
        continue;
      }
      const bob = Math.sin(nowMs / 500 + visual.wanderSeed) * SPROUT_BOB_AMPLITUDE * motion.ambientIntensity;
      visual.mesh.position.y = SPROUT_FLOAT_HEIGHT + bob;
    }
  };

  const dispose = (): void => {
    for (const unsub of unsubscribers) unsub();
    for (const id of Array.from(visuals.keys())) remove(id);
  };

  return {
    get: (id) => visuals.get(id),
    all: () => Array.from(visuals.values()),
    meshes: () => Array.from(visuals.values()).map((v) => v.mesh),
    setDragPosition,
    setDragValidity,
    update,
    dispose,
  };
}
