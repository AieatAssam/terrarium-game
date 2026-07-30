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

import { getManifestContentBBox, loadManifest, reloadManifest } from './assets';
import { createAutomationManager, isBuildableTile, type AutomationManager } from './automation';
import { createGardenBackground, type GardenBackground } from './background';
import { createGardenCamera, type GardenCamera } from './camera';
import { createHabitatManager, type HabitatManager } from './habitats';
import { createGardenLighting, type GardenLighting } from './lighting';
import { getMotionConfig, prefersReducedMotion, watchReducedMotion } from './motion';
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
    const { Frustum } = await import('@babylonjs/core/Maths/math.frustum');
    (window as unknown as { __debug: unknown }).__debug = {
      project: (x: number, y: number, z: number) => {
        const vp = camera.camera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight());
        const v = Vector3.Project(new Vector3(x, y, z), Matrix.Identity(), scene.getTransformMatrix(), vp);
        return v.asArray();
      },
      // Mesh-name enumerator. Several QA questions ("is a settled Sprout's
      // card bottom edge above the drum top?") need meshInfoDeep on a mesh
      // whose name embeds a sim-generated id, so it can't be spelled out
      // ahead of time — this lists what's actually in the scene so the
      // follow-up inspection can target it.
      meshNames: (filter?: string) =>
        scene.meshes.map((m) => m.name).filter((n) => (filter ? n.includes(filter) : true)),
      // Vertical extents of every mesh matching a name filter, plus the
      // whole scene's triangle count — the two things an art pass needs to
      // check "does this sit clear of that" and "did poly count blow up"
      // without reading numbers off a screenshot.
      extents: (filter: string) =>
        scene.meshes
          .filter((m) => m.name.includes(filter))
          .map((m) => {
            m.computeWorldMatrix(true);
            const bb = m.getBoundingInfo().boundingBox;
            return {
              name: m.name,
              minY: Number(bb.minimumWorld.y.toFixed(4)),
              maxY: Number(bb.maximumWorld.y.toFixed(4)),
              tris: m.getTotalIndices() / 3,
            };
          }),
      sceneTriangles: () => scene.meshes.reduce((sum, m) => sum + m.getTotalIndices() / 3, 0),
      fps: () => Number(engine.getFps().toFixed(1)),
      // Scene-graph inspector for diagnosing "mesh present but not visibly
      // rendering" bugs (missing vs. mispositioned vs. invisible vs. unlit)
      // without guessing from a screenshot alone.
      meshInfo: (name: string) => {
        const m = scene.getMeshByName(name);
        return (
          m && {
            pos: m.getAbsolutePosition().asArray(),
            scaling: m.scaling.asArray(),
            visibility: m.visibility,
            isVisible: m.isVisible,
            enabled: m.isEnabled(),
            ready: m.material?.isReady(m),
            hasTexture: !!(m.material as { diffuseTexture?: unknown; albedoTexture?: unknown })?.diffuseTexture ||
              !!(m.material as { diffuseTexture?: unknown; albedoTexture?: unknown })?.albedoTexture,
            billboardMode: m.billboardMode,
            parent: m.parent?.name ?? null,
          }
        );
      },
      meshInfoDeep: (name: string) => {
        const m = scene.getMeshByName(name);
        if (!m) return null;
        m.computeWorldMatrix(true);
        const bi = m.getBoundingInfo();
        const mat = m.material as {
          alpha?: number;
          needAlphaBlending?: () => boolean;
          backFaceCulling?: boolean;
          diffuseTexture?: { isReady: () => boolean; getSize: () => { width: number; height: number } };
        } | null;
        return {
          worldMatrixRow3: m.getWorldMatrix().getRow(3)?.asArray(),
          boundingBoxMin: bi.boundingBox.minimumWorld.asArray(),
          boundingBoxMax: bi.boundingBox.maximumWorld.asArray(),
          renderingGroupId: m.renderingGroupId,
          alphaIndex: m.alphaIndex,
          isReallyVisible: (m as unknown as { isVisible: boolean }).isVisible && m.isEnabled() && m.material != null,
          totalVertices: m.getTotalVertices(),
          matAlpha: mat?.alpha,
          matNeedsAlphaBlending: mat?.needAlphaBlending?.(),
          matBackFaceCulling: mat?.backFaceCulling,
          texReady: mat?.diffuseTexture?.isReady?.(),
          texSize: mat?.diffuseTexture?.getSize?.(),
          layerMask: (m as unknown as { layerMask?: number }).layerMask,
          cameraLayerMask: camera.camera.layerMask,
          isInFrustum: m.isInFrustum(Frustum.GetPlanes(scene.getTransformMatrix())),
        };
      },
      // Content-crop inspector for the standee texture-cropping fix in
      // flatArt.ts (attachStandee) — reports the opaque-content bounding box
      // computed for a manifest key's rasterized texture, in 0..1 UV
      // fractions. Undefined until that key's texture has finished loading.
      contentBBox: (key: string) => getManifestContentBBox(key),
      sceneInfo: () => ({
        clearColor: scene.clearColor.asArray(),
        ambientColor: scene.ambientColor.asArray(),
        lights: scene.lights.map((l) => ({ name: l.name, intensity: l.intensity })),
        environmentTexture: scene.environmentTexture
          ? { ready: scene.environmentTexture.isReady(), intensity: scene.environmentIntensity }
          : null,
        meshCount: scene.meshes.length,
        activeCamera: scene.activeCamera?.name,
      }),
      // QA helper: reposition the ArcRotateCamera directly (bypassing the
      // camera's own clamped pan/zoom API) so a close-up/side-on inspection
      // shot can be taken without dragging the mouse through it — used for
      // art QA passes (docs/ART_QA_REPORT.md).
      qaCamera: (alpha: number, beta: number, radius: number, targetX?: number, targetY?: number, targetZ?: number) => {
        camera.camera.alpha = alpha;
        camera.camera.beta = beta;
        camera.camera.radius = radius;
        if (targetX !== undefined && targetY !== undefined && targetZ !== undefined) {
          camera.camera.target.set(targetX, targetY, targetZ);
        }
        return {
          alpha: camera.camera.alpha,
          beta: camera.camera.beta,
          radius: camera.camera.radius,
          target: camera.camera.target.asArray(),
        };
      },
    };
  }
  const lighting = createGardenLighting(scene);
  const background = createGardenBackground(scene);
  // `bus` so the world can subscribe to `upgrade:purchased` and reveal the
  // first decorative expansion (GameRules §6.6) — same pattern the Sprout and
  // automation managers below already use.
  const world = buildGardenWorld(scene, lighting.shadowGenerator, bus);
  const habitats = createHabitatManager(scene, lighting.shadowGenerator);
  const sprouts = createSproutManager(scene, bus);
  const automation = createAutomationManager(scene, bus, lighting.shadowGenerator);
  const stopVisibilityThrottle = installVisibilityThrottle(engine, scene);

  lighting.setQuality(getQualityLevel());
  const stopQualityWatch = onQualityChange((level) => lighting.setQuality(level));

  // Tracks the RESOLVED reduced-motion preference: the OS media query, plus
  // the Settings panel's own toggle (reflected onto <html data-reduced-motion>
  // by src/ui/prefs.ts). Previously this only watched the media query, so a
  // player who turned "Reduced motion" on in-game still got the full ambient
  // animation set — see watchReducedMotion's doc comment.
  let reducedMotion = prefersReducedMotion();
  const stopReducedMotionWatch = watchReducedMotion((reduced) => {
    reducedMotion = reduced;
  });

  const renderObserver = scene.onBeforeRenderObservable.add(() => {
    const motion = getMotionConfig(reducedMotion, getQualityLevel());
    background.update(motion);
    sprouts.update(motion, performance.now());
    world.update(motion, performance.now());
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
    stopReducedMotionWatch();
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
