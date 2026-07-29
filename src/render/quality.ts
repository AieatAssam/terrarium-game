// Tiny quality-level store. Subagent F's settings panel calls
// `setQualityLevel` (exported from src/render/index.ts); renderer internals
// subscribe via `onQualityChange` to resize particle counts / shadow map
// resolution without needing a reference back to the Babylon scene.

import type { QualityLevel } from './motion';

let current: QualityLevel = 'high';
const listeners = new Set<(level: QualityLevel) => void>();

export function getQualityLevel(): QualityLevel {
  return current;
}

export function setQualityLevel(level: QualityLevel): void {
  if (level === current) return;
  current = level;
  for (const listener of Array.from(listeners)) listener(current);
}

/** Returns an unsubscribe function. */
export function onQualityChange(listener: (level: QualityLevel) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Test-only: resets the module-level singleton between test cases. */
export function _resetQualityForTests(): void {
  current = 'high';
  listeners.clear();
}
