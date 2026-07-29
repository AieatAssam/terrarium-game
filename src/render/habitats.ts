// The three habitat areas (Ember Nook / Dew Pond / Sunflower Meadow):
// base meshes + their "visibly react to correct Sprouts" behavior (glow
// pulse + particle burst, ripple for Dew Pond) and a gentle, non-punishing
// wobble on an incorrect placement ("friendly retry", never a fail state).

import { Color3 } from '@babylonjs/core/Maths/math.color';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { Scene } from '@babylonjs/core/scene';
import type { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';

import { createManifestMaterial, swapManifestMaterialTexture } from './assets';
import { tileToWorld, tileDistance, type TileCoord } from './coords';
import { HABITAT_TILES } from './layout';
import type { MotionConfig } from './motion';
import { createRippleRing, createSparkleBurst } from './particles';
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
  material: StandardMaterial;
  tile: TileCoord;
  worldCenter: { x: number; y: number; z: number };
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

function buildHabitatMesh(scene: Scene, id: HabitatId): Mesh {
  switch (id) {
    case 'emberNook':
      return MeshBuilder.CreateCylinder(`terrarium.habitat.${id}`, { height: 0.5, diameter: 2.2, tessellation: 6 }, scene);
    case 'dewPond':
      return MeshBuilder.CreateCylinder(`terrarium.habitat.${id}`, { height: 0.25, diameter: 2.6, tessellation: 28 }, scene);
    case 'sunflowerMeadow':
    default:
      return MeshBuilder.CreateCylinder(`terrarium.habitat.${id}`, { height: 0.4, diameterTop: 2.6, diameterBottom: 2.2, tessellation: 8 }, scene);
  }
}

export function createHabitatManager(scene: Scene, shadowGenerator: ShadowGenerator): HabitatManager {
  const visuals = {} as Record<HabitatId, HabitatVisual>;

  for (const id of Object.keys(HABITAT_TILES) as HabitatId[]) {
    const tile = HABITAT_TILES[id];
    const world = tileToWorld(tile);
    const mesh = buildHabitatMesh(scene, id);
    mesh.position.set(world.x, 0.2, world.z);
    mesh.receiveShadows = true;
    mesh.isPickable = true;
    mesh.metadata = { kind: 'habitat', habitatId: id, tile };
    shadowGenerator.addShadowCaster(mesh);

    const material = createManifestMaterial(scene, `terrarium.habitat.${id}.mat`, `habitat.${id}.base`, HABITAT_FALLBACK_COLOR[id]);
    material.emissiveColor = Color3.Black();
    mesh.material = material;

    visuals[id] = {
      id,
      mesh,
      material,
      tile,
      worldCenter: world,
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

  const setHover = (id: HabitatId | null, valid: boolean | null): void => {
    for (const visual of Object.values(visuals)) {
      if (visual.id !== id) {
        visual.material.emissiveColor = Color3.Black();
        visual.mesh.scaling.set(1, 1, 1);
        continue;
      }
      if (valid === true) {
        visual.material.emissiveColor = HABITAT_GLOW_COLOR[id].scale(0.35);
        visual.mesh.scaling.set(1.05, 1.05, 1.05);
      } else if (valid === false) {
        visual.material.emissiveColor = new Color3(0.15, 0.05, 0.05);
        visual.mesh.scaling.set(0.97, 0.97, 0.97);
      } else {
        visual.material.emissiveColor = Color3.Black();
        visual.mesh.scaling.set(1, 1, 1);
      }
    }
  };

  const reactCorrect = (id: HabitatId, motion: MotionConfig): void => {
    const visual = visuals[id];
    visual.mesh.scaling.set(1, 1, 1);
    createSparkleBurst(scene, visual.worldCenter, {
      color: undefined,
      count: Math.round(28 * motion.particleDensity) || 1,
    });
    if (id === 'dewPond') createRippleRing(scene, visual.worldCenter, 900 * (motion.backgroundMotion > 0 ? 1 : 0.6));

    swapManifestMaterialTexture(scene, visual.material, `habitat.${id}.base`); // re-affirm base texture in case a future "growth" variant key gets swapped in on repeated correct placements

    const durationMs = motion.placementDurationMs;
    const start = performance.now();
    const glow = HABITAT_GLOW_COLOR[id];
    const observer = scene.onBeforeRenderObservable.add(() => {
      const t = Math.min(1, (performance.now() - start) / durationMs);
      const pulse = Math.sin(Math.min(1, t) * Math.PI); // up then down within the duration
      visual.material.emissiveColor = glow.scale(0.6 * pulse);
      const bump = 1 + 0.12 * motion.ambientIntensity * pulse + (motion.ambientIntensity === 0 ? 0.04 * pulse : 0);
      visual.mesh.scaling.set(bump, bump, bump);
      if (t >= 1) {
        scene.onBeforeRenderObservable.remove(observer);
        visual.material.emissiveColor = Color3.Black();
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
      visual.mesh.dispose();
      visual.material.dispose();
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
