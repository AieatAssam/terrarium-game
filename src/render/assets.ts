// assets/manifest.json loader + texture cache, owned by E per
// docs/CONTRACTS.md ("C delivers SVG source; E rasterizes/loads at
// runtime"). Subagent C may still be producing the manifest (and individual
// SVGs) while this module is in active use, so every lookup degrades
// gracefully: missing manifest, missing key, or a failed image load all log
// one warning and fall back to a flat-colored placeholder material instead
// of throwing. Nothing here assumes the manifest exists.

import { Color3 } from '@babylonjs/core/Maths/math.color';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
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
  return `/${path}`;
}

const textureCache = new Map<string, Texture>();
const pendingLoads = new Map<string, Promise<void>>();

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
 * Builds (or updates) a StandardMaterial for a manifest-keyed sprite/base
 * texture. Applies `fallbackColor` immediately as a flat placeholder, then
 * swaps in the real texture asynchronously if/when it loads. If the manifest
 * key is missing or the image fails to load, the flat color stays — that's
 * the "simple colored placeholder shape" behavior the render module needs
 * to work standalone while assets/ is still being filled in.
 */
export function createManifestMaterial(
  scene: Scene,
  name: string,
  key: ManifestKey,
  fallbackColor: Color3,
): StandardMaterial {
  const material = new StandardMaterial(name, scene);
  material.diffuseColor = fallbackColor;
  material.specularColor = Color3.Black();
  material.backFaceCulling = false;

  getManifestTexture(
    scene,
    key,
    (loadedTexture) => {
      // Use the callback's own parameter, not a closure over the outer
      // `const texture` — getManifestTexture can call onReady synchronously
      // on a cache hit, before that outer binding finishes initializing
      // (a real TDZ ReferenceError this hit during manual QA).
      material.diffuseTexture = loadedTexture;
      material.diffuseColor = Color3.White();
      material.useAlphaFromDiffuseTexture = true;
    },
    () => {
      // keep the flat fallbackColor placeholder
    },
  );

  return material;
}

/** Swaps an existing manifest-backed material to a different manifest key (e.g. sprout idle -> happy). Keeps the flat fallback color already set if the new key is unavailable. */
export function swapManifestMaterialTexture(scene: Scene, material: StandardMaterial, key: ManifestKey): void {
  const texture = getManifestTexture(
    scene,
    key,
    (tex) => {
      material.diffuseTexture = tex;
      material.useAlphaFromDiffuseTexture = true;
    },
    () => {
      /* keep whatever texture/color was already showing */
    },
  );
  if (texture?.isReady()) {
    material.diffuseTexture = texture;
    material.useAlphaFromDiffuseTexture = true;
  }
}

/** Test-only: clears module-level caches between test runs. */
export function _resetAssetsForTests(): void {
  manifest = undefined;
  manifestLoadAttempted = false;
  warnedKeys.clear();
  textureCache.clear();
}
