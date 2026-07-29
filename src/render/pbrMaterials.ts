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
//     *families* (soil, stone, wood, painted-metal, water) are generated
//     ONCE and reused across every object of that family (all 3 habitat
//     bodies share the "stone" normal/roughness/AO trio and differ only by
//     `baseColor` tint), per the brief's "don't create one unique texture
//     per repeated object" performance rule.
//   - Roughness/normal intensity tuned to read at normal gameplay camera
//     distance without looking noisy or embossed — these are small (128px)
//     textures tiled several times across each surface, not hero assets.

import { Color3 } from '@babylonjs/core/Maths/math.color';
import { PBRMetallicRoughnessMaterial } from '@babylonjs/core/Materials/PBR/pbrMetallicRoughnessMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import type { Scene } from '@babylonjs/core/scene';
import { createManifestMaterial, type ManifestKey } from './assets';

// ---------------------------------------------------------------------------
// Procedural texture generation helpers
// ---------------------------------------------------------------------------

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

/**
 * Renders a tileable-ish grayscale "height" field (mottled blotches at a
 * given feature scale) used both as the source for a derived normal map and
 * — reusing the same luminance — as a cheap ambient-occlusion mask (dark
 * blotches read as soil clumps/pores/contact darkening).
 */
function drawHeightField(size: number, seed: number, blotches: number, blotchRadius: number): ImageData {
  const ctx = makeCanvas(size);
  const rand = mulberry32(seed);
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < blotches; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = blotchRadius * (0.5 + rand());
    const dark = rand() > 0.5;
    const shade = dark ? 60 + rand() * 40 : 170 + rand() * 50;
    // Wrap around edges (including the center draw) so the tile doesn't show
    // a hard seam when repeated across a large surface.
    for (const [dx, dy] of [
      [0, 0],
      [size, 0],
      [-size, 0],
      [0, size],
      [0, -size],
    ]) {
      const grad = ctx.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
      grad.addColorStop(0, `rgba(${shade},${shade},${shade},0.55)`);
      grad.addColorStop(1, 'rgba(128,128,128,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x + dx, y + dy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  return ctx.getImageData(0, 0, size, size);
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

/** glTF-convention combined texture: G channel = roughness, B channel =
 * metallic (per PBRMetallicRoughnessMaterial.metallicRoughnessTexture).
 * Roughness gets the same low-frequency mottling as the albedo/normal so
 * rough and smooth patches visually correlate with the bump (wear on raised
 * areas, roughness in recesses) instead of reading as an unrelated overlay. */
function drawMetallicRoughnessTexture(
  scene: Scene,
  name: string,
  size: number,
  seed: number,
  roughnessBase: number,
  roughnessSpread: number,
  metallic: number,
): DynamicTexture {
  const texture = new DynamicTexture(name, size, scene, false, Texture.TRILINEAR_SAMPLINGMODE);
  const ctx = texture.getContext() as CanvasRenderingContext2D;
  const out = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = Math.sin(x * 0.05 + seed * 2) * Math.cos(y * 0.06 + seed) * 0.5 + 0.5;
      const roughness = Math.max(0.05, Math.min(1, roughnessBase + (n - 0.5) * roughnessSpread));
      const idx = (y * size + x) * 4;
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

/** Tints a base color with small per-pixel variation so the albedo isn't a
 * single flat RGB fill — subtle edge tinting / wear, per the brief's
 * "avoid pure flat RGB fills" rule. */
function drawAlbedoVariation(scene: Scene, name: string, size: number, seed: number, base: Color3, variation: number): DynamicTexture {
  const texture = new DynamicTexture(name, size, scene, false, Texture.TRILINEAR_SAMPLINGMODE);
  const ctx = texture.getContext() as CanvasRenderingContext2D;
  const rand = mulberry32(seed + 1);
  const out = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Low-frequency variation: sample a handful of overlapping sine waves
      // rather than pure per-pixel noise, so it reads as soft mottling
      // rather than static/grain.
      const n = Math.sin(x * 0.09 + seed) * Math.cos(y * 0.07 + seed * 0.5) * 0.5 + Math.sin(x * 0.21 - y * 0.13 + seed * 1.7) * 0.5;
      const jitter = (rand() - 0.5) * 0.15;
      const t = Math.max(-1, Math.min(1, n + jitter)) * variation;
      const idx = (y * size + x) * 4;
      out.data[idx] = Math.max(0, Math.min(255, (base.r + t) * 255));
      out.data[idx + 1] = Math.max(0, Math.min(255, (base.g + t) * 255));
      out.data[idx + 2] = Math.max(0, Math.min(255, (base.b + t) * 255));
      out.data[idx + 3] = 255;
    }
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

const familyCache = new Map<string, TextureFamily>();

/**
 * Builds (once, cached by name) a shared albedo/normal/AO/metallic-roughness
 * texture quartet for a material *family* (soil, stone, wood, painted-metal,
 * ...). Every material in that family reuses the exact same four textures
 * and just tints baseColor — this is the "shared PBR materials, not one
 * texture per object" performance rule in practice.
 */
function getOrCreateFamily(
  scene: Scene,
  familyName: string,
  opts: {
    seed: number;
    baseColor: Color3;
    blotches: number;
    blotchRadius: number;
    bumpStrength: number;
    roughnessBase: number;
    roughnessSpread: number;
    albedoVariation: number;
    metallic: number;
  },
): TextureFamily {
  const cached = familyCache.get(familyName);
  if (cached) return cached;
  const size = 128;
  const height = drawHeightField(size, opts.seed, opts.blotches, opts.blotchRadius);
  const family: TextureFamily = {
    albedo: drawAlbedoVariation(scene, `terrarium.pbr.${familyName}.albedo`, size, opts.seed, opts.baseColor, opts.albedoVariation),
    normal: heightFieldToNormalTexture(scene, `terrarium.pbr.${familyName}.normal`, height, size, opts.bumpStrength),
    occlusion: heightFieldToOcclusionTexture(scene, `terrarium.pbr.${familyName}.ao`, height, size),
    metallicRoughness: drawMetallicRoughnessTexture(
      scene,
      `terrarium.pbr.${familyName}.metallicRoughness`,
      size,
      opts.seed,
      opts.roughnessBase,
      opts.roughnessSpread,
      opts.metallic,
    ),
  };
  familyCache.set(familyName, family);
  return family;
}

function applyFamily(material: PBRMetallicRoughnessMaterial, family: TextureFamily, tiling: number): void {
  for (const tex of [family.albedo, family.normal, family.occlusion, family.metallicRoughness]) {
    tex.uScale = tiling;
    tex.vScale = tiling;
  }
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
// Material recipes
// ---------------------------------------------------------------------------

/** Terrain/soil — layered loose soil rather than a flat plane: mottled
 * albedo, small bump for clumps/pebbles, rough matte response, gentle AO in
 * the "pores". Shared by the single ground mesh (world.ts). */
export function createSoilMaterial(scene: Scene): PBRMetallicRoughnessMaterial {
  const family = getOrCreateFamily(scene, 'soil', {
    seed: 7,
    baseColor: new Color3(0.24, 0.37, 0.21),
    blotches: 90,
    blotchRadius: 10,
    bumpStrength: 1.1,
    roughnessBase: 0.88,
    roughnessSpread: 0.18,
    albedoVariation: 0.07,
    metallic: 0,
  });
  const material = new PBRMetallicRoughnessMaterial('terrarium.ground.mat', scene);
  material.baseColor = Color3.White();
  material.baseTexture = family.albedo;
  applyFamily(material, family, 10);
  return material;
}

/** Garden path — satin-worn stone/soil tread carrying Subagent C's manifest
 * path illustration (`path.segment.straight`) as the albedo, with a shared
 * normal/AO/roughness detail pass layered on top. ONE shared material
 * instance for every path tile (world.ts creates this once, not per-tile —
 * converting each tile to its own PBRMaterial would multiply shader/uniform
 * cost for what is visually the same repeated surface; see
 * docs/MATERIAL_LIBRARY.md). */
export function createPathMaterial(scene: Scene, manifestKey: ManifestKey, fallbackColor: Color3): PBRMetallicRoughnessMaterial {
  const family = getOrCreateFamily(scene, 'path', {
    seed: 21,
    baseColor: new Color3(1, 1, 1),
    blotches: 40,
    blotchRadius: 14,
    bumpStrength: 0.6,
    roughnessBase: 0.55,
    roughnessSpread: 0.15,
    albedoVariation: 0.05,
    metallic: 0,
  });
  const material = createManifestMaterial(scene, 'terrarium.path.mat', manifestKey, fallbackColor);
  material.normalTexture = family.normal;
  material.occlusionTexture = family.occlusion;
  material.metallicRoughnessTexture = family.metallicRoughness;
  for (const tex of [family.normal, family.occlusion, family.metallicRoughness]) {
    tex.uScale = 1; // path art is one illustration per tile, not tiled repeat — only detail maps repeat
    tex.vScale = 1;
  }
  material.metallic = 1;
  material.roughness = 1;
  return material;
}

/** Rounded stone habitat drum body — bevel-friendly warm stone/ceramic, dry
 * stone roughness with slightly glossier warm edges. One shared stone
 * texture family across all 3 habitat bodies + the Nursery mound, tinted
 * per-habitat via baseColor. */
export function createStoneBodyMaterial(scene: Scene, name: string, tint: Color3): PBRMetallicRoughnessMaterial {
  const family = getOrCreateFamily(scene, 'stone', {
    seed: 13,
    baseColor: new Color3(1, 1, 1),
    blotches: 70,
    blotchRadius: 8,
    bumpStrength: 0.9,
    roughnessBase: 0.6,
    roughnessSpread: 0.22,
    albedoVariation: 0.05,
    metallic: 0,
  });
  const material = new PBRMetallicRoughnessMaterial(name, scene);
  material.baseColor = tint;
  material.baseTexture = family.albedo;
  material.baseTexture.level = 0.35; // subtle variation over the flat tint, not a competing pattern
  applyFamily(material, family, 3);
  return material;
}

/** Warm painted-wood/soil Nursery mound the Pod stands on — wood-grain-ish
 * streaked bump, satin roughness. */
export function createWoodBodyMaterial(scene: Scene, name: string, tint: Color3): PBRMetallicRoughnessMaterial {
  const family = getOrCreateFamily(scene, 'wood', {
    seed: 29,
    baseColor: new Color3(1, 1, 1),
    blotches: 26,
    blotchRadius: 18,
    bumpStrength: 0.5,
    roughnessBase: 0.45,
    roughnessSpread: 0.15,
    albedoVariation: 0.06,
    metallic: 0,
  });
  const material = new PBRMetallicRoughnessMaterial(name, scene);
  material.baseColor = tint;
  material.baseTexture = family.albedo;
  material.baseTexture.level = 0.3;
  applyFamily(material, family, 2);
  return material;
}

/** Painted garden-equipment metal/wood for automation site bodies — soft
 * satin roughness with a touch of metallic on scuffed highlight areas (small
 * brass-fitting-like glints, not a full metal look). */
export function createPaintedMetalMaterial(scene: Scene, name: string, tint: Color3): PBRMetallicRoughnessMaterial {
  const family = getOrCreateFamily(scene, 'paintedMetal', {
    seed: 41,
    baseColor: new Color3(1, 1, 1),
    blotches: 34,
    blotchRadius: 9,
    bumpStrength: 0.55,
    roughnessBase: 0.4,
    roughnessSpread: 0.2,
    albedoVariation: 0.05,
    metallic: 0.12,
  });
  const material = new PBRMetallicRoughnessMaterial(name, scene);
  material.baseColor = tint;
  material.baseTexture = family.albedo;
  material.baseTexture.level = 0.25;
  applyFamily(material, family, 2);
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
  const family = getOrCreateFamily(scene, 'water', {
    seed: 53,
    baseColor: new Color3(1, 1, 1),
    blotches: 18,
    blotchRadius: 22,
    bumpStrength: 0.8,
    roughnessBase: 0.12,
    roughnessSpread: 0.08,
    albedoVariation: 0.03,
    metallic: 0,
  });
  const material = new PBRMetallicRoughnessMaterial(name, scene);
  material.baseColor = new Color3(0.3, 0.55, 0.68);
  material.alpha = 0.88;
  applyFamily(material, family, 2);
  const update = (nowMs: number): void => {
    const t = nowMs / 4000;
    const normalTexture = material.normalTexture as Texture;
    normalTexture.uOffset = Math.sin(t) * 0.05;
    normalTexture.vOffset = Math.cos(t * 0.8) * 0.05;
  };
  return { material, update };
}
