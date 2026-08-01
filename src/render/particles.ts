// Shared particle/effect helpers: sparkle/glow bursts (habitat reactions,
// placement confirmation) and a soft expanding ripple ring (Dew Pond feel).
// All one-shot effects clean themselves up (disposeOnStop / timed disposal)
// so callers don't need to track handles for anything but the ambient
// (long-lived) background system.

import { Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
// Side-effect imports: register createDynamicTexture on whichever backend
// src/core/engine.ts picked (WebGPU when available, else WebGL) — bootstrap.ts
// tries WebGPU first, and neither Engine (WebGL/engine.js) nor WebGPUEngine
// (webgpuEngine.js) auto-imports its own engine.dynamicTexture extension
// (unlike e.g. renderTarget/renderTargetTexture, which both engines DO
// self-register). Deep-imported Babylon modules don't auto-register engine
// extensions in general, so without these `new DynamicTexture(...)` throws
// "createDynamicTexture is not a function" at runtime only — typecheck/lint
// stay green, and it only surfaced on this dev machine because it happens to
// resolve WebGPU as supported. Importing both is harmless when only one
// backend is actually active.
import '@babylonjs/core/Engines/Extensions/engine.dynamicTexture';
import '@babylonjs/core/Engines/WebGPU/Extensions/engine.dynamicTexture';
import { ParticleSystem } from '@babylonjs/core/Particles/particleSystem';
// Side-effect import: registers the particle system scene component.
import '@babylonjs/core/Particles/particleSystemComponent';
import type { Scene } from '@babylonjs/core/scene';

let sharedDotTexture: DynamicTexture | undefined;

/** A small soft-edged white circle, reused as the base texture for every particle system (tinted per-effect via particle color). */
function getSoftDotTexture(scene: Scene): DynamicTexture {
  if (sharedDotTexture) return sharedDotTexture;
  const size = 64;
  const texture = new DynamicTexture('terrarium.softDot', size, scene, false);
  const ctx = texture.getContext() as unknown as CanvasRenderingContext2D;
  const r = size / 2;
  const gradient = ctx.createRadialGradient(r, r, 0, r, r, r);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.5, 'rgba(255,255,255,0.6)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  texture.update();
  sharedDotTexture = texture;
  return texture;
}

export interface BurstOptions {
  color?: Color4;
  count?: number;
  spread?: number;
  speed?: number;
  sizeMin?: number;
  sizeMax?: number;
  lifeMs?: number;
}

/** One-shot sparkle/glow burst at a world position. Self-disposes once finished. */
export function createSparkleBurst(
  scene: Scene,
  position: { x: number; y: number; z: number },
  options: BurstOptions = {},
): ParticleSystem {
  const system = new ParticleSystem('terrarium.sparkleBurst', Math.max(1, options.count ?? 24), scene);
  system.particleTexture = getSoftDotTexture(scene);
  system.emitter = new Vector3(position.x, position.y + 0.3, position.z);
  system.minEmitBox = new Vector3(-0.15, 0, -0.15);
  system.maxEmitBox = new Vector3(0.15, 0.1, 0.15);
  system.color1 = options.color ?? new Color4(1, 0.92, 0.55, 1);
  system.color2 = options.color ?? new Color4(1, 0.75, 0.4, 1);
  system.colorDead = new Color4(1, 1, 1, 0);
  system.minSize = options.sizeMin ?? 0.06;
  system.maxSize = options.sizeMax ?? 0.16;
  const lifeMs = options.lifeMs ?? 650;
  system.minLifeTime = lifeMs / 1000;
  system.maxLifeTime = (lifeMs / 1000) * 1.3;
  system.emitRate = 0; // manual burst via manualEmitCount below
  system.manualEmitCount = Math.max(1, options.count ?? 24);
  system.minEmitPower = (options.speed ?? 1) * 0.6;
  system.maxEmitPower = (options.speed ?? 1) * 1.4;
  system.direction1 = new Vector3(-0.5, 1, -0.5);
  system.direction2 = new Vector3(0.5, 1.6, 0.5);
  system.gravity = new Vector3(0, -1.2, 0);
  system.blendMode = ParticleSystem.BLENDMODE_ADD;
  system.disposeOnStop = true;
  system.targetStopDuration = 0.05;
  system.start();
  return system;
}

/** A soft expanding, fading ring — used for the Dew Pond ripple reaction. Cleans itself up via setTimeout-scoped disposal. */
export function createRippleRing(
  scene: Scene,
  position: { x: number; y: number; z: number },
  durationMs = 900,
  color: Color3 = new Color3(0.55, 0.8, 0.95),
): void {
  const ring = MeshBuilder.CreateDisc('terrarium.ripple', { radius: 0.35, tessellation: 32 }, scene);
  ring.rotation.x = Math.PI / 2;
  ring.position = new Vector3(position.x, position.y + 0.02, position.z);
  const material = new StandardMaterial('terrarium.ripple.mat', scene);
  material.diffuseColor = color;
  material.emissiveColor = color;
  material.alpha = 0.55;
  material.backFaceCulling = false;
  ring.material = material;
  ring.isPickable = false;

  const start = performance.now();
  const observer = scene.onBeforeRenderObservable.add(() => {
    const t = Math.min(1, (performance.now() - start) / durationMs);
    const scale = 0.4 + t * 2.2;
    ring.scaling.set(scale, scale, scale);
    material.alpha = 0.55 * (1 - t);
    if (t >= 1) {
      scene.onBeforeRenderObservable.remove(observer);
      material.dispose();
      ring.dispose();
    }
  });
}

/**
 * A single Dewdrop rising off a habitat and fading — the WORLD-SPACE half of
 * the earning loop.
 *
 * GameRules §5.3 lists a Dewdrop reward among the things a settle must
 * produce, and docs/REFERENCE_BOARD.md's non-negotiable list fails any build
 * where "correct placement only changes a number rather than visibly
 * transforming the world". Before this, `habitat:dewdropTick` had NO
 * subscriber in src/render or src/ui at all: dewdrops moved a HUD counter and
 * nothing else, so a happy, earning habitat was visually identical to an
 * empty one. The transferable lesson from the promoted reward-feedback
 * references (docs/references/tiny-glade/reward-feedback/tiny-glade-01,
 * ooblets/reward-feedback/ooblets-11) is that the reward symbol appears in
 * the world AT the thing that earned it, large enough to read, and lasts long
 * enough to be seen — not in a corner of the HUD.
 *
 * Original expression, not a copied one: a teardrop-proportioned billboard
 * disc in the garden's own dew palette, rising with a slight ease-out and
 * fading, driven by the same onBeforeRenderObservable pattern the ripple ring
 * above already uses.
 *
 * `intensity` comes from MotionConfig so reduced motion gets a shorter, much
 * smaller rise instead of a full float (never zero — the reward must still be
 * legible; GameRules §11 asks for less movement, not less information).
 */
export function createDewdropMote(
  scene: Scene,
  position: { x: number; y: number; z: number },
  intensity = 1,
): void {
  const durationMs = 900;
  const rise = 0.25 + 0.75 * intensity;
  const drop = MeshBuilder.CreateDisc('terrarium.dewdropMote', { radius: 0.1, tessellation: 12 }, scene);
  drop.billboardMode = 7; // Mesh.BILLBOARDMODE_ALL — kept numeric to avoid pulling the Mesh class into this module
  drop.position = new Vector3(position.x, position.y + 0.15, position.z);
  drop.scaling.set(0.8, 1.25, 1); // teardrop proportion rather than a circle
  drop.isPickable = false;

  const color = new Color3(0.62, 0.86, 0.97);
  const material = new StandardMaterial('terrarium.dewdropMote.mat', scene);
  material.diffuseColor = color;
  material.emissiveColor = color;
  material.alpha = 0;
  material.backFaceCulling = false;
  drop.material = material;

  const startY = drop.position.y;
  const start = performance.now();
  const observer = scene.onBeforeRenderObservable.add(() => {
    const t = Math.min(1, (performance.now() - start) / durationMs);
    const eased = 1 - (1 - t) * (1 - t);
    drop.position.y = startY + rise * eased;
    // Fade in over the first fifth, hold, then fade out — so it is at full
    // opacity for most of its life rather than only at one instant.
    material.alpha = 0.9 * Math.min(1, t / 0.2) * (1 - Math.max(0, (t - 0.55) / 0.45));
    if (t >= 1) {
      scene.onBeforeRenderObservable.remove(observer);
      material.dispose();
      drop.dispose();
    }
  });
}

/**
 * Slow warm motes drifting around the lanterns revealed by the first
 * decorative expansion (GameRules §6.6 / §4.1's "fireflies"). Deliberately a
 * SINGLE system with a box emitter spanning the lit area rather than one
 * system per lantern — an unbounded-particle-system-per-object pattern is
 * exactly what GameRules §12 warns against, and at this density the motes
 * read as "the lit part of the garden is alive", not as per-lantern auras.
 *
 * The caller drives `setDensity` from MotionConfig every frame, so reduced
 * motion (backgroundMotion 0) stops emission entirely and the low quality
 * tier thins it, without this module knowing about either preference.
 */
export interface FireflySystem {
  setDensity: (density: number) => void;
  dispose: () => void;
}

export function createFireflies(
  scene: Scene,
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number; y: number },
  baseRate = 6,
): FireflySystem {
  const system = new ParticleSystem('terrarium.fireflies', 90, scene);
  system.particleTexture = getSoftDotTexture(scene);
  system.emitter = new Vector3((bounds.minX + bounds.maxX) / 2, bounds.y, (bounds.minZ + bounds.maxZ) / 2);
  const halfX = (bounds.maxX - bounds.minX) / 2;
  const halfZ = (bounds.maxZ - bounds.minZ) / 2;
  system.minEmitBox = new Vector3(-halfX, -0.1, -halfZ);
  system.maxEmitBox = new Vector3(halfX, 0.55, halfZ);
  system.color1 = new Color4(1, 0.82, 0.42, 0.65);
  system.color2 = new Color4(1, 0.94, 0.66, 0.4);
  system.colorDead = new Color4(1, 0.8, 0.4, 0);
  system.minSize = 0.035;
  system.maxSize = 0.075;
  system.minLifeTime = 3.5;
  system.maxLifeTime = 7;
  system.emitRate = 0; // caller enables via setDensity
  system.minEmitPower = 0.02;
  system.maxEmitPower = 0.09;
  system.direction1 = new Vector3(-0.12, 0.05, -0.12);
  system.direction2 = new Vector3(0.12, 0.22, 0.12);
  system.gravity = new Vector3(0, -0.01, 0);
  system.blendMode = ParticleSystem.BLENDMODE_ADD;
  system.start();
  return {
    setDensity: (density: number) => {
      system.emitRate = baseRate * Math.max(0, density);
    },
    dispose: () => system.dispose(),
  };
}

export function _disposeSharedParticleAssets(): void {
  sharedDotTexture?.dispose();
  sharedDotTexture = undefined;
}
