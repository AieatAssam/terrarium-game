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
 * Re-investigated this pass with a much more targeted bisection than the
 * original finding (docs/ART_QA_REPORT.md has the full writeup with every
 * probe result). Short version: this is NOT about how the cube texture is
 * constructed — it's about whether its pixel content is perfectly uniform.
 *
 * Six live-browser probes against the actual running WebGPU scene (not a
 * synthetic test harness), each assigning a cube texture to
 * `scene.environmentTexture` and screenshotting the result:
 *
 *   1. Real production texture (this file's actual 64px gradient faces),
 *      assigned synchronously like createGardenLighting does: BLACK SCREEN.
 *      Confirms the documented bug still reproduces.
 *   2. `RawCubeTexture` (raw `Uint8Array` RGBA pixel data, bypassing
 *      `createCubeTextureBase`, the ImageBitmap loader, AND the
 *      extension-based texture-loader lookup entirely — the most different
 *      construction path available in this Babylon version) with the same
 *      64px gradient content: BLACK SCREEN. Rules out "the loader/decode
 *      path is the bug" — an earlier hypothesis (a silently-unresolved
 *      `createImageBitmap` load) that seemed plausible from reading
 *      Babylon's source, but empirically wrong: `__probeCubeTexture`
 *      separately confirmed every face DOES finish loading
 *      (`isReady() === true`, `onLoad` fires) before the black screen even
 *      appears.
 *   3. `RawCubeTexture`, 8px instead of 64px, mipmaps OFF instead of ON,
 *      same gradient content: still BLACK SCREEN. Rules out size and
 *      mipmap generation as the trigger.
 *   4. `RawCubeTexture`, 8px, no mipmaps, but a FLAT single solid color on
 *      every face (`#ff0000`, fully saturated): renders FINE — scene stays
 *      lit, and the flat red tint is visibly reflected in the habitat
 *      bodies' ambient response. Same result with a flat pastel color
 *      (`#fff3d9`, matching one of the real gradient's color stops) — rules
 *      out "bright/saturated colors specifically" as the trigger.
 *   5. `RawCubeTexture`, 8px, a HARD two-color split within a single face
 *      (opaque top half one color, bottom half another — spatial variation,
 *      but no smooth interpolation): BLACK SCREEN. Rules out "smooth
 *      gradient interpolation specifically" — any non-uniform content
 *      within a face is enough.
 *   6. `RawCubeTexture`, 8px, each face internally uniform but a DIFFERENT
 *      flat color per face (warm top / cool-green bottom / mid-green
 *      sides — a coarse flat-banded approximation of the real gradient):
 *      still BLACK SCREEN. So the trigger isn't even "variation within a
 *      face" specifically — a perfectly-uniform-per-face-but-varying-
 *      across-faces cube ALSO crashes. Only a cube that is the same single
 *      color on literally every texel, on every face, survives.
 *
 * Conclusion: the crash isn't triggered by texture *construction* (data URL
 * vs. raw pixels), *size*, *mipmaps*, or *color values* — it's triggered by
 * the cube having ANY non-uniform content at all. That strongly points to
 * Babylon's environment-texture spherical-harmonics/irradiance computation
 * (which reduces all 6 faces into one set of coefficients for the PBR
 * shader's diffuse IBL term) hitting a broken codepath on this project's
 * WebGPU backend specifically when there's real per-texel variation to
 * reduce — a uniform cube is a degenerate trivial case (the "reduction" is
 * just the one color, no real compute pass needed) that likely takes a
 * different, working codepath. This held true even for `RawCubeTexture`,
 * which doesn't expose a `createPolynomials` flag — so `scene.
 * environmentTexture`'s setter (or the PBR shader's first use of it) must
 * be triggering that computation internally regardless of texture class.
 *
 * This also answers whether a uniform-color cube is worth shipping as a
 * partial fix: no. A same-color-on-every-texel cube carries zero directional
 * information — it's indistinguishable from the existing HemisphericLight
 * fill (src/render/lighting.ts) already providing a single ambient color.
 * Shipping it would add a texture binding and material complexity for a
 * visual result players already get for free from the fill light. The
 * entire point of an environment texture — a warm-sky-above/cool-ground-
 * below directional ambient split — requires non-uniform content, which is
 * exactly the condition that crashes.
 *
 * `EquiRectangularCubeTexture` was considered and ruled out WITHOUT a live
 * test — by inference from probes 2-6 above, not empirically confirmed the
 * same way the black screen itself was reproduced: it takes a URL and
 * internally reconstructs 6 cube faces via a `createCubeTextureBase`-
 * derived path, and probes 2-6 already showed the trigger is the cube's
 * *content* (uniform vs. non-uniform), not which construction path built
 * it — CubeTexture, RawCubeTexture, size, and mipmap settings all varied
 * across those probes with content held non-uniform, and all crashed
 * identically. EquiRectangularCubeTexture would need genuinely non-uniform
 * content to be useful (same as the cube-based approach), so by that
 * inference it's expected to hit the same wall — but this specific class
 * was not itself constructed and tested live, so treat this one conclusion
 * as reasoned-from-evidence rather than directly observed.
 * `CreateFromPrefilteredData` was also ruled out: it loads a
 * pre-baked `.env` file, which requires either a third-party asset or an
 * offline baking tool this project has no engine-side authority to run
 * against a procedural texture at runtime — incompatible with the "original
 * assets, generated in-code" constraint (docs/ASSET_CREDITS.md).
 *
 * Given a broken game is a strictly worse outcome than a missing ambient
 * reflection contribution, and no genuinely useful (non-uniform) content
 * survives the WebGPU codepath, this keeps gating the assignment to WebGL
 * only (`!scene.getEngine().isWebGPU`) until Babylon ships a fix. The tuned
 * directional key + hemispheric fill lights (src/render/lighting.ts) remain
 * the dominant, WebGPU-safe lighting read in the meantime.
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
