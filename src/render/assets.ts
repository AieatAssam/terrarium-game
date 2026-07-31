// assets/manifest.json loader + texture cache, owned by E per
// docs/CONTRACTS.md ("C delivers SVG source; E rasterizes/loads at
// runtime"). Subagent C may still be producing the manifest (and individual
// SVGs) while this module is in active use, so every lookup degrades
// gracefully: missing manifest, missing key, or a failed image load all log
// one warning and fall back to a flat-colored placeholder material instead
// of throwing. Nothing here assumes the manifest exists.

import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Material } from '@babylonjs/core/Materials/material';
import { PBRMetallicRoughnessMaterial } from '@babylonjs/core/Materials/PBR/pbrMetallicRoughnessMaterial';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import type { Scene } from '@babylonjs/core/scene';

export type ManifestKey = string;
type ManifestData = Record<ManifestKey, string>;

let manifest: ManifestData | undefined;
let manifestLoadAttempted = false;
const warnedKeys = new Set<string>();

function warnOnce(key: string, message: string): void {
  const dedupeKey = `${key}:${message}`;
  if (warnedKeys.has(dedupeKey)) return;
  warnedKeys.add(dedupeKey);
  console.warn(`[terrarium/render/assets] ${message}`);
}

/**
 * Fetches assets/manifest.json once. Safe to call multiple times (only the
 * first call actually fetches). Never throws — a missing/malformed manifest
 * just means every subsequent lookup falls back to a placeholder.
 */
export async function loadManifest(): Promise<void> {
  if (manifestLoadAttempted) return;
  manifestLoadAttempted = true;
  try {
    const base = import.meta.env.BASE_URL ?? '/';
    const url = `${base}${base.endsWith('/') ? '' : '/'}assets/manifest.json`;
    const response = await fetch(url);
    if (!response.ok) {
      warnOnce('__manifest__', `assets/manifest.json not found (HTTP ${response.status}) at "${url}" — rendering placeholders until it's available.`);
      return;
    }
    const data = (await response.json()) as unknown;
    if (data && typeof data === 'object') {
      manifest = data as ManifestData;
    } else {
      warnOnce('__manifest__', 'assets/manifest.json did not parse to an object — rendering placeholders.');
    }
  } catch (error) {
    warnOnce('__manifest__', `failed to load assets/manifest.json (${String(error)}) — rendering placeholders until it's available.`);
  }
}

/** Re-checks for the manifest becoming available (e.g. Subagent C finished mid-session). Clears the "missing manifest" warning dedupe so a fresh attempt can log again. */
export async function reloadManifest(): Promise<boolean> {
  manifestLoadAttempted = false;
  warnedKeys.delete('__manifest__:assets/manifest.json not found');
  await loadManifest();
  return manifest !== undefined;
}

export function hasManifestKey(key: ManifestKey): boolean {
  return !!manifest && key in manifest;
}

