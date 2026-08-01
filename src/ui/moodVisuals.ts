// Maps each MoodId to a UI icon key + a safe fallback colour. Mirrors
// sproutVisuals.ts's exact shape for the same reasons: colour alone never
// carries meaning (each mood also has a distinct icon silhouette — a circle
// vs. a square, see icons.ts), and `safeColor` guards against a malformed
// data value so the UI never visibly breaks.

import type { MoodId } from '../core/ids';
import { MOODS } from '../data/moods';

import type { IconKey } from './icons';

const MOOD_ICON_KEY: Record<MoodId, IconKey> = {
  sunny: 'moodSunny',
  sleepy: 'moodSleepy',
};

const FALLBACK_COLOR: Record<MoodId, string> = {
  sunny: '#ffd54f',
  sleepy: '#7986cb',
};

const HEX_COLOR_PATTERN = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

export function moodIconKey(mood: MoodId): IconKey {
  return MOOD_ICON_KEY[mood];
}

export function safeMoodColor(mood: MoodId): string {
  const raw = MOODS[mood]?.primaryColor;
  if (raw && HEX_COLOR_PATTERN.test(raw)) return raw;
  return FALLBACK_COLOR[mood];
}

export function safeMoodDisplayName(mood: MoodId): string {
  return MOODS[mood]?.displayName ?? mood;
}
