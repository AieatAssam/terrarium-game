// Real balance values (Subagent B, Phase 2). Types + core ids are final per
// docs/CONTRACTS.md; see docs/GAME_DESIGN.md ("Star Sprout habitat rule") for
// the reasoning behind the Star Sprout decision below.

import type { HabitatId, SproutTypeId } from '../core/ids';

export type SproutRarity = 'common' | 'rare';

export interface SproutTypeDefinition {
  id: SproutTypeId;
  displayName: string;
  /** Hex color, used for colour+shape encoding (never colour alone). */
  primaryColor: string;
  /** assets/manifest.json key for this sprout's default/icon art. */
  silhouetteKey: string;
  /**
   * The one habitat this sprout correctly belongs in, or `null` if it has no
   * single correct habitat (see Star Sprout below). `null` is a deliberate,
   * distinct state from any HabitatId — it must never default to picking one
   * habitat as "the" answer. Consumers (placement validation in E's
   * src/input, copy in F's src/ui) must not compare this field directly;
   * use `sproutMatchesHabitat()` below instead.
   */
  habitatId: HabitatId | null;
  rarity: SproutRarity;
}

export const SPROUT_TYPES: Record<SproutTypeId, SproutTypeDefinition> = {
  ember: {
    id: 'ember',
    displayName: 'Ember Sprout',
    primaryColor: '#FF7A45',
    silhouetteKey: 'sprout.ember.icon',
    habitatId: 'emberNook',
    rarity: 'common',
  },
  dew: {
    id: 'dew',
    displayName: 'Dew Sprout',
    primaryColor: '#4FC3E8',
    silhouetteKey: 'sprout.dew.icon',
    habitatId: 'dewPond',
    rarity: 'common',
  },
  sun: {
    id: 'sun',
    displayName: 'Sun Sprout',
    primaryColor: '#FFD54F',
    silhouetteKey: 'sprout.sun.icon',
    habitatId: 'sunflowerMeadow',
    rarity: 'common',
  },
  star: {
    id: 'star',
    displayName: 'Star Sprout',
    primaryColor: '#B48EEA',
    silhouetteKey: 'sprout.star.icon',
    // Decision (docs/GAME_DESIGN.md "Star Sprout habitat rule"): there are 4
    // sprout types and only 3 habitats, so Star Sprout cannot have a single
    // "correct" habitat the way the 3 common types do. Rather than force it
    // into one habitat (the old placeholder silently mis-taught players that
    // Star only belongs in Sunflower Meadow), it settles happily in ANY of
    // the 3 habitats. `null` here means "any habitat is correct" — always go
    // through `sproutMatchesHabitat()`, never compare `habitatId` directly.
    habitatId: null,
    rarity: 'rare',
  },
};

export const SPROUT_TYPE_LIST: SproutTypeDefinition[] = Object.values(SPROUT_TYPES);

/**
 * The single sanctioned way to check "is dropping this Sprout type into this
 * Habitat a correct placement?" Encapsulates the `habitatId === null` (Star
 * Sprout, matches anything) case so no consumer has to special-case it.
 */
export function sproutMatchesHabitat(sproutType: SproutTypeId, habitatId: HabitatId): boolean {
  const def = SPROUT_TYPES[sproutType];
  return def.habitatId === null || def.habitatId === habitatId;
}