function resolveManifestUrl(key: ManifestKey): string | undefined {
  const path = manifest?.[key];
  if (!path) return undefined;
  if (/^https?:\/\//.test(path) || path.startsWith('/')) return path;
  // Must honour the deployment base, exactly as loadManifest already does for
  // manifest.json itself. A root-absolute "/assets/..." resolves against the
  // domain root, which is correct in dev but 404s everywhere on GitHub Pages,
  // where the game is served from a /<repo>/ subpath — every texture in the
  // build would have silently fallen back to a flat placeholder colour.
  const base = import.meta.env.BASE_URL ?? '/';
  return `${base}${base.endsWith('/') ? '' : '/'}${path}`;
}

const textureCache = new Map<string, Texture>();
const pendingLoads = new Map<string, Promise<void>>();

/** Opaque-content bounding box within a rasterized manifest texture, in 0..1
 * UV fractions of the (square) canvas, top-left origin (v=0 is the top row
 * as drawn — matches how the source SVG reads visually). Populated once per
 * key right after rasterization; see `getManifestContentBBox`. */
export interface ContentBBox {
  minU: number;
  minV: number;
  maxU: number;
  maxV: number;
}
const contentBBoxCache = new Map<string, ContentBBox>();
const contentBBoxWaiters = new Map<string, Array<(bbox: ContentBBox) => void>>();

/**
 * Fires `onReady` once `key`'s content bounding box has been computed —
 * immediately (synchronously) if it already has been, otherwise once
 * rasterization finishes. Deliberately NOT implemented on top of
 * `getManifestTexture`'s own onReady/isReady: a `DynamicTexture` reports
 * `isReady()` true as soon as it's constructed (its GPU texture exists),
 * well before its canvas actually has real pixels drawn into it, so a
 * second caller for an in-flight key would otherwise fire before the bbox
 * exists. This tracks the bbox's own readiness instead.
 */
export function onManifestContentBBoxReady(key: ManifestKey, onReady: (bbox: ContentBBox) => void): void {
  const existing = contentBBoxCache.get(key);
  if (existing) {
    onReady(existing);
    return;
  }
  const waiters = contentBBoxWaiters.get(key) ?? [];
  waiters.push(onReady);
  contentBBoxWaiters.set(key, waiters);
}

function resolveContentBBox(key: ManifestKey, bbox: ContentBBox): void {
  contentBBoxCache.set(key, bbox);
  const waiters = contentBBoxWaiters.get(key);
  if (!waiters) return;
  contentBBoxWaiters.delete(key);
  for (const waiter of waiters) waiter(bbox);
}

/**
 * Scans a rasterized canvas for the tight bounding box of non-transparent
 * pixels. Several source assets (habitat/nursery/automation "painted card"
 * illustrations — see docs/ART_DIRECTION.md §1) are authored as top-down
 * decals with a lot of transparent margin and an off-center baked ground
 * shadow, meant to be viewed lying flat. When the same texture is placed on
 * an upright billboarded standee (src/render/flatArt.ts), that margin makes
 * the art read as a small, oddly-placed blob on an otherwise-empty vertical
 * card. Callers that want the art to actually fill a standee crop the
 * texture's UV rect to this box instead of showing the full 0..1 square.
 * Sampled at a stride for performance — this only needs to be roughly right,
 * not pixel-perfect.
 */
function computeContentBBox(ctx: CanvasRenderingContext2D, size: number): ContentBBox {
  const stride = Math.max(1, Math.floor(size / 256)); // cap the scan cost on large canvases
  const { data } = ctx.getImageData(0, 0, size, size);
  let minX = size;
  let minY = size;
  let maxX = 0;
  let maxY = 0;
  let found = false;
  for (let y = 0; y < size; y += stride) {
    for (let x = 0; x < size; x += stride) {
      const alpha = data[(y * size + x) * 4 + 3];
      if (alpha > 12) {
        found = true;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (!found) return { minU: 0, minV: 0, maxU: 1, maxV: 1 };
  // Pad outward by half a stride so the crop doesn't clip anti-aliased edges.
  const pad = stride;
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(size, maxX + pad);
  maxY = Math.min(size, maxY + pad);
  return { minU: minX / size, minV: minY / size, maxU: maxX / size, maxV: maxY / size };
}

/** The cropped content bounding box for a manifest key's rasterized texture,
 * if it has finished loading — see `computeContentBBox`. Undefined until the
 * texture is ready (or if the key never loaded). */
export function getManifestContentBBox(key: ManifestKey): ContentBBox | undefined {
  return contentBBoxCache.get(key);
}

/**
 * Rasterizes an SVG URL to a square power-of-two canvas via a plain <img>
 * element. Babylon's Texture loader (and browsers' createImageBitmap, which
 * Babylon's WebGPU path uses internally) cannot decode SVG directly —
 * createImageBitmap throws InvalidStateError on SVG blobs in Chromium even
 * though <img> decodes the same SVG fine. This is the "E rasterizes SVG
 * source at runtime" step docs/CONTRACTS.md calls for.
 */
function rasterizeSvgToImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`image decode failed for ${url}`));
    img.src = url;
  });
}

function nextPowerOfTwo(n: number): number {
  return 2 ** Math.ceil(Math.log2(Math.max(1, n)));
}

/**
 * Loads (and caches) the texture for a manifest key. Returns undefined if
 * the key isn't in the manifest yet — callers use that to keep whatever
 * placeholder color they've already applied. `onReady` fires once the
 * texture actually finishes rasterizing since texture creation here is
 * asynchronous (SVG -> <img> -> canvas -> DynamicTexture).
 */
