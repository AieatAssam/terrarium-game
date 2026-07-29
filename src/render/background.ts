// Calm ambient "alive" motion: a handful of slow-drifting light motes above
// the garden plus a very subtle breathing shift in the sky/clear color. Both
// scale with MotionConfig.backgroundMotion (0 under reduced motion) and
// particleDensity (quality-scaled).

import { Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { ParticleSystem } from '@babylonjs/core/Particles/particleSystem';
import '@babylonjs/core/Particles/particleSystemComponent';
import type { Scene } from '@babylonjs/core/scene';

import { gridCenterWorld } from './coords';
import type { MotionConfig } from './motion';

const BASE_CLEAR_COLOR = new Color4(0.043, 0.078, 0.063, 1);
const BREATH_CLEAR_COLOR = new Color4(0.06, 0.1, 0.08, 1);

export interface GardenBackground {
  update: (motion: MotionConfig) => void;
  dispose: () => void;
}

export function createGardenBackground(scene: Scene): GardenBackground {
  scene.clearColor = BASE_CLEAR_COLOR.clone();

  const center = gridCenterWorld();
  const motes = new ParticleSystem('terrarium.ambientMotes', 60, scene);
  motes.emitter = new Vector3(center.x, 6, center.z);
  motes.minEmitBox = new Vector3(-9, 0, -9);
  motes.maxEmitBox = new Vector3(9, 3, 9);
  motes.color1 = new Color4(1, 0.95, 0.8, 0.35);
  motes.color2 = new Color4(0.85, 1, 0.9, 0.25);
  motes.colorDead = new Color4(1, 1, 1, 0);
  motes.minSize = 0.03;
  motes.maxSize = 0.09;
  motes.minLifeTime = 6;
  motes.maxLifeTime = 11;
  motes.emitRate = 3;
  motes.minEmitPower = 0.05;
  motes.maxEmitPower = 0.15;
  motes.direction1 = new Vector3(-0.15, 0.1, -0.15);
  motes.direction2 = new Vector3(0.15, 0.3, 0.15);
  motes.gravity = new Vector3(0, 0, 0);
  motes.blendMode = ParticleSystem.BLENDMODE_ADD;
  // No texture assigned here on purpose: without particleTexture Babylon
  // renders a flat quad using vertex color, which is enough for a distant
  // "light mote" and avoids depending on assets.ts before the manifest
  // exists.
  motes.start();

  let elapsedMs = 0;

  const update = (motion: MotionConfig): void => {
    motes.emitRate = 3 * motion.backgroundMotion * motion.particleDensity;

    if (motion.backgroundMotion <= 0) {
      scene.clearColor = BASE_CLEAR_COLOR.clone();
      return;
    }

    elapsedMs += 16.7;
    const breathe = (Math.sin(elapsedMs / 9000) + 1) / 2; // slow ~19s cycle, gentle
    scene.clearColor = Color4.Lerp(BASE_CLEAR_COLOR, BREATH_CLEAR_COLOR, breathe * 0.5 * motion.backgroundMotion);
  };

  const dispose = (): void => {
    motes.dispose();
  };

  return { update, dispose };
}
