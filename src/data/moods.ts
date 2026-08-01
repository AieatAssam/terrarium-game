// Mood Bell feature (2026-08-01). A second, orthogonal Sprout attribute —
// see docs/CONTRACTS.md ("Members added for the Mood Bell") and
// docs/_scratch/GameRules.md §7.3/§9.5. Deliberately has NO habitatId-style
// field: unlike sproutType, mood never determines which habitat is correct
// for a Sprout — it only determines whether the Mood Bell will carry it.

import type { MoodId } from '../core/ids';

export interface MoodDefinition {
  id: MoodId;
  displayName: string;
  /** Hex color, used for colour+shape encoding (never colour alone). */
  primaryColor: string;
  /** assets/manifest.json key for this mood's badge art. */
  silhouetteKey: string;
}

export const MOODS: Record<MoodId, MoodDefinition> = {
  sunny: {
    id: 'sunny',
    displayName: 'Sunny',
    primaryColor: '#FFD54F',
    silhouetteKey: 'mood.sunny.badge',
  },
  sleepy: {
    id: 'sleepy',
    displayName: 'Sleepy',
    primaryColor: '#7986CB',
    silhouetteKey: 'mood.sleepy.badge',
  },
};

export const MOOD_LIST: MoodDefinition[] = Object.values(MOODS);
