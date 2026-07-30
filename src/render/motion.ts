// Reduced-motion + quality-level tuning. Kept as pure config selection (no
// Babylon imports, no DOM access at module scope) so it's cheap to unit test
// and safe to import from anywhere, including jsdom/vitest.

export type QualityLevel = 'high' | 'low';

export type EasingKind = 'bounce' | 'easeOut' | 'linear';

export interface MotionConfig {
  /** Multiplies idle/ambient animation amplitude (bob height, sway angle, etc). 0 = static. */
  ambientIntensity: number;
  /** Multiplies non-essential camera flourishes (e.g. settle-in drift). 0 = none. */
  cameraFlourish: number;
  /** ms for a placement-confirmation tween (habitat glow, sprout pop). Always > 0 — this is core feedback, never fully cut. */
  placementDurationMs: number;
  /** ms for a Sprout reveal-on-spawn tween. */
  revealDurationMs: number;
  /** ms for a transport (Garden Slide / Colour Gate ride) tween per tile step; actual duration also scales with distance. */
  transportStepMs: number;
  /** Easing family for confirmation/reveal tweens. Reduced motion drops bounce in favor of a calmer easeOut. */
  easing: EasingKind;
  /** Particle count multiplier (0..1) applied on top of a system's base count. */
  particleDensity: number;
  /** Ambient background motion (drifting particles, clearColor breathing) multiplier. 0 = static backdrop. */
  backgroundMotion: number;
  quality: QualityLevel;
}

/**
 * Pure selection: same (reducedMotion, quality) always yields the same
 * config. Core feedback (placementDurationMs > 0, revealDurationMs > 0)
 * never drops to zero — reduced motion makes it calmer/shorter, not absent.
 */
export function getMotionConfig(reducedMotion: boolean, quality: QualityLevel = 'high'): MotionConfig {
  const qualityParticleScale = quality === 'high' ? 1 : 0.4;

  if (reducedMotion) {
    return {
      ambientIntensity: 0,
      cameraFlourish: 0,
      placementDurationMs: 220,
      revealDurationMs: 180,
      transportStepMs: 260,
      easing: 'easeOut',
      particleDensity: 0.35 * qualityParticleScale,
      backgroundMotion: 0,
      quality,
    };
  }

  return {
    ambientIntensity: 1,
    cameraFlourish: 1,
    placementDurationMs: 420,
    revealDurationMs: 520,
    transportStepMs: 420,
    easing: 'bounce',
    particleDensity: 1 * qualityParticleScale,
    backgroundMotion: 1,
    quality,
  };
}

/** The attribute src/ui/prefs.ts reflects the RESOLVED reduced-motion
 * preference onto. Its own doc comment states the intent: "so other owners
 * (e.g. Subagent E's renderer, for reduced-motion) can read" it. */
const REDUCED_MOTION_ATTRIBUTE = 'data-reduced-motion';

/**
 * Whether ambient animation should be damped, safely readable in any
 * environment (guarded so calling this from a test under jsdom with no
 * `matchMedia` never throws — it just reports "not reduced").
 *
 * Two sources, in priority order:
 *
 *   1. `<html data-reduced-motion>`, which src/ui/prefs.ts writes. This is the
 *      RESOLVED preference: it starts from the OS media query but the player
 *      can override it either way from the Settings panel's "Reduced motion"
 *      toggle, so once present it is authoritative.
 *   2. The `prefers-reduced-motion` media query, for the window before the UI
 *      has applied its prefs (and if the UI is absent entirely).
 *
 * Previously only (2) was consulted, which meant the in-game toggle changed the
 * CSS but never reached the renderer — Sprout bob, background drift and the new
 * path conveyor all kept animating for a player who had explicitly asked them
 * not to. Found while wiring the conveyor's reduced-motion behaviour.
 */
export function prefersReducedMotion(): boolean {
  if (typeof document !== 'undefined') {
    const attribute = document.documentElement?.getAttribute(REDUCED_MOTION_ATTRIBUTE);
    if (attribute === 'true') return true;
    if (attribute === 'false') return false;
  }
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * Calls `onChange` whenever the resolved reduced-motion preference may have
 * changed — either the OS media query flipping or the Settings panel rewriting
 * the `<html>` attribute. Returns an unsubscribe function.
 */
export function watchReducedMotion(onChange: (reduced: boolean) => void): () => void {
  const cleanups: Array<() => void> = [];

  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    try {
      const query = window.matchMedia('(prefers-reduced-motion: reduce)');
      const handler = (): void => onChange(prefersReducedMotion());
      query.addEventListener?.('change', handler);
      cleanups.push(() => query.removeEventListener?.('change', handler));
    } catch {
      /* matchMedia unavailable or throwing — the attribute observer below still works */
    }
  }

  if (typeof MutationObserver === 'function' && typeof document !== 'undefined' && document.documentElement) {
    const observer = new MutationObserver(() => onChange(prefersReducedMotion()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: [REDUCED_MOTION_ATTRIBUTE] });
    cleanups.push(() => observer.disconnect());
  }

  return () => {
    for (const cleanup of cleanups) cleanup();
  };
}

/** Simple ease-out cubic, used for manual (non-Babylon-Animation) tweening. */
export function easeOutCubic(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return 1 - Math.pow(1 - clamped, 3);
}

/** Overshoot-and-settle "bounce" easing for the playful (non-reduced-motion) feel. */
export function easeOutBack(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(clamped - 1, 3) + c1 * Math.pow(clamped - 1, 2);
}

export function easingFn(kind: EasingKind): (t: number) => number {
  switch (kind) {
    case 'bounce':
      return easeOutBack;
    case 'easeOut':
      return easeOutCubic;
    case 'linear':
      return (t: number) => Math.min(1, Math.max(0, t));
  }
}
