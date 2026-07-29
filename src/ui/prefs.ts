// Player preferences (audio volumes, mute, reduced-motion, high-contrast).
// These are NOT part of the SimState save envelope (src/persistence owns
// that shape) — deliberately a separate localStorage entry, per the brief:
// "preferences are not core SimState, don't conflate with the save
// envelope's version/sim shape."

export interface Prefs {
  musicVolume: number; // 0..1
  sfxVolume: number; // 0..1
  muted: boolean;
  reducedMotion: boolean;
  highContrast: boolean;
}

const STORAGE_KEY = 'terrarium.prefs.v1';

function defaultReducedMotion(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

function defaults(): Prefs {
  return {
    musicVolume: 0.5,
    sfxVolume: 0.7,
    muted: false,
    reducedMotion: defaultReducedMotion(),
    highContrast: false,
  };
}

function isValidPrefs(value: unknown): value is Prefs {
  if (!value || typeof value !== 'object') return false;
  const p = value as Record<string, unknown>;
  return (
    typeof p.musicVolume === 'number' &&
    typeof p.sfxVolume === 'number' &&
    typeof p.muted === 'boolean' &&
    typeof p.reducedMotion === 'boolean' &&
    typeof p.highContrast === 'boolean'
  );
}

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults();
    const parsed: unknown = JSON.parse(raw);
    return isValidPrefs(parsed) ? parsed : defaults();
  } catch {
    // Private-browsing storage access can throw, or the stored JSON can be
    // corrupt — either way, fall back to sane defaults rather than crash.
    return defaults();
  }
}

export function savePrefs(prefs: Prefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Best-effort persistence; not fatal if storage is unavailable/full.
  }
}

/**
 * Reflects reduced-motion/high-contrast onto <html> as data-attributes so
 * other owners (e.g. Subagent E's renderer, for reduced-motion) can read
 * player preference without importing anything from src/ui. This is a
 * proposed lightweight channel — flagged in the integration report, not
 * added to docs/CONTRACTS.md unilaterally.
 */
export function reflectPrefsToDocument(prefs: Prefs, root: HTMLElement = document.documentElement): void {
  root.dataset.reducedMotion = String(prefs.reducedMotion);
  root.dataset.contrast = prefs.highContrast ? 'high' : 'normal';
}
