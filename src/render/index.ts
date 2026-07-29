// Renderer composition root. Builds on top of src/core/bootstrap's
// {engine, scene} — never disposes or replaces them, per the brief ("build
// on top of it, don't replace it") — and wires camera, lighting, background,
// world geometry, habitats, Sprouts, and automation together. src/input/
// imports the returned handle to drive picking/drag against the same
// camera/managers. Gameplay itself (spawning, placement adjudication,
// Dewdrop accrual, automation, upgrades, achievements) lives in
// src/sim/runtime.ts, driven entirely by bus events — this module never
// simulates gameplay, only renders what the bus tells it happened.

import type { Scene } from '@babylonjs/core/scene';
import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine';

import { loadManifest, reloadManifest } from './assets';
import { createAutomationManager, isBuildableTile, type AutomationManager } from './automation';
import { createGardenBackground, type GardenBackground } from './background';
import { createGardenCamera, type GardenCamera } from './camera';
import { createHabitatManager, type HabitatManager } from './habitats';
import { createGardenLighting, type GardenLighting } from './lighting';
import { getMotionConfig, prefersReducedMotion } from './motion';
import { getQualityLevel, onQualityChange } from './quality';
import { createSproutManager, type SproutManager } from './sprouts';
import { installVisibilityThrottle } from './visibility';
import { buildGardenWorld, type GardenWorld } from './world';
import { isDev } from '../core/env';
import type { EventBus } from '../events/bus';

export interface RendererHandle {
  scene: Scene;
  engine: AbstractEngine;
  canvas: HTMLCanvasElement;
  camera: GardenCamera;
  habitats: HabitatManager;
  sprouts: SproutManager;
  automation: AutomationManager;
  world: GardenWorld;
  lighting: GardenLighting;
  background: GardenBackground;
  isBuildableTile: typeof isBuildableTile;
  dispose: () => void;
}

export interface RendererDeps {
  engine: AbstractEngine;
  scene: Scene;
  canvas: HTMLCanvasElement;
  bus: EventBus;
}

export async function initRenderer(deps: RendererDeps): Promise<RendererHandle> {
  const { engine, scene, canvas, bus } = deps;

  await loadManifest();

  // bootstrap.ts creates the engine against `canvas` BEFORE the canvas is
  // attached to the DOM (`root.replaceChildren(canvas)` happens after
  // `createEngine`), so Babylon's initial auto-sizing reads a detached
  // element's clientWidth/clientHeight (0) and falls back to the default
  // 300x150 buffer. bootstrap.ts only re-sizes on a `window resize` event
  // afterward, which never fires on plain page load — so without this call
  // the engine silently renders at 300x150 forever (upscaled by the browser
  // to look fine visually) while `scene.createPickingRay`/`scene.pick`
  // derive screen-to-NDC math from that wrong 300x150 render size, making
  // every pointer coordinate resolve to nonsense. Hit during manual QA:
  // dragging a Sprout always missed and panned the camera instead. By the
  // time this module runs, bootstrap()'s promise has already resolved and
  // the canvas IS in the DOM with its real layout size, so a single resize()
  // here is enough — entirely within src/render, no src/core edit needed.
  engine.resize();

  const camera = createGardenCamera(scene, canvas);
  if (isDev) {
    const { Vector3, Matrix } = await import('@babylonjs/core/Maths/math.vector');
    (window as unknown as { __debug: unknown }).__debug = {
      project: (x: number, y: number, z: number) => {
        const vp = camera.camera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight());
        const v = Vector3.Project(new Vector3(x, y, z), Matrix.Identity(), scene.getTransformMatrix(), vp);
        return v.asArray();
      },
    };
  }
  const lighting = createGardenLighting(scene);
  const background = createGardenBackground(scene);
  const world = buildGardenWorld(scene, lighting.shadowGenerator);
  const habitats = createHabitatManager(scene, lighting.shadowGenerator);
  const sprouts = createSproutManager(scene, bus);
  const automation = createAutomationManager(scene, bus, lighting.shadowGenerator);
  const stopVisibilityThrottle = installVisibilityThrottle(engine, scene);

  lighting.setQuality(getQualityLevel());
  const stopQualityWatch = onQualityChange((level) => lighting.setQuality(level));

  let reducedMotion = prefersReducedMotion();
  const mediaQuery =
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : undefined;
  const handleMotionPrefChange = (): void => {
    reducedMotion = mediaQuery?.matches ?? false;
  };
  mediaQuery?.addEventListener?.('change', handleMotionPrefChange);

  const renderObserver = scene.onBeforeRenderObservable.add(() => {
    const motion = getMotionConfig(reducedMotion, getQualityLevel());
    background.update(motion);
    sprouts.update(motion, performance.now());
  });

  // Subagent C's assets/manifest.json may not exist yet when this session
  // starts. Re-check a few times over the following ~15s so real textures
  // swap in without a page reload if C finishes mid-session; harmless no-op
  // once the manifest is confirmed loaded (reloadManifest short-circuits).
  let integrationChecks = 0;
  const integrationInterval = setInterval(() => {
    integrationChecks += 1;
    void reloadManifest();
    if (integrationChecks >= 5) clearInterval(integrationInterval);
  }, 3000);

  const dispose = (): void => {
    clearInterval(integrationInterval);
    scene.onBeforeRenderObservable.remove(renderObserver);
    mediaQuery?.removeEventListener?.('change', handleMotionPrefChange);
    stopQualityWatch();
    stopVisibilityThrottle();
    automation.dispose();
    sprouts.dispose();
    habitats.dispose();
    world.dispose();
    background.dispose();
    lighting.dispose();
    camera.dispose();
  };

  return { scene, engine, canvas, camera, habitats, sprouts, automation, world, lighting, background, isBuildableTile, dispose };
}

export { getQualityLevel, setQualityLevel } from './quality';
export type { QualityLevel } from './motion';
export { tileToWorld, worldToTile, gridCenterWorld } from './coords';
export type { TileCoord } from './coords';