export function getManifestTexture(
  scene: Scene,
  key: ManifestKey,
  onReady?: (texture: Texture) => void,
  onFailed?: () => void,
): Texture | undefined {
  const cached = textureCache.get(key);
  if (cached) {
    if (cached.isReady()) onReady?.(cached);
    else cached.onLoadObservable.addOnce(() => onReady?.(cached));
    return cached;
  }

  const url = resolveManifestUrl(key);
  if (!url) {
    warnOnce(key, `manifest key "${key}" not found — using placeholder.`);
    return undefined;
  }

  if (pendingLoads.has(url)) return undefined;

  const size = 512;
  const texture = new DynamicTexture(`manifest:${key}`, size, scene, true, Texture.TRILINEAR_SAMPLINGMODE);
  texture.hasAlpha = true;

  const load = rasterizeSvgToImage(url)
    .then((img) => {
      // Square power-of-two canvas regardless of source aspect ratio (some
      // assets — e.g. the 400x260 automation art — aren't square). Letterbox
      // into the square with transparent padding instead of stretching, so
      // C's art isn't visibly distorted.
      const canvasSize = Math.min(1024, nextPowerOfTwo(Math.max(img.naturalWidth, img.naturalHeight)) || size);
      texture.scaleTo(canvasSize, canvasSize);
      const ctx = texture.getContext() as CanvasRenderingContext2D;
      ctx.clearRect(0, 0, canvasSize, canvasSize);
      const scale = Math.min(canvasSize / img.naturalWidth, canvasSize / img.naturalHeight);
      const drawW = img.naturalWidth * scale;
      const drawH = img.naturalHeight * scale;
      const offsetX = (canvasSize - drawW) / 2;
      const offsetY = (canvasSize - drawH) / 2;
      ctx.drawImage(img, offsetX, offsetY, drawW, drawH);
      texture.update(false);
      textureCache.set(key, texture);
      resolveContentBBox(key, computeContentBBox(ctx, canvasSize));
      onReady?.(texture);
    })
    .catch(() => {
      warnOnce(key, `failed to load asset for "${key}" (${url}) — using placeholder.`);
      textureCache.delete(key);
      onFailed?.();
    })
    .finally(() => {
      pendingLoads.delete(url);
    });

  pendingLoads.set(url, load);
  textureCache.set(key, texture);
  return texture;
}

/**
 * Builds (or updates) a PBRMetallicRoughnessMaterial for a manifest-keyed
 * sprite/base texture (Sprouts, Nursery/habitat/automation standee caps —
 * see src/render/flatArt.ts and src/render/sprouts.ts). Applies
 * `fallbackColor` immediately as a flat placeholder, then swaps in the real
 * texture asynchronously if/when it loads. If the manifest key is missing or
 * the image fails to load, the flat color stays — that's the "simple
 * colored placeholder shape" behavior the render module needs to work
 * standalone while assets/ is still being filled in.
 *
 * Moderate roughness/near-zero metallic by default so these read as painted
 * card/ceramic rather than plastic or metal — callers needing a different
 * physical character (e.g. an unlit Sprout billboard) adjust the returned
 * material directly (`disableLighting`, `roughness`, etc.).
 */
export function createManifestMaterial(scene: Scene, name: string, key: ManifestKey, fallbackColor: Color3): PBRMetallicRoughnessMaterial {
  const material = new PBRMetallicRoughnessMaterial(name, scene);
  material.baseColor = fallbackColor;
  material.metallic = 0;
  material.roughness = 0.55;
  material.backFaceCulling = false;
  // PBRMetallicRoughnessMaterial doesn't expose a public
  // `useAlphaFromAlbedoTexture` setter (only the sibling PBRMaterial class
  // does) even though the underlying PBRBaseMaterial field it drives is
  // shared by both — set the internal flag directly rather than switching
  // material classes just for this one flag.
  (material as unknown as { _useAlphaFromAlbedoTexture: boolean })._useAlphaFromAlbedoTexture = true;
  material.transparencyMode = Material.MATERIAL_ALPHABLEND;

  getManifestTexture(
    scene,
    key,
    (loadedTexture) => {
      // Use the callback's own parameter, not a closure over the outer
      // `const texture` — getManifestTexture can call onReady synchronously
      // on a cache hit, before that outer binding finishes initializing
      // (a real TDZ ReferenceError this hit during manual QA).
      material.baseTexture = loadedTexture;
      material.baseColor = Color3.White();
    },
    () => {
      // keep the flat fallbackColor placeholder
    },
  );

  return material;
}

/** Swaps an existing manifest-backed material to a different manifest key (e.g. sprout idle -> happy). Keeps the flat fallback color already set if the new key is unavailable. */
export function swapManifestMaterialTexture(scene: Scene, material: PBRMetallicRoughnessMaterial, key: ManifestKey): void {
  const texture = getManifestTexture(
    scene,
    key,
    (tex) => {
      material.baseTexture = tex;
      // Must mirror createManifestMaterial: `baseColor` starts as the flat
      // fallback and multiplies against the texture, so leaving it here made a
      // swapped material draw as a solid fallback-coloured rectangle. Only
      // visible when a material was swapped before its first texture ever
      // resolved — which is exactly what restoring a save does, since every
      // rebuilt Sprout is created and then immediately put into its settled or
      // idle state.
      material.baseColor = Color3.White();
    },
    () => {
      /* keep whatever texture/color was already showing */
    },
  );
  if (texture?.isReady()) {
    material.baseTexture = texture;
    material.baseColor = Color3.White();
  }
}

/** Test-only: clears module-level caches between test runs. */
export function _resetAssetsForTests(): void {
  manifest = undefined;
  manifestLoadAttempted = false;
  warnedKeys.clear();
  textureCache.clear();
  contentBBoxCache.clear();
  contentBBoxWaiters.clear();
}
