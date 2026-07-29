// Procedural image-based-lighting environment for the terrarium's PBR
// materials (docs/ART_DIRECTION.md §8, "Lighting plan"). PBRMaterial needs
// `scene.environmentTexture` to produce believable ambient/reflection
// response — without one, PBR surfaces render flatter and darker than the
// StandardMaterial look they replace (verified during this pass: habitat
// bodies looked dull/plasticky until this was wired up).
//
// Per project rule (docs/ASSET_CREDITS.md), no third-party HDRI/texture may
// be used — this is authored entirely in-code as six flat-shaded canvas
// faces (a warm "sunlight through conservatory glass above, soft green soil
// bounce below" gradient, matching src/render/lighting.ts's key/fill split)
// and assembled into a CubeTexture via data URLs, never touching the
// network. It's deliberately simple/low-frequency: this is ambient fill
// light for a stylised 2.5D scene, not a reflection showpiece.

import { CubeTexture } from '@babylonjs/core/Materials/Textures/cubeTexture';
import type { Scene } from '@babylonjs/core/scene';
// Side-effect imports: this project imports narrow Babylon submodules
// rather than the full bundle (tree-shaking), so the engine methods a
// `files`-based CubeTexture needs (`createCubeTextureBase` on the shared
// AbstractEngine, plus the WebGL and WebGPU `createCubeTexture` overrides
// that call it) aren't registered unless these are imported somewhere.
// Without them: `TypeError: this.createCubeTextureBase is not a function`
// on WebGPU (this project's default backend, src/core/engine.ts) — a real
// bug hit during browser QA, not visible from typecheck/unit tests.
import '@babylonjs/core/Engines/AbstractEngine/abstractEngine.cubeTexture';
import '@babylonjs/core/Engines/Extensions/engine.cubeTexture';
import '@babylonjs/core/Engines/WebGPU/Extensions/engine.cubeTexture';

const FACE_SIZE = 64;

type FaceKind = 'up' | 'down' | 'side';

// Warm key-light color (matches lighting.ts's DirectionalLight.diffuse) at
// the top, soft cool-green soil-bounce (matches HemisphericLight.groundColor)
// at the bottom, with a gentle horizon band on the four side faces so
// reflective/glancing surfaces get a plausible ambient gradient instead of a
// flat color.
const SKY_TOP = '#fff3d9';
const SKY_HORIZON = '#cfead0';
const GROUND_BOUNCE = '#3a4a2e';

function drawFace(kind: FaceKind): string {
  const canvas = document.createElement('canvas');
  canvas.width = FACE_SIZE;
  canvas.height = FACE_SIZE;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;

  if (kind === 'up') {
    const grad = ctx.createRadialGradient(
      FACE_SIZE / 2,
      FACE_SIZE / 2,
      0,
      FACE_SIZE / 2,
      FACE_SIZE / 2,
      FACE_SIZE * 0.75,
    );
    grad.addColorStop(0, SKY_TOP);
    grad.addColorStop(1, SKY_HORIZON);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, FACE_SIZE, FACE_SIZE);
  } else if (kind === 'down') {
    const grad = ctx.createRadialGradient(
      FACE_SIZE / 2,
      FACE_SIZE / 2,
      0,
      FACE_SIZE / 2,
      FACE_SIZE / 2,
      FACE_SIZE * 0.75,
    );
    grad.addColorStop(0, GROUND_BOUNCE);
    grad.addColorStop(1, '#22301c');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, FACE_SIZE, FACE_SIZE);
  } else {
    // Side face: vertical gradient from the warm sky band at the top to the
    // cool ground bounce at the bottom, so upright/vertical surfaces (Sprout
    // billboards, standee caps, habitat walls) get warm-over-cool separation
    // rather than one flat ambient tone.
    const grad = ctx.createLinearGradient(0, 0, 0, FACE_SIZE);
    grad.addColorStop(0, SKY_HORIZON);
    grad.addColorStop(0.55, '#9db98f');
    grad.addColorStop(1, GROUND_BOUNCE);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, FACE_SIZE, FACE_SIZE);
  }
  return canvas.toDataURL('image/png');
}

let cached: CubeTexture | undefined;

/**
 * Builds (once per scene) and returns the procedural environment cube
 * texture, assigning it to `scene.environmentTexture` — but ONLY on the
 * WebGL backend. See the "KNOWN LIMITATION" note below for why WebGPU is
 * excluded; the texture is still built and returned either way so callers
 * (and future debugging) always have a real object to inspect.
 *
 * ==========================================================================
 * KNOWN LIMITATION — scene.environmentTexture disabled on WebGPU
 * ==========================================================================
 * Verified via isolated browser testing during this pass (docs/
 * ART_QA_REPORT.md has the full writeup): assigning ANY CubeTexture built
 * from in-memory image data (data URLs, exactly this project's "no
 * third-party assets" constraint requires) to `scene.environmentTexture`
 * causes every mesh in the scene to stop rendering entirely — a full black
 * canvas, clear color only, with no console error or exception of any
 * kind — specifically on this project's WebGPU backend (Babylon.js
 * v7.54.3, src/core/engine.ts's WebGPU-when-available path). Confirmed by
 * bisection, not guesswork:
 *   - Constructing the CubeTexture without assigning it to
 *     `scene.environmentTexture`: renders fine.
 *   - Assigning it: full black screen, reproducible on every reload.
 *   - Toggling `createPolynomials` (spherical-harmonics diffuse IBL) on/off:
 *     no change, still black either way.
 *   - Toggling `noMipmap` on/off: no change, still black either way.
 * This points at a WebGPU-backend PBR shader/bind-group codepath for
 * `REFLECTIONMAP_CUBIC`-style environment sampling that this Babylon
 * version doesn't handle correctly for a manually-constructed (non-.env/
 * non-prefiltered) cube texture — not a mistake in how this texture is
 * authored. The same texture is confirmed to *not* recreate this failure
 * when environmentTexture is left unassigned (i.e. everything else in the
 * PBR conversion — albedo/normal/roughness/AO/emissive — is unaffected).
 *
 * Given a broken game is a strictly worse outcome than a missing ambient
 * reflection contribution, this gates the assignment to WebGL only
 * (`!scene.getEngine().isWebGPU`) until Babylon ships a fix or this is
 * re-investigated with more time. The tuned directional key + hemispheric
 * fill lights (src/render/lighting.ts) remain the dominant, WebGPU-safe
 * lighting read in the meantime and were re-balanced with this limitation
 * in mind.
 */
export function createGardenEnvironment(scene: Scene): CubeTexture {
  if (cached) return cached;
  // Order matches Babylon's CubeTexture `files` convention: +X, +Y, +Z, -X,
  // -Y, -Z (px, py, pz, nx, ny, nz).
  const px = drawFace('side');
  const py = drawFace('up');
  const pz = drawFace('side');
  const nx = drawFace('side');
  const ny = drawFace('down');
  const nz = drawFace('side');
  const texture = new CubeTexture(
    '',
    scene,
    undefined,
    false,
    [px, py, pz, nx, ny, nz],
    undefined,
    undefined,
    undefined,
    false,
    undefined,
    true,
  );
  texture.name = 'terrarium.environment';
  if (!scene.getEngine().isWebGPU) {
    scene.environmentTexture = texture;
  }
  // Gentle ambient fill, not a showpiece reflection — keep the directional
  // key/fill lights (lighting.ts) as the dominant read on the scene.
  scene.environmentIntensity = 0.7;
  cached = texture;
  return texture;
}

/** Test-only: clears the module-level cache between test runs. */
export function _resetEnvironmentForTests(): void {
  cached = undefined;
}
