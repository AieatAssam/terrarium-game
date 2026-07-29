// The three habitat areas (Ember Nook / Dew Pond / Sunflower Meadow):
// base meshes + their "visibly react to correct Sprouts" behavior (glow
// pulse + particle burst, ripple for Dew Pond) and a gentle, non-punishing
// wobble on an incorrect placement ("friendly retry", never a fail state).

import { Color3 } from '@babylonjs/core/Maths/math.color';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { PBRMetallicRoughnessMaterial } from '@babylonjs/core/Materials/PBR/pbrMetallicRoughnessMaterial';
import type { Scene } from '@babylonjs/core/scene';
import type { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';

import { swapManifestMaterialTexture } from './assets';
import { tileToWorld, tileDistance, type TileCoord } from './coords';
import { attachStandee } from './flatArt';
import { HABITAT_TILES } from './layout';
import type { MotionConfig } from './motion';
import { createRippleRing, createSparkleBurst } from './particles';
import { createStoneBodyMaterial } from './pbrMaterials';
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
  baseEmissive: Color3;
}

/** Per-habitat body dimensions, mirrored from buildHabitatMesh below so the
 * flat art cap can be sized/positioned to sit exactly on each drum's top
 * face without re-deriving MeshBuilder's own math. */
const HABITAT_DIMS: Record<HabitatId, { halfHeight: number; topRadius: number }> = {
  emberNook: { halfHeight: 0.25, topRadius: 1.1 },
  dewPond: { halfHeight: 0.125, topRadius: 1.3 },
  sunflowerMeadow: { halfHeight: 0.2, topRadius: 1.3 },
};

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
    // occlude a settled Sprout resting on top at SPROUT_FLOAT_HEIGHT
    // (src/render/sprouts.ts, y=0.55-0.8) — verified in browser QA, see
    // docs/ART_QA_REPORT.md.
    const dims = HABITAT_DIMS[id];
    const standeeSize = dims.topRadius * 0.9;
    const cap = attachStandee(
      scene,
      mesh,
      `terrarium.habitat.${id}.cap`,
      `habitat.${id}.base`,
      HABITAT_FALLBACK_COLOR[id],
      standeeSize,
      standeeSize,
      dims.halfHeight + standeeSize / 2,
    );
    cap.material.emissiveColor = Color3.Black();

    visuals[id] = {
      id,
      mesh,
      material: cap.material,
      bodyMaterial,
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
