// Shared PBR material library for Tiny Terrarium Works' world geometry —
// see docs/MATERIAL_LIBRARY.md for the full per-material writeup (physical
// character, maps used, roughness/normal strategy, performance notes) and
// docs/ART_DIRECTION.md for the palette/lighting plan this serves.
//
// Uses PBRMetallicRoughnessMaterial (the glTF metal/roughness convention)
// rather than the dual-workflow PBRMaterial class: PBRMaterial silently
// switches between its specular/glossiness and metallic/roughness code
// paths based on whether `.metallic`/`.roughness` are non-null
// (`isMetallicWorkflow()`), which made a first pass at this (setting both a
// `microSurfaceTexture` AND scalar `.roughness`) silently ignore the
// per-pixel texture. PBRMetallicRoughnessMaterial has one unambiguous
// texture convention (baseTexture/normalTexture/occlusionTexture/
// metallicRoughnessTexture, G=roughness B=metallic — standard glTF packing)
// and is one of the two classes the brief explicitly allows.
//
// Design constraints driving everything here (see .claude/agents/
// visual-fidelity-artist.md brief):
//   - PBRMaterial/PBRMetallicRoughnessMaterial only for major visible world
//     geometry — no StandardMaterial except the documented Sprout-billboard
//     exception (src/render/sprouts.ts) and thin marker/preview geometry.
//   - Original assets only — every texture below is synthesized in-code via
//     Canvas 2D noise/gradients at module load, never fetched or imported
//     from a file. No third-party textures.
//   - Shared, reusable materials/textures — a handful of procedural texture
//     *families* (soil, stone, wood, painted-metal, water, path, foliage)
//     are generated ONCE per (family, tiling) pair and reused across every
//     object that wants that exact family/tiling combo (all 3 habitat
//     bodies share the "stone@3" normal/roughness/AO trio and differ only
//     by `baseColor` tint), per the brief's "don't create one unique
//     texture per repeated object" performance rule.
//   - Roughness/normal intensity tuned to read at normal gameplay camera
//     distance without looking noisy or embossed. Textures are 256x256 (up
//     from an original 128px pass) and combine two blotch octaves (a macro
//     layer for large-scale clumps/chips/grain-streaks plus a finer micro
//     layer for pores/scuffs/vein-like detail) with a per-pixel fine "grain"
//     jitter, so surface detail reads at both normal gameplay distance and
//     close-up instead of only being visible pressed up against the mesh.

import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Material } from '@babylonjs/core/Materials/material';
import { PBRMetallicRoughnessMaterial } from '@babylonjs/core/Materials/PBR/pbrMetallicRoughnessMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import type { Scene } from '@babylonjs/core/scene';
import { createManifestMaterial, getManifestTexture, type ManifestKey } from './assets';

// ---------------------------------------------------------------------------
// Procedural texture generation helpers
// ---------------------------------------------------------------------------

/** Shared texture resolution for every procedural material family. Raised
 * from an original 128px pass to 256px specifically so higher-frequency
 * detail (fine grain/pores/scuffs, not just the original large soft
 * blotches) has enough pixels to read as detail rather than blur once
 * tiled across a surface — see docs/MATERIAL_LIBRARY.md "Procedural texture
 * families" for the before/after reasoning and the perf note on generation
 * cost (one-time, at material-family creation, not per-frame). */
const TEXTURE_SIZE = 256;

/** Simple deterministic PRNG (mulberry32) so repeated texture-family builds
 * are stable across reloads instead of re-rolling random noise every time a
 * material happens to get rebuilt. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCanvas(size: number): CanvasRenderingContext2D {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  return canvas.getContext('2d') as CanvasRenderingContext2D;
}

/** Unit offsets (in whole-tile multiples) covering the full 3x3 neighborhood
 * around a tile — used to wrap every blotch/streak draw so a feature near
 * any edge OR corner of the canvas also gets drawn in the tiles that would
 * be adjacent to it once the texture repeats. The original pass only wrapped
 * the 4 edge-adjacent offsets (plus center); that was fine for the original
 * few large, soft, low-density blotches, but this pass's higher blotch
 * density (finer grain/pore/scuff detail) meaningfully raises the odds of a
 * feature landing near a corner, where a 4-neighbor wrap leaves a visible
 * seam. Full 3x3 wrap costs 9x fill calls per feature (still cheap — this
 * only runs once per family at material-creation time) and eliminates that
 * class of seam entirely. */
const WRAP_OFFSET_UNITS: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

/** One layer of randomly-placed soft blotches/streaks contributing to a
 * height field. Multiple layers (e.g. a sparse "macro" layer of large
 * blotches plus a dense "micro" layer of small ones) combine into a single
 * multi-scale height field — the mechanism behind every family's
 * grain/chip/pore/scuff/vein look below. */
interface BlotchSpec {
  seed: number;
  count: number;
  /** Base radius in pixels (of a 256px canvas); each instance jitters this by 0.5x-1.5x. */
  radius: number;
  /** Peak alpha of a blotch at its center. Defaults to 0.55. */
  alpha?: number;
  /** 'blob' (default) is a round soft blotch (clumps/chips/pores/ripple swells).
   * 'streak' stretches it into an elongated ellipse along a (randomized) axis —
   * used for wood grain lines, scuff/scratch marks, and leaf-vein-like detail. */
  shape?: 'blob' | 'streak';
  /** Length multiplier applied to the radius along the streak's long axis. */
  streakLength?: number;
  /** Base rotation (radians) for streaks; 0 = along the +X axis. */
  baseAngle?: number;
  /** Random rotation jitter (radians) added around baseAngle per-instance —
   * e.g. Math.PI for "scattered in every direction" scuffs/veins, a small
   * value for "mostly aligned" wood grain. */
  angleJitter?: number;
}

