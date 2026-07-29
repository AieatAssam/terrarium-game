// Warm key light + soft fill + soft shadows for the cosy terrarium look.

import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
// Side-effect import: registers the shadow generator's scene component so
// shadow map render targets are actually driven each frame. Without this,
// shadows can silently fail to appear despite a ShadowGenerator existing.
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent';
import type { Scene } from '@babylonjs/core/scene';
import { createGardenEnvironment } from './environment';
import type { QualityLevel } from './motion';

export interface GardenLighting {
  key: DirectionalLight;
  fill: HemisphericLight;
  shadowGenerator: ShadowGenerator;
  setQuality: (level: QualityLevel) => void;
  dispose: () => void;
}

export function createGardenLighting(scene: Scene): GardenLighting {
  // Warm afternoon key light.
  const key = new DirectionalLight('keyLight', new Vector3(-0.6, -1.1, -0.4), scene);
  key.position = new Vector3(10, 14, 10);
  key.intensity = 1.9;
  key.diffuse = new Color3(1, 0.86, 0.66);
  key.specular = new Color3(0.4, 0.35, 0.25);

  // Soft cool-shade fill so shadow sides never go pure black.
  const fill = new HemisphericLight('fillLight', new Vector3(0.2, 1, 0.1), scene);
  fill.intensity = 0.55;
  fill.diffuse = new Color3(0.85, 0.92, 1);
  fill.groundColor = new Color3(0.25, 0.32, 0.22);
  fill.specular = new Color3(0, 0, 0);

  // Procedural image-based-lighting environment for PBRMaterial ambient/
  // reflection response (see src/render/environment.ts for provenance/
  // rationale — original, generated in-code, no third-party HDRI).
  const environmentTexture = createGardenEnvironment(scene);

  const shadowGenerator = new ShadowGenerator(1024, key);
  shadowGenerator.useBlurExponentialShadowMap = true;
  shadowGenerator.blurKernel = 24;
  shadowGenerator.darkness = 0.25;
  // Slight bias reduction + normal bias so contact points (Sprouts/habitats
  // meeting the ground) read as grounded soft contact shadows rather than
  // detached/peter-panned or acne-riddled.
  shadowGenerator.bias = 0.0015;
  shadowGenerator.normalBias = 0.02;

  const setQuality = (level: QualityLevel): void => {
    const mapSize = level === 'high' ? 1024 : 512;
    shadowGenerator.getShadowMap()?.resize(mapSize);
    shadowGenerator.useBlurExponentialShadowMap = level === 'high';
  };

  const dispose = (): void => {
    shadowGenerator.dispose();
    environmentTexture.dispose();
    key.dispose();
    fill.dispose();
  };

  return { key, fill, shadowGenerator, setQuality, dispose };
}
