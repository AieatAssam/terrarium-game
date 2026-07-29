// Loads real UI/Sprout icon art from assets/manifest.json (Subagent C) for
// the handful of keys the UI layer wants — CONTRACTS.md's own example key is
// `ui.icon.gardenSlide`, so consuming the manifest here (not just inline
// hand-drawn icons) is the intended integration, not an extra.
//
// Fetched asynchronously and cached; callers always get an instant fallback
// (icons.ts) first render, then a swap-in once the real SVG arrives — this
// must never block or delay the onboarding callout's first paint.

const MANIFEST_URL = 'assets/manifest.json';

let manifestPromise: Promise<Record<string, string>> | undefined;
const svgCache = new Map<string, string>();
const listeners = new Set<() => void>();

function fetchManifest(): Promise<Record<string, string>> {
  manifestPromise ??= fetch(MANIFEST_URL)
    .then((res) => (res.ok ? (res.json() as Promise<Record<string, string>>) : {}))
    .catch(() => ({}));
  return manifestPromise;
}

/** Strips an XML prolog/DOCTYPE (innerHTML rejects those) before caching. */
function sanitizeSvgText(text: string): string {
  return text.replace(/<\?xml[^>]*\?>/i, '').replace(/<!DOCTYPE[^>]*>/i, '').trim();
}

function notifyReady(): void {
  for (const listener of listeners) listener();
}

/** Kicks off (idempotent) background loads for the given manifest keys. */
export function preloadManifestIcons(keys: string[]): void {
  void fetchManifest().then((manifest) => {
    for (const key of keys) {
      if (svgCache.has(key)) continue;
      const path = manifest[key];
      if (!path) continue;
      void fetch(path)
        .then((res) => (res.ok ? res.text() : undefined))
        .then((text) => {
          if (!text) return;
          svgCache.set(key, sanitizeSvgText(text));
          notifyReady();
        })
        .catch(() => {
          // Missing/broken asset — the caller's fallback icon just stays up.
        });
    }
  });
}

/** Synchronous cache read; undefined until the fetch above resolves. */
export function getManifestIcon(key: string): string | undefined {
  return svgCache.get(key);
}

/** Fires whenever any newly-loaded icon becomes available. */
export function onManifestIconsReady(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Real manifest art if loaded yet, else the given hand-drawn fallback markup. */
export function iconHtml(manifestKey: string, fallbackHtml: string): string {
  return getManifestIcon(manifestKey) ?? fallbackHtml;
}
