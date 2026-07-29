// Isometric-feeling garden camera. Subagent A's bootstrap deliberately ships
// a placeholder ArcRotateCamera with no attachControl (docs comment in
// src/core/bootstrap.ts) specifically so E owns camera control — this file
// creates the real camera and exposes a small imperative API (pan/zoom/
// frame); it does NOT attach its own DOM pointer/wheel listeners. All raw
// pointer/wheel/touch handling lives in src/input/ so there's exactly one
// place deciding "is this gesture a camera pan/pinch, or a Sprout drag" —
// two independent listeners on the same canvas fighting over the same
// pointerdown was the failure mode to avoid.

import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Scene } from '@babylonjs/core/scene';

import { gridCenterWorld } from './coords';

const ISO_ALPHA = -Math.PI / 2 - Math.PI / 4; // classic 3/4 iso-ish yaw
const ISO_BETA = Math.PI / 3.4; // ~53deg from vertical: reads as "isometric" without going full orthographic
const DEFAULT_RADIUS = 16;
const MIN_RADIUS = 7;
const MAX_RADIUS = 28;
const MIN_BETA = Math.PI / 6;
const MAX_BETA = Math.PI / 2.1;

export interface GardenCamera {
  camera: ArcRotateCamera;
  /** Pans the target across the ground plane. dx/dz are world units, already camera-relative (see input/gestures.ts). */
  panBy: (dx: number, dz: number) => void;
  /** Positive = zoom in (radius shrinks). */
  zoomBy: (delta: number) => void;
  /** Absolute radius set (clamped), used by pinch-zoom which computes a target radius directly rather than a delta. */
  setRadius: (radius: number) => void;
  /** Clamps target back inside a comfortable garden-viewing region; called after pan. */
  clampTarget: () => void;
  dispose: () => void;
}

const GARDEN_BOUNDS_PADDING = 6;

export function createGardenCamera(scene: Scene, _canvas: HTMLCanvasElement): GardenCamera {
  // Dispose the placeholder camera bootstrap.ts installed so it doesn't leak
  // or contend for scene.activeCamera.
  const placeholder = scene.cameras.find((c) => c.name === 'placeholderCamera');
  placeholder?.dispose();

  const center = gridCenterWorld();
  const camera = new ArcRotateCamera(
    'gardenCamera',
    ISO_ALPHA,
    ISO_BETA,
    DEFAULT_RADIUS,
    new Vector3(center.x, center.y, center.z),
    scene,
  );
  camera.lowerRadiusLimit = MIN_RADIUS;
  camera.upperRadiusLimit = MAX_RADIUS;
  camera.lowerBetaLimit = MIN_BETA;
  camera.upperBetaLimit = MAX_BETA;
  camera.fov = 0.55;
  // Deliberately no attachControl(canvas) — src/input owns all pointer/wheel
  // handling and calls panBy/zoomBy below instead.
  scene.activeCamera = camera;

  const clampTarget = (): void => {
    const min = -GARDEN_BOUNDS_PADDING;
    const max = 15 + GARDEN_BOUNDS_PADDING; // GRID_SIZE - 1 + padding, kept as a literal to avoid a sim import here
    camera.target.x = Math.min(max, Math.max(min, camera.target.x));
    camera.target.z = Math.min(max, Math.max(min, camera.target.z));
  };

  const panBy = (dx: number, dz: number): void => {
    camera.target.x += dx;
    camera.target.z += dz;
    clampTarget();
  };

  const zoomBy = (delta: number): void => {
    const next = camera.radius - delta;
    camera.radius = Math.min(MAX_RADIUS, Math.max(MIN_RADIUS, next));
  };

  const setRadius = (radius: number): void => {
    camera.radius = Math.min(MAX_RADIUS, Math.max(MIN_RADIUS, radius));
  };

  return {
    camera,
    panBy,
    zoomBy,
    setRadius,
    clampTarget,
    dispose: () => camera.dispose(),
  };
}
