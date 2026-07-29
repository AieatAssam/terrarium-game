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
import type { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { Scene } from '@babylonjs/core/scene';

import { createManifestMaterial, swapManifestMaterialTexture } from './assets';
import { tileToWorld, type TileCoord } from './coords';
import { HABITAT_TILES, NURSERY_TILE } from './layout';
import { easingFn, type MotionConfig } from './motion';
import { createSparkleBurst } from './particles';
import type { EventBus } from '../events/bus';
import type { HabitatId, SproutTypeId } from '../core/ids';
import { SPROUT_TYPES } from '../data/sproutTypes';

export type SproutVisualState = 'reveal' | 'idle' | 'walk' | 'happy' | 'settled';

// The Nursery mound (world.ts) is 0.7 units tall centered at y=0.35, i.e. its
// top sits at y=0.7. Sprouts spawn standing ON the Nursery, so their resting
// float height has to clear that top surface or the billboard renders
// z-fought/occluded behind the opaque mound — a real bug hit during manual
// QA (a freshly spawned Sprout was invisible). 0.8 clears it with a little
// headroom; used for every "resting"/drag/transport height so they all stay
// visually consistent above ground props (habitats/rocks top out well below
// this).
const SPROUT_FLOAT_HEIGHT = 0.8;

export interface SproutVisual {
  id: string;
  sproutType: SproutTypeId;
  mesh: Mesh;
  material: StandardMaterial;
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
    const mesh = MeshBuilder.CreatePlane(`terrarium.sprout.${id}`, { size: 0.7 }, scene);
    mesh.billboardMode = Mesh.BILLBOARDMODE_Y;
    mesh.position.set(nurseryWorld.x, SPROUT_FLOAT_HEIGHT, nurseryWorld.z);
    mesh.scaling.set(0.01, 0.01, 0.01); // pop-in from nothing during reveal
    mesh.isPickable = true;

    const fallback = parseHexColor(SPROUT_TYPES[sproutType]?.primaryColor, TYPE_FALLBACK_COLOR[sproutType]);
    const material = createManifestMaterial(scene, `terrarium.sprout.${id}.mat`, textureKey(sproutType, 'reveal'), fallback);
    material.disableLighting = true;
    material.emissiveColor = fallback.scale(0.9);
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

    createSparkleBurst(scene, nurseryWorld, { count: 16, color: undefined });

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
      // Small deterministic offset ring so multiple settled Sprouts in the
      // same habitat don't perfectly overlap.
      const count = Array.from(visuals.values()).filter((v) => v.settledHabitat === e.habitatId).length;
      const angle = count * 0.9;
      const radius = 0.35 + (count % 4) * 0.1;
      // 0.55 clears every habitat mesh's top surface (tallest is emberNook at ~0.45).
      visual.mesh.position.set(world.x + Math.cos(angle) * radius, 0.55, world.z + Math.sin(angle) * radius);
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
      const bob = Math.sin(nowMs / 500 + visual.wanderSeed) * 0.05 * motion.ambientIntensity;
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
