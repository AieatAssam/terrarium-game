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

/** Classic 3/4 iso-ish yaw. Exported because it is a standing INVARIANT that
 * other render modules depend on: no input path ever rotates alpha (pan and
 * zoom only — see the note below on deliberately not calling attachControl),
 * so the world direction "toward the viewer" is fixed for the whole session.
 * src/render/sprouts.ts uses that to park settled Sprouts on the camera-facing
 * side of a habitat's standee card, and relies on the same invariant for
 * billboard lighting stability. */
export const GARDEN_CAMERA_ALPHA = -Math.PI / 2 - Math.PI / 4;
const ISO_ALPHA = GARDEN_CAMERA_ALPHA;
const ISO_BETA = Math.PI / 2.9; // ~62deg from vertical
/**
 * Default framing distance. Pulled in from 19 to 15 (2026-08-01,
 * first-session settle-loop pass).
 *
 * GameRules §4.2 asks for two things at once: default framing that shows the
 * Nursery, the active habitats and the main paths, AND "important interaction
 * targets remain comfortably large at default zoom". The second was failing —
 * a Sprout measured ~20x22 CSS pixels at radius 19, small enough that a
 * deliberate pointer-down missed it and fell through to a camera pan (see
 * work_progress.yaml's `missed-pick-falls-through-to-pan`, reproduced during
 * this pass). 15 keeps the whole garden — all three habitats, the Nursery and
 * both path spurs — inside the frame, verified in-browser rather than
 * assumed, while making every interaction target ~27% larger on screen.
 */
const DEFAULT_RADIUS = 15;
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