function paintBlotchLayer(ctx: CanvasRenderingContext2D, size: number, spec: BlotchSpec): void {
  const rand = mulberry32(spec.seed);
  const alpha = spec.alpha ?? 0.55;
  const stretch = spec.shape === 'streak' ? (spec.streakLength ?? 4) : 1;
  for (let i = 0; i < spec.count; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = spec.radius * (0.5 + rand());
    const dark = rand() > 0.5;
    const shade = dark ? 60 + rand() * 40 : 170 + rand() * 50;
    const angle = (spec.baseAngle ?? 0) + (rand() - 0.5) * (spec.angleJitter ?? 0);
    for (const [ux, uy] of WRAP_OFFSET_UNITS) {
      ctx.save();
      ctx.translate(x + ux * size, y + uy * size);
      ctx.rotate(angle);
      ctx.scale(stretch, 1);
      const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
      grad.addColorStop(0, `rgba(${shade},${shade},${shade},${alpha})`);
      grad.addColorStop(1, 'rgba(128,128,128,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
}

/**
 * Renders a tileable grayscale "height" field by compositing one or more
 * blotch/streak layers (see BlotchSpec) over a neutral mid-gray base, then
 * optionally adding a fine per-pixel "grain" jitter on top (independent
 * random noise reads as sand/pore/sandpaper grain and — being per-pixel and
 * statistically uniform — needs no seam-wrapping of its own). Used both as
 * the source for a derived normal map and — reusing the same luminance — as
 * a cheap ambient-occlusion mask (dark blotches read as soil clumps/stone
 * pores/contact darkening) and as the modulation source for the albedo
 * variation texture, so albedo/normal/AO all visibly correlate with the same
 * physical surface detail instead of reading as three unrelated overlays.
 */
function drawHeightField(size: number, layers: BlotchSpec[], grain?: { seed: number; amount: number }): ImageData {
  const ctx = makeCanvas(size);
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, size, size);
  for (const layer of layers) paintBlotchLayer(ctx, size, layer);
  const imageData = ctx.getImageData(0, 0, size, size);
  if (grain) {
    const rand = mulberry32(grain.seed);
    for (let i = 0; i < imageData.data.length; i += 4) {
      const jitter = (rand() - 0.5) * grain.amount * 255;
      const v = Math.max(0, Math.min(255, imageData.data[i] + jitter));
      imageData.data[i] = v;
      imageData.data[i + 1] = v;
      imageData.data[i + 2] = v;
    }
  }
  return imageData;
}

/** Converts a grayscale height field into a tangent-space normal map (simple
 * Sobel-style finite difference), returned as a ready-to-use DynamicTexture. */
function heightFieldToNormalTexture(scene: Scene, name: string, height: ImageData, size: number, strength: number): DynamicTexture {
  const texture = new DynamicTexture(name, size, scene, false, Texture.TRILINEAR_SAMPLINGMODE);
  const ctx = texture.getContext() as CanvasRenderingContext2D;
  const out = ctx.createImageData(size, size);
  const at = (x: number, y: number): number => {
    const xi = (x + size) % size;
    const yi = (y + size) % size;
    return height.data[(yi * size + xi) * 4];
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) / 255;
      const dy = (at(x, y + 1) - at(x, y - 1)) / 255;
      const nx = -dx * strength;
      const ny = -dy * strength;
      const nz = 1;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      const idx = (y * size + x) * 4;
      out.data[idx] = ((nx / len) * 0.5 + 0.5) * 255;
      out.data[idx + 1] = ((ny / len) * 0.5 + 0.5) * 255;
      out.data[idx + 2] = ((nz / len) * 0.5 + 0.5) * 255;
      out.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
  texture.update(false);
  texture.wrapU = Texture.WRAP_ADDRESSMODE;
  texture.wrapV = Texture.WRAP_ADDRESSMODE;
  return texture;
}

/** Reuses a height field's luminance as a cheap ambient-occlusion map —
 * darker blotches (soil clumps, stone pores, wood knots) read as contact
 * darkening without needing a separate bespoke AO bake. Compressed into a
 * gentle [0.55,1] range — full-black AO reads as ugly baked outlines, which
 * the brief explicitly warns against. */
function heightFieldToOcclusionTexture(scene: Scene, name: string, height: ImageData, size: number): DynamicTexture {
  const texture = new DynamicTexture(name, size, scene, false, Texture.TRILINEAR_SAMPLINGMODE);
  const ctx = texture.getContext() as CanvasRenderingContext2D;
  const out = ctx.createImageData(size, size);
  for (let i = 0; i < height.data.length; i += 4) {
    const v = 140 + height.data[i] * 0.45;
    out.data[i] = v;
    out.data[i + 1] = v;
    out.data[i + 2] = v;
    out.data[i + 3] = 255;
  }
  ctx.putImageData(out, 0, 0);
  texture.update(false);
  texture.wrapU = Texture.WRAP_ADDRESSMODE;
  texture.wrapV = Texture.WRAP_ADDRESSMODE;
  return texture;
}

/** Sparse radial mask (0..1 per pixel) used to make metallic response
 * spatially sparse rather than a flat scalar over an entire surface — e.g.
 * a handful of small "exposed brass fitting" specks on painted garden
 * equipment, not a uniform metallic tint across the whole body. Wrapped the
 * same way as the height-field blotches so it tiles cleanly. */
function computeSparseMask(size: number, seed: number, count: number, radius: number): Float32Array {
  const ctx = makeCanvas(size);
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, size, size);
  const rand = mulberry32(seed);
  for (let i = 0; i < count; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = radius * (0.6 + rand() * 0.8);
    for (const [ux, uy] of WRAP_OFFSET_UNITS) {
      const cx = x + ux * size;
      const cy = y + uy * size;
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      grad.addColorStop(0, 'rgba(255,255,255,0.95)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const data = ctx.getImageData(0, 0, size, size).data;
  const mask = new Float32Array(size * size);
  for (let i = 0; i < mask.length; i++) mask[i] = data[i * 4] / 255;
  return mask;
}

/** glTF-convention combined texture: G channel = roughness, B channel =
 * metallic (per PBRMetallicRoughnessMaterial.metallicRoughnessTexture).
 * Roughness combines a low-frequency macro pattern (unrelated patches of
 * "wear" reading rough/smooth at a glance) with a higher-frequency micro
 * pattern (fine per-area variation so no single patch is a perfectly flat
 * roughness value — the brief's "controlled micro-variation" rule) — both
 * independent of the height field's own blotch layout so roughness doesn't
 * just mechanically retrace the bump, but still generally correlated in
 * character (wear tends to show up as both a bump and a roughness change).
 * Metallic defaults to a flat `metallicBase` but can be pushed up to
 * `metallicPeak` inside a sparse mask (see computeSparseMask) — the
 * mechanism behind painted-metal's "small exposed brass fitting" accents,
 * so metallic response stays a true accent rather than a uniform tint. */
function drawMetallicRoughnessTexture(
  scene: Scene,
  name: string,
  size: number,
  seed: number,
  roughnessBase: number,
  roughnessSpread: number,
  roughnessMicroSpread: number,
  metallicBase: number,
  metallicPeak: number,
  metallicMask?: { seed: number; count: number; radius: number },
): DynamicTexture {
  const texture = new DynamicTexture(name, size, scene, false, Texture.TRILINEAR_SAMPLINGMODE);
  const ctx = texture.getContext() as CanvasRenderingContext2D;
  const out = ctx.createImageData(size, size);
  const mask = metallicMask ? computeSparseMask(size, metallicMask.seed, metallicMask.count, metallicMask.radius) : undefined;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const macro = Math.sin(x * 0.05 + seed * 2) * Math.cos(y * 0.06 + seed) * 0.5 + 0.5;
      const micro = Math.sin(x * 0.34 + seed * 3.1) * Math.cos(y * 0.31 - seed * 1.3) * 0.5 + 0.5;
      const roughness = Math.max(0.04, Math.min(1, roughnessBase + (macro - 0.5) * roughnessSpread + (micro - 0.5) * roughnessMicroSpread));
      const idx = (y * size + x) * 4;
      const maskValue = mask ? mask[y * size + x] : 0;
      const metallic = Math.max(0, Math.min(1, metallicBase + maskValue * (metallicPeak - metallicBase)));
      out.data[idx] = 255; // R unused (occlusion supplied separately via occlusionTexture)
      out.data[idx + 1] = Math.round(roughness * 255); // G = roughness
      out.data[idx + 2] = Math.round(metallic * 255); // B = metallic
      out.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
  texture.update(false);
  texture.wrapU = Texture.WRAP_ADDRESSMODE;
  texture.wrapV = Texture.WRAP_ADDRESSMODE;
  return texture;
}

/** Tints a base color using the SAME height field driving the normal/AO maps
 * (plus a touch of independent per-pixel jitter) so albedo variation isn't a
 * flat RGB fill AND visibly correlates with the surface's bump/AO detail —
 * darker recesses and raised grain/chips read consistently across all three
 * maps instead of as unrelated overlays. */
function drawAlbedoVariation(scene: Scene, name: string, size: number, height: ImageData, base: Color3, variation: number, seed: number): DynamicTexture {
  const texture = new DynamicTexture(name, size, scene, false, Texture.TRILINEAR_SAMPLINGMODE);
  const ctx = texture.getContext() as CanvasRenderingContext2D;
  const rand = mulberry32(seed + 1);
  const out = ctx.createImageData(size, size);
  for (let i = 0; i < height.data.length; i += 4) {
    const h = (height.data[i] - 128) / 128; // -1..1
    const jitter = (rand() - 0.5) * 0.1;
    const t = Math.max(-1, Math.min(1, h + jitter)) * variation;
    out.data[i] = Math.max(0, Math.min(255, (base.r + t) * 255));
    out.data[i + 1] = Math.max(0, Math.min(255, (base.g + t) * 255));
    out.data[i + 2] = Math.max(0, Math.min(255, (base.b + t) * 255));
    out.data[i + 3] = 255;
  }
  ctx.putImageData(out, 0, 0);
  texture.update(false);
  texture.wrapU = Texture.WRAP_ADDRESSMODE;
  texture.wrapV = Texture.WRAP_ADDRESSMODE;
  return texture;
}

interface TextureFamily {
  albedo: DynamicTexture;
  normal: DynamicTexture;
  occlusion: DynamicTexture;
  metallicRoughness: DynamicTexture;
}

/** Per-family generation recipe, independent of tiling (tiling is folded
 * into the cache key by getOrCreateFamily — see its doc comment for why). */
interface FamilyRecipe {
  seed: number;
  baseColor: Color3;
  heightLayers: BlotchSpec[];
  grain?: { seed: number; amount: number };
  bumpStrength: number;
  roughnessBase: number;
  roughnessSpread: number;
  roughnessMicroSpread?: number;
  albedoVariation: number;
  metallic: number;
  metallicPeak?: number;
  metallicMask?: { seed: number; count: number; radius: number };
}

const familyCache = new Map<string, TextureFamily>();

/**
 * Builds (once, cached by `${familyName}@${tiling}`) a shared albedo/normal/
 * AO/metallic-roughness texture quartet for a material *family* (soil,
 * stone, wood, painted-metal, water, path, foliage, ...). Every material
 * that requests the same family AND the same tiling factor reuses the exact
 * same four textures and just tints baseColor — this is the "shared PBR
 * materials, not one texture per object" performance rule in practice.
 *
 * Tiling is baked into the cache key (and each texture's uScale/vScale is
 * set once here, at creation) rather than mutated afterwards by callers —
 * an earlier version of this module set uScale/vScale on an already-shared
 * DynamicTexture from `applyFamily`, which is safe only as long as every
 * consumer of a family wants the same tiling. That happened to hold (each
 * family had exactly one tiling value in practice) but was a latent bug:
 * two consumers wanting different tiling of the "same" family would have
 * had the second caller's uScale silently override the first's. Keying the
 * cache by tiling makes that impossible by construction, at the cost of a
 * (still cheap, one-time) regenerated texture set per distinct tiling value
 * — e.g. the "stone" family exists both at tiling=3 (habitat drum bodies)
 * and tiling=2 (instanced scenery stone, see createSceneryStoneMaterial).
 */
function getOrCreateFamily(scene: Scene, familyName: string, recipe: FamilyRecipe & { tiling: number }): TextureFamily {
  const cacheKey = `${familyName}@${recipe.tiling}`;
  const cached = familyCache.get(cacheKey);
  if (cached) return cached;
  const size = TEXTURE_SIZE;
  const height = drawHeightField(size, recipe.heightLayers, recipe.grain);
  const family: TextureFamily = {
    albedo: drawAlbedoVariation(scene, `terrarium.pbr.${familyName}.albedo`, size, height, recipe.baseColor, recipe.albedoVariation, recipe.seed),
    normal: heightFieldToNormalTexture(scene, `terrarium.pbr.${familyName}.normal`, height, size, recipe.bumpStrength),
    occlusion: heightFieldToOcclusionTexture(scene, `terrarium.pbr.${familyName}.ao`, height, size),
    metallicRoughness: drawMetallicRoughnessTexture(
      scene,
      `terrarium.pbr.${familyName}.metallicRoughness`,
      size,
      recipe.seed,
      recipe.roughnessBase,
      recipe.roughnessSpread,
      recipe.roughnessMicroSpread ?? 0,
      recipe.metallic,
      recipe.metallicPeak ?? recipe.metallic,
      recipe.metallicMask,
    ),
  };
  for (const tex of [family.albedo, family.normal, family.occlusion, family.metallicRoughness]) {
    tex.uScale = recipe.tiling;
    tex.vScale = recipe.tiling;
  }
  familyCache.set(cacheKey, family);
  return family;
}

/** Applies a family's normal/AO/metallic-roughness maps to a material.
 * Does NOT touch tiling (baked into the family's textures at creation, see
 * getOrCreateFamily) or baseTexture (each caller decides whether that's the
 * family's own tinted albedo or a manifest-art texture with this family's
 * detail maps layered on top — see e.g. createPathMaterial). */
function applyFamily(material: PBRMetallicRoughnessMaterial, family: TextureFamily): void {
  material.normalTexture = family.normal;
  material.occlusionTexture = family.occlusion;
  material.metallicRoughnessTexture = family.metallicRoughness;
  // Scalars act as multipliers over the texture's G/B channels in this
  // workflow — keep them at 1 so the per-pixel texture supplies the real
  // variation instead of a flat override.
  material.metallic = 1;
  material.roughness = 1;
}

// ---------------------------------------------------------------------------
// Per-family recipes
// ---------------------------------------------------------------------------
// Every recipe below layers a sparse "macro" blotch/streak pass (large-scale
// clumps/chips/grain lines/ripple swells — the main silhouette-scale detail
// visible at normal gameplay distance) with a denser "micro" pass (small
// pores/scuffs/vein-like flecks that read as fine surface character on
// closer inspection) plus a subtle per-pixel grain jitter. Roughness gets a
// matching macro+micro split (see drawMetallicRoughnessTexture). This is
// what "grain, chips, pores, weave, ripples ... visible at the default
// gameplay camera distance, not just at extreme close-up" (brief) is built
// from — see docs/MATERIAL_LIBRARY.md for the full per-material writeup and
// before/after browser QA notes.

const SOIL_RECIPE: FamilyRecipe = {
  seed: 7,
  // Olive EARTH rather than lawn green. The ground is the largest surface on
  // screen; a flat mid-green plane read as a billiard table and gave the
  // (green) foliage nothing to sit against. The green now comes from the moss
  // drift in the per-vertex tint (src/render/layout.ts's groundTintAt), so the
  // ground reads as soil with moss growing on it — which is what it is.
  baseColor: new Color3(0.29, 0.3, 0.2),
  heightLayers: [
    { seed: 7, count: 90, radius: 20 }, // macro clumps
    { seed: 71, count: 260, radius: 4, alpha: 0.35 }, // fine pebbles/crumb grain
  ],
  grain: { seed: 72, amount: 0.05 },
  bumpStrength: 1.9,
  roughnessBase: 0.88,
  roughnessSpread: 0.18,
  roughnessMicroSpread: 0.08,
  // Raised from 0.09: at the ground's 10x tiling this is the only source of
  // sub-metre colour break-up, and 0.09 was invisible past the first metre.
  albedoVariation: 0.15,
  metallic: 0,
};

const STONE_RECIPE: FamilyRecipe = {
  seed: 13,
  baseColor: new Color3(1, 1, 1),
  heightLayers: [
    { seed: 13, count: 70, radius: 16 }, // macro chips
    { seed: 131, count: 220, radius: 3, alpha: 0.3 }, // fine pores
  ],
  grain: { seed: 132, amount: 0.04 },
  bumpStrength: 1.3,
  roughnessBase: 0.6,
  roughnessSpread: 0.22,
  roughnessMicroSpread: 0.1,
  albedoVariation: 0.07,
  metallic: 0,
};

const WOOD_RECIPE: FamilyRecipe = {
  seed: 29,
  baseColor: new Color3(1, 1, 1),
  heightLayers: [
    { seed: 29, count: 16, radius: 9, shape: 'streak', streakLength: 9, angleJitter: 0.25 }, // long grain lines
    { seed: 291, count: 55, radius: 2.5, shape: 'streak', streakLength: 5, alpha: 0.3, angleJitter: 0.3 }, // fine grain lines
  ],
  grain: { seed: 292, amount: 0.03 },
  bumpStrength: 1.0,
  roughnessBase: 0.45,
  roughnessSpread: 0.15,
  roughnessMicroSpread: 0.08,
  albedoVariation: 0.08,
  metallic: 0,
};

const PAINTED_METAL_RECIPE: FamilyRecipe = {
  seed: 41,
  baseColor: new Color3(1, 1, 1),
  heightLayers: [
    { seed: 41, count: 22, radius: 14, alpha: 0.4 }, // worn/repainted patches
    { seed: 411, count: 70, radius: 2, shape: 'streak', streakLength: 7, alpha: 0.3, angleJitter: Math.PI }, // scuffs/scratches, random angle
  ],
  grain: { seed: 412, amount: 0.04 },
  bumpStrength: 0.9,
  roughnessBase: 0.4,
  roughnessSpread: 0.2,
  roughnessMicroSpread: 0.12,
  albedoVariation: 0.07,
  // Near-zero paint base; metallic only appears as small exposed-fitting
  // specks via the sparse mask below — "small brass-fitting-like glints",
  // never a uniform metal tint across the whole painted body.
  //
  // metallicPeak kept conservative (0.4, not the more dramatic ~0.75 a
  // "brass fitting" might suggest) on purpose: browser QA on the live
  // WebGPU scene (this project's default backend, which has no environment/
  // IBL contribution — see environment.ts) showed a higher peak reading as
  // faint DARK speckling rather than a warm glint on close inspection of a
  // full-alpha built automation site. That's the physically-expected
  // outcome, not a bug: a metallic surface's only real light response is
  // specular/environment reflection (metals have ~zero diffuse albedo), so
  // without IBL and without a specular highlight landing exactly on a given
  // speck at a given camera angle, "metallic" mostly just means "darker,"
  // which is the opposite of the intended accent. 0.4 was chosen as a
  // compromise that stays visibly distinct from the 0.03 paint base without
  // pushing hard into that dark-speckle failure mode on the IBL-less
  // backend; it has NOT been visually re-confirmed as a positive "glint" on
  // WebGL (where IBL specular response would exist) — a known gap, not a
  // silently-assumed win. See docs/MATERIAL_LIBRARY.md's "Metallic is a
  // true accent" section for the full note.
  metallic: 0.03,
  metallicPeak: 0.4,
  metallicMask: { seed: 413, count: 10, radius: 3 },
};

const WATER_RECIPE: FamilyRecipe = {
  seed: 53,
  baseColor: new Color3(1, 1, 1),
  heightLayers: [
    { seed: 53, count: 14, radius: 26 }, // broad swells
    { seed: 531, count: 44, radius: 5, shape: 'streak', streakLength: 5, alpha: 0.3, angleJitter: 0.6 }, // ripple crests
  ],
  grain: { seed: 532, amount: 0.02 },
  bumpStrength: 1.1,
  roughnessBase: 0.12,
  roughnessSpread: 0.08,
  roughnessMicroSpread: 0.05,
  albedoVariation: 0.03,
  metallic: 0,
};

const PATH_RECIPE: FamilyRecipe = {
  seed: 21,
  baseColor: new Color3(1, 1, 1),
  heightLayers: [
    { seed: 21, count: 40, radius: 20 }, // worn tread patches
    { seed: 211, count: 140, radius: 3, alpha: 0.3 }, // grit/pebble grain
  ],
  grain: { seed: 212, amount: 0.04 },
  bumpStrength: 0.9,
  roughnessBase: 0.55,
  roughnessSpread: 0.15,
  roughnessMicroSpread: 0.08,
  albedoVariation: 0.05,
  metallic: 0,
};

/** New this pass: foliage detail overlay (leaf-cluster shadow pockets +
 * fine vein-like streaks in randomized directions) — layered on top of
 * scenery foliage cards' manifest art the same way PATH_RECIPE layers onto
 * path tile art. Addresses the brief's explicit call-out that foliage
 * needs its own richer albedo/normal/roughness/AO pass, not just the flat
 * roughness=0.55 default every other manifest-art card gets. */
const FOLIAGE_RECIPE: FamilyRecipe = {
  seed: 61,
  baseColor: new Color3(1, 1, 1),
  heightLayers: [
    { seed: 61, count: 26, radius: 14 }, // leaf-cluster shadow pockets
    { seed: 611, count: 90, radius: 2, shape: 'streak', streakLength: 6, alpha: 0.3, angleJitter: Math.PI }, // vein-like flecks, random direction
  ],
  grain: { seed: 612, amount: 0.05 },
  bumpStrength: 0.85,
  roughnessBase: 0.4,
  roughnessSpread: 0.15,
  roughnessMicroSpread: 0.1,
  albedoVariation: 0.05,
  metallic: 0,
};

// ---------------------------------------------------------------------------
// Material recipes
// ---------------------------------------------------------------------------

/** Terrain/soil — layered loose soil rather than a flat plane: mottled
 * albedo, small bump for clumps/pebbles, rough matte response, gentle AO in
 * the "pores". Shared by the single ground mesh (world.ts). */
export function createSoilMaterial(scene: Scene): PBRMetallicRoughnessMaterial {
  const family = getOrCreateFamily(scene, 'soil', { ...SOIL_RECIPE, tiling: 10 });
  const material = new PBRMetallicRoughnessMaterial('terrarium.ground.mat', scene);
  material.baseColor = Color3.White();
  material.baseTexture = family.albedo;
  applyFamily(material, family);
  return material;
}

/** Garden path — satin-worn stone/soil tread carrying a manifest path
 * illustration as the albedo, with a shared normal/AO/roughness detail pass
 * layered on top. ONE shared material instance per PIECE TYPE (straight /
 * corner / tee / cross / end), not one per tile: world.ts creates at most five
 * of these and every tile of a given piece type reuses the same material,
 * rotating its own mesh instead. Converting each tile to its own material
 * would multiply shader/uniform cost for what is visually the same repeated
 * surface (see docs/MATERIAL_LIBRARY.md). */
export function createPathMaterial(scene: Scene, name: string, manifestKey: ManifestKey, fallbackColor: Color3): PBRMetallicRoughnessMaterial {
  // tiling=1: path art is one illustration per tile, not a tiled repeat —
  // only the detail maps' own generation frequency matters, not a repeat
  // count (see getOrCreateFamily's doc comment on why tiling is baked into
  // the family rather than mutated post-hoc).
  const family = getOrCreateFamily(scene, 'path', { ...PATH_RECIPE, tiling: 1 });
  const material = createManifestMaterial(scene, name, manifestKey, fallbackColor);
  applyFamily(material, family);
  // Clamp rather than repeat the path art specifically. Babylon textures
  // default to WRAP_ADDRESSMODE, so bilinear sampling at u/v = 0 or 1 blends
  // in the OPPOSITE edge of the canvas. That is harmless on a straight tile
  // (both edges carry the same tread) but on a corner/tee/end piece the two
  // opposite edges differ — tread against transparent surround — which shows
  // as a faint one-pixel fringe exactly along a tile join. The path art is
  // one illustration per tile and never tiled, so clamping costs nothing.
  getManifestTexture(scene, manifestKey, (texture) => {
    texture.wrapU = Texture.CLAMP_ADDRESSMODE;
    texture.wrapV = Texture.CLAMP_ADDRESSMODE;
  });
  return material;
}

/**
 * Conveyor flow chevrons for the garden path — ONE shared material and ONE
 * shared texture for every path tile in the garden. Direction of travel is
 * carried by each tile's own quad ROTATION (see GARDEN_PATH_PIECES'
 * flowQuarterTurns), so a single scrolling u offset animates all of them in
 * their own correct direction; nothing here is per-tile, and `advance` only
 * writes two numbers, so there is no per-frame allocation.
 *
 * Deliberate stylised exception to the "PBR world geometry" rule, documented
 * per the brief: this is a light marker travelling OVER the tread, not a
 * physical surface, so it is emissive-led with no normal/AO/roughness pass —
 * layering the path family's bump onto a moving overlay would read as the
 * *ground* rippling. It stays a lit PBR material (not `disableLighting`) so it
 * still sits inside the scene's warm/cool light rather than glowing flatly.
 *
 * The chevrons are directional by SHAPE as well as by motion, which is what
 * makes the reduced-motion path honest: with `backgroundMotion: 0` the scroll
 * halts completely (see world.ts) and the arrows still say which way traffic
 * goes.
 */
export interface PathFlowMaterial {
  material: PBRMetallicRoughnessMaterial;
  /** Scrolls the chevrons. `speed` of 0 freezes them at a stable phase. */
  advance: (nowMs: number, speed: number) => void;
  /** Disposes the material AND the shared chevron texture, clearing the module
   * cache. Unlike the procedural texture families — whose `familyCache`
   * deliberately outlives a scene so a re-init reuses them — this texture must
   * not: `advance` mutates its `uOffset` every frame, so a stale handle left
   * behind by a renderer dispose→re-init would have the new scene writing into
   * a texture belonging to the disposed one. */
  dispose: () => void;
}

/** Chevrons per tile length. The u offset wraps on 1/CHEVRONS_PER_TILE so the
 * march is seamless. */
const CHEVRONS_PER_TILE = 2;

/** Single shared chevron texture for the whole path network. */
let pathFlowTexture: DynamicTexture | undefined;

function createPathFlowTexture(scene: Scene): DynamicTexture {
  if (pathFlowTexture) return pathFlowTexture;
  const size = 128;
  const texture = new DynamicTexture('terrarium.pbr.pathFlow.albedo', size, scene, false, Texture.TRILINEAR_SAMPLINGMODE);
  const ctx = texture.getContext() as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, size, size);
  // One chevron pointing toward +u (the quad's local +X, which each tile
  // rotates onto its own flow direction). Drawn with a soft leading edge so it
  // reads as a travelling glow rather than a hard UI arrow.
  const mid = size / 2;
  const gradient = ctx.createLinearGradient(0, 0, size, 0);
  gradient.addColorStop(0, 'rgba(255,246,214,0)');
  gradient.addColorStop(0.55, 'rgba(255,246,214,0.55)');
  gradient.addColorStop(0.86, 'rgba(255,252,236,0.95)');
  gradient.addColorStop(1, 'rgba(255,246,214,0)');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  // Chevron: a thick ">" spanning the full v range, apex at the +u end.
  const inset = size * 0.16;
  const thickness = size * 0.3;
  ctx.moveTo(inset, inset);
  ctx.lineTo(size - inset, mid);
  ctx.lineTo(inset, size - inset);
  ctx.lineTo(inset + thickness, size - inset);
  ctx.lineTo(size - inset - thickness * 0.72, mid);
  ctx.lineTo(inset + thickness, inset);
  ctx.closePath();
  ctx.fill();
  texture.update(false);
  texture.hasAlpha = true;
  texture.wrapU = Texture.WRAP_ADDRESSMODE;
  texture.wrapV = Texture.CLAMP_ADDRESSMODE;
  texture.uScale = CHEVRONS_PER_TILE;
  pathFlowTexture = texture;
  return texture;
}

export function createPathFlowMaterial(scene: Scene): PathFlowMaterial {
  const texture = createPathFlowTexture(scene);
  const material = new PBRMetallicRoughnessMaterial('terrarium.path.flow.mat', scene);
  material.baseColor = new Color3(1, 0.95, 0.78);
  material.baseTexture = texture;
  // Lifted from emissive 0.50/0.44/0.30 at alpha 0.62. At the default camera
  // the chevrons were washing out against the tread's own pale sand tone —
  // legible in a close crop, close to invisible at the distance the game is
  // actually played at, which undercuts the one job they have (say which way
  // traffic flows). Still well short of a UI overlay: it stays a lit PBR
  // material inside the scene's warm/cool light, per this function's note
  // above.
  material.emissiveColor = new Color3(0.68, 0.6, 0.42);
  material.metallic = 0;
  material.roughness = 0.5;
  material.alpha = 0.82;
  material.backFaceCulling = false;
  material.transparencyMode = Material.MATERIAL_ALPHABLEND;
  (material as unknown as { _useAlphaFromAlbedoTexture: boolean })._useAlphaFromAlbedoTexture = true;

  const dispose = (): void => {
    material.dispose();
    texture.dispose();
    pathFlowTexture = undefined;
  };

  const advance = (nowMs: number, speed: number): void => {
    // Negative, because scrolling the texture window backwards moves the
    // pattern forwards along +u (the tile's flow direction).
    //
    // THE WRAP PERIOD IS 1, NOT 1/CHEVRONS_PER_TILE — this was the visible
    // jerk. Babylon composes a texture's UVs as `u = u0 * uScale + uOffset`,
    // so `uOffset` is measured in TEXTURE periods, not in quad-UV span: one
    // whole chevron is 1.0 of uOffset regardless of what `uScale` is. Wrapping
    // on `1 / CHEVRONS_PER_TILE` (0.5) therefore snapped the whole march back
    // by HALF a chevron on every cycle. The chevrons themselves were evenly
    // spaced the entire time — each half-tile quad shows exactly
    // CHEVRONS_PER_TILE whole periods, so spacing is uniform across tiles and
    // corners — but twice a second the pattern jumped half a step, which reads
    // exactly like uneven spacing plus a hitch at the loop point.
    //
    // At 1.0 the wrap lands on a point where the pattern is identical to where
    // it started, so the march is genuinely seamless and the modulo is
    // invisible.
    const phase = speed === 0 ? 0 : -((nowMs / 1000) * speed) % 1;
    texture.uOffset = phase;
  };

  return { material, advance, dispose };
}

/** Rounded stone habitat drum body — bevel-friendly warm stone/ceramic, dry
 * stone roughness with slightly glossier warm edges. One shared stone
 * texture family across all 3 habitat bodies + the Nursery mound, tinted
 * per-habitat via baseColor. */
export function createStoneBodyMaterial(scene: Scene, name: string, tint: Color3): PBRMetallicRoughnessMaterial {
  const family = getOrCreateFamily(scene, 'stone', { ...STONE_RECIPE, tiling: 3 });
  const material = new PBRMetallicRoughnessMaterial(name, scene);
  material.baseColor = tint;
  material.baseTexture = family.albedo;
  material.baseTexture.level = 0.5; // real, visible variation over the flat tint (raised from an earlier 0.35 pass now that the underlying texture carries genuinely richer chip/pore detail worth showing)
  applyFamily(material, family);
  return material;
}

/** Warm painted-wood/soil Nursery mound the Pod stands on — wood-grain
 * streaked bump, satin roughness. */
export function createWoodBodyMaterial(scene: Scene, name: string, tint: Color3): PBRMetallicRoughnessMaterial {
  const family = getOrCreateFamily(scene, 'wood', { ...WOOD_RECIPE, tiling: 2 });
  const material = new PBRMetallicRoughnessMaterial(name, scene);
  material.baseColor = tint;
  material.baseTexture = family.albedo;
  material.baseTexture.level = 0.45;
  applyFamily(material, family);
  return material;
}

/** Painted garden-equipment metal/wood for automation site bodies — soft
 * satin roughness with sparse true-metal accents (small brass-fitting-like
 * glints via a metallic mask, not a uniform metal tint across the body). */
export function createPaintedMetalMaterial(scene: Scene, name: string, tint: Color3): PBRMetallicRoughnessMaterial {
  const family = getOrCreateFamily(scene, 'paintedMetal', { ...PAINTED_METAL_RECIPE, tiling: 2 });
  const material = new PBRMetallicRoughnessMaterial(name, scene);
  material.baseColor = tint;
  material.baseTexture = family.albedo;
  material.baseTexture.level = 0.42;
  applyFamily(material, family);
  return material;
}

/** Dew Pond / water-accent scenery — glossy local response, depth-tinted,
 * gentle animated ripple via a slow-scrolling normal map (cheap: UV offset,
 * not a real fluid simulation). Call `update(nowMs)` each frame. */
export interface WaterMaterial {
  material: PBRMetallicRoughnessMaterial;
  update: (nowMs: number) => void;
}
export function createWaterMaterial(scene: Scene, name: string): WaterMaterial {
  const family = getOrCreateFamily(scene, 'water', { ...WATER_RECIPE, tiling: 2 });
  const material = new PBRMetallicRoughnessMaterial(name, scene);
  // Deeper and less milky than the earlier (0.3, 0.55, 0.68) pass, which read
  // as a pale flat disc lying on the soil rather than as water with depth
  // under it. The darker base plus a slightly lower alpha lets the shaded
  // basin floor show through and do the depth work.
  material.baseColor = new Color3(0.17, 0.36, 0.45);
  material.alpha = 0.82;
  applyFamily(material, family);
  const update = (nowMs: number): void => {
    const t = nowMs / 4000;
    const normalTexture = material.normalTexture as Texture;
    normalTexture.uOffset = Math.sin(t) * 0.05;
    normalTexture.vOffset = Math.cos(t * 0.8) * 0.05;
  };
  return { material, update };
}

// ---------------------------------------------------------------------------
// Procedural scenery materials (this pass)
// ---------------------------------------------------------------------------
// One material per FAMILY, shared by every instance of every kind that wants
// that surface — per-instance colour micro-variation is delivered by the
// thin-instance colour buffer (see src/render/world.ts), which multiplies the
// albedo in the shader, so hundreds of individually-tinted stones and shrubs
// still cost exactly one material and one draw call per master mesh. This is
// the brief's "don't create one material or texture per scattered object"
// rule taken literally.
//
// All of these are DECORATION, and GameRules §4.1 requires decoration to stay
// visually subordinate to interactive elements. Their base colours are
// therefore deliberately desaturated relative to the habitat/Sprout palette,
// and none of them carries a resting emissive except the lantern glass, which
// is the one decorative element that is meant to be a light source.

/** Scattered stone — pebbles, boulders, kerb blocks, basin rims. Reuses the
 * habitat drums' stone family at a finer tiling, since a pebble is a fraction
 * of a drum's size and the 3x tiling would smear across it. */
export function createSceneryStoneMaterial(scene: Scene, name: string): PBRMetallicRoughnessMaterial {
  const family = getOrCreateFamily(scene, 'stone', { ...STONE_RECIPE, tiling: 2 });
  const material = new PBRMetallicRoughnessMaterial(name, scene);
  // Cool-neutral river stone, a touch warmer than mid-grey so it sits inside
  // the garden's warm key light rather than reading as concrete. Deliberately
  // DARKER than a "correct" pebble grey: browser QA showed a lighter stone
  // reading brighter than the soil it sits on, which pulled the eye onto the
  // decoration and away from the habitats — the opposite of the visual
  // hierarchy GameRules §4.1 requires.
  material.baseColor = new Color3(0.44, 0.42, 0.39);
  material.baseTexture = family.albedo;
  material.baseTexture.level = 0.55;
  applyFamily(material, family);
  return material;
}

/** Living foliage — grass tufts, bush/fern leaves, lily pads. Two-sided, so a
 * single-sheet leaf lights correctly from behind instead of going black, and
 * satin rather than matte so leaves catch a soft waxy highlight. */
export function createFoliageBodyMaterial(scene: Scene, name: string, tint: Color3): PBRMetallicRoughnessMaterial {
  const family = getOrCreateFamily(scene, 'foliage', { ...FOLIAGE_RECIPE, tiling: 1 });
  const material = new PBRMetallicRoughnessMaterial(name, scene);
  material.baseColor = tint;
  material.baseTexture = family.albedo;
  material.baseTexture.level = 0.4;
  applyFamily(material, family);
  // Leaves are open sheets: `doubleSided` turns OFF back-face culling AND
  // flips the normal on back faces, so the underside of a drooping fern is
  // lit as a surface rather than rendered as an unlit black hole.
  material.doubleSided = true;
  return material;
}

/** Flower petals — the same foliage surface with a brighter, waxier response
 * so a bloom reads as a distinct material from the leaf it grows out of.
 * Per-bloom colour comes from the thin-instance tint. */
export function createPetalMaterial(scene: Scene, name: string): PBRMetallicRoughnessMaterial {
  const family = getOrCreateFamily(scene, 'foliage', { ...FOLIAGE_RECIPE, tiling: 1 });
  const material = new PBRMetallicRoughnessMaterial(name, scene);
  // Warm cream rather than the near-white an earlier pass used, which
  // disappeared against the pale kerb stones at gameplay distance. Still a
  // PASTEL, not a focal colour — a flower bed must not compete with a Sprout
  // for attention (GameRules §4.1).
  material.baseColor = new Color3(0.88, 0.76, 0.66);
  material.baseTexture = family.albedo;
  material.baseTexture.level = 0.22;
  applyFamily(material, family);
  material.roughness = 0.72; // multiplies the family's G channel down: petals are smoother than leaves
  material.doubleSided = true;
  return material;
}

/** Fungi caps/stems — soft, dry, slightly chalky. Reuses the wood family's
 * grain at a fine tiling, which at mushroom scale reads as cap striations. */
export function createFungusMaterial(scene: Scene, name: string, tint: Color3): PBRMetallicRoughnessMaterial {
  const family = getOrCreateFamily(scene, 'wood', { ...WOOD_RECIPE, tiling: 2 });
  const material = new PBRMetallicRoughnessMaterial(name, scene);
  material.baseColor = tint;
  material.baseTexture = family.albedo;
  material.baseTexture.level = 0.35;
  applyFamily(material, family);
  material.roughness = 1.15; // chalkier than painted wood
  return material;
}

/**
 * Lantern glass for the first-expansion layer — the one decorative material
 * with a resting emissive, because a lantern that does not glow is not a
 * lantern. Kept modest (emissive well under 1) and warm so it complements the
 * key light instead of blowing out into a glowing sticker, per the brief's
 * emissive rule. `flicker` writes a single scalar, so animating it costs no
 * allocation and can be frozen flat under reduced motion.
 */
export interface LanternGlassMaterial {
  material: PBRMetallicRoughnessMaterial;
  /** `intensity` 0..1 scales the resting glow; callers pass a slow flicker. */
  setGlow: (intensity: number) => void;
}

const LANTERN_EMISSIVE = new Color3(1, 0.72, 0.36);

export function createLanternGlassMaterial(scene: Scene, name: string): LanternGlassMaterial {
  const material = new PBRMetallicRoughnessMaterial(name, scene);
  material.baseColor = new Color3(0.95, 0.83, 0.6);
  material.metallic = 0;
  material.roughness = 0.25;
  material.alpha = 0.9;
  material.transparencyMode = Material.MATERIAL_ALPHABLEND;
  material.emissiveColor = LANTERN_EMISSIVE.scale(0.85);
  return {
    material,
    setGlow: (intensity: number) => {
      material.emissiveColor = LANTERN_EMISSIVE.scale(0.6 + 0.4 * Math.max(0, Math.min(1, intensity)));
    },
  };
}

// NOTE: `applyRockDetail` / `applyFoliageDetail` were removed in the
// procedural-world pass. They layered this module's stone/foliage detail maps
// onto the FLAT BILLBOARD SCENERY CARDS' manifest-art materials. Those cards
// no longer exist — scenery is now real instanced geometry using
// `createSceneryStoneMaterial` / `createFoliageBodyMaterial` above, which own
// their albedo outright rather than decorating someone else's — so the two
// helpers had no remaining callers.

// ---------------------------------------------------------------------------
// Mood badges
// ---------------------------------------------------------------------------
/**
 * The small icon a Sprout carries to show its mood (Mood Bell feature).
 *
 * Replaces a literal `MeshBuilder.CreateSphere` / `CreateBox` primitive. The
 * box version was reported by the player as the Sprout "turning into a square
 * block" while held over a habitat — an accurate description: it was an
 * untextured pale-lavender CUBE floating beside the creature, comparable in
 * screen size to the creature's own head, reading as a missing-texture
 * artifact rather than as a mood cue. docs/REFERENCE_BOARD.md's non-negotiable
 * list fails a build for exactly this ("no default primitives or flat
 * placeholder appearance").
 *
 * Now a soft alpha-cut icon on a small billboard rather than a solid: most of
 * the quad is transparent, so there is no block to see at all — only the
 * glyph.
 *
 * Distinction is by SHAPE first and colour second, per GameRules §11's
 * never-colour-alone rule: sunny is a four-point sparkle, sleepy a crescent.
 * Both are drawn procedurally here rather than loaded, because
 * `MoodDefinition.silhouetteKey` points at manifest art (`mood.sunny.badge`)
 * that does not exist in public/assets/manifest.json — a manifest-backed
 * material would fall back to a flat colour and reintroduce the very problem
 * this fixes.
 */
const moodBadgeTextures = new Map<string, DynamicTexture>();

function createMoodBadgeTexture(scene: Scene, mood: 'sunny' | 'sleepy', tint: Color3): DynamicTexture {
  const cached = moodBadgeTextures.get(mood);
  if (cached) return cached;
  const size = 128;
  const texture = new DynamicTexture(`terrarium.pbr.moodBadge.${mood}`, size, scene, false, Texture.TRILINEAR_SAMPLINGMODE);
  const ctx = texture.getContext() as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, size, size);
  const mid = size / 2;
  const rgb = `${Math.round(tint.r * 255)},${Math.round(tint.g * 255)},${Math.round(tint.b * 255)}`;

  // A soft halo under both glyphs, so the icon carries a little glow of its
  // own instead of reading as a hard sticker pasted over the world.
  const halo = ctx.createRadialGradient(mid, mid, 0, mid, mid, mid);
  halo.addColorStop(0, `rgba(${rgb},0.55)`);
  halo.addColorStop(0.55, `rgba(${rgb},0.18)`);
  halo.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, size, size);

  ctx.fillStyle = 'rgba(255,255,255,0.96)';
  if (mood === 'sunny') {
    // Four-point sparkle: concave-sided star with its points on the axes.
    const outer = size * 0.42;
    const waist = size * 0.1;
    ctx.beginPath();
    ctx.moveTo(mid, mid - outer);
    ctx.quadraticCurveTo(mid + waist, mid - waist, mid + outer, mid);
    ctx.quadraticCurveTo(mid + waist, mid + waist, mid, mid + outer);
    ctx.quadraticCurveTo(mid - waist, mid + waist, mid - outer, mid);
    ctx.quadraticCurveTo(mid - waist, mid - waist, mid, mid - outer);
    ctx.closePath();
    ctx.fill();
  } else {
    // Crescent: a disc with a second punched out of it, offset up and right.
    ctx.beginPath();
    ctx.arc(mid, mid, size * 0.36, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(mid + size * 0.17, mid - size * 0.09, size * 0.32, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }

  texture.update(false);
  texture.hasAlpha = true;
  texture.wrapU = Texture.CLAMP_ADDRESSMODE;
  texture.wrapV = Texture.CLAMP_ADDRESSMODE;
  moodBadgeTextures.set(mood, texture);
  return texture;
}

/** Shared material for one mood's badge — one per mood for the whole session. */
export function createMoodBadgeMaterial(scene: Scene, mood: 'sunny' | 'sleepy', tint: Color3): PBRMetallicRoughnessMaterial {
  const material = new PBRMetallicRoughnessMaterial(`terrarium.sprout.moodBadge.${mood}.mat`, scene);
  material.baseTexture = createMoodBadgeTexture(scene, mood, tint);
  material.baseColor = tint.scale(1.15);
  material.emissiveColor = tint.scale(0.55);
  material.metallic = 0;
  material.roughness = 0.6;
  material.backFaceCulling = false;
  material.transparencyMode = Material.MATERIAL_ALPHABLEND;
  (material as unknown as { _useAlphaFromAlbedoTexture: boolean })._useAlphaFromAlbedoTexture = true;
  return material;
}

/** Test-only: clears the module-level texture-family cache between test
 * runs (mirrors the _reset helpers in assets.ts/environment.ts). */
export function _resetPbrMaterialsForTests(): void {
  familyCache.clear();
  pathFlowTexture = undefined;
  moodBadgeTextures.clear();
}
