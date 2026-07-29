// Stub — types + ids are final, values are placeholders. Subagent B fills in
// real balance numbers/copy in Phase 2 (docs/CONTRACTS.md: "Data-driven
// definitions (owned by B, consumed by A/E/F)").

import type { HabitatId, SproutTypeId } from '../core/ids';

export type SproutRarity = 'common' | 'rare';

export interface SproutTypeDefinition {
  id: SproutTypeId;
  displayName: string;
  /** Hex color, used for colour+shape encoding (never colour alone). */
  primaryColor: string;
  /** assets/manifest.json key for this sprout's default/icon art. */
  silhouetteKey: string;
  /** The one habitat this sprout correctly belongs in. */
  habitatId: HabitatId;
  rarity: SproutRarity;
}

export const SPROUT_TYPES: Record<SproutTypeId, SproutTypeDefinition> = {
  ember: {
    id: 'ember',
    displayName: 'TODO(B): Ember Sprout',
    primaryColor: '#TODO',
    silhouetteKey: 'sprout.ember.icon',
    habitatId: 'emberNook',
    rarity: 'common',
  },
  dew: {
    id: 'dew',
    displayName: 'TODO(B): Dew Sprout',
    primaryColor: '#TODO',
    silhouetteKey: 'sprout.dew.icon',
    habitatId: 'dewPond',
    rarity: 'common',
  },
  sun: {
    id: 'sun',
    displayName: 'TODO(B): Sun Sprout',
    primaryColor: '#TODO',
    silhouetteKey: 'sprout.sun.icon',
    habitatId: 'sunflowerMeadow',
    rarity: 'common',
  },
  star: {
    id: 'star',
    displayName: 'TODO(B): Star Sprout',
    primaryColor: '#TODO',
    silhouetteKey: 'sprout.star.icon',
    // TODO(B): decide Star Sprout's correct habitat / matching rule in
    // docs/GAME_DESIGN.md — placeholder so the type checks.
    habitatId: 'sunflowerMeadow',
    rarity: 'rare',
  },
};

export const SPROUT_TYPE_LIST: SproutTypeDefinition[] = Object.values(SPROUT_TYPES);
