// Maps each SproutTypeId to a UI icon key + a safe fallback colour. Colour
// alone never carries meaning here — every sprout type also has a distinct
// icon silhouette (see icons.ts) so colour-blind players can tell them apart
// by shape. `safeColor` guards against B's still-in-progress data stub
// (`primaryColor: '#TODO'` is not valid CSS) so the UI never visibly breaks
// while data is being filled in.

import type { SproutTypeId } from '../core/ids';
import { SPROUT_TYPES } from '../data/sproutTypes';

import type { IconKey } from './icons';

const SPROUT_ICON_KEY: Record<SproutTypeId, IconKey> = {
  ember: 'sproutEmber',
  dew: 'sproutDew',
  sun: 'sproutSun',
  star: 'sproutStar',
};

const FALLBACK_COLOR: Record<SproutTypeId, string> = {
  ember: '#ff8a5c',
  dew: '#6fc4ff',
  sun: '#ffd75e',
  star: '#c9a6ff',
};

const HEX_COLOR_PATTERN = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

export function sproutIconKey(sproutType: SproutTypeId): IconKey {
  return SPROUT_ICON_KEY[sproutType];
}

/** assets/manifest.json key for this sprout's real icon art (data-driven —
 * see SproutTypeDefinition.silhouetteKey, e.g. "sprout.ember.icon"). */
export function sproutManifestIconKey(sproutType: SproutTypeId): string {
  return SPROUT_TYPES[sproutType]?.silhouetteKey ?? `sprout.${sproutType}.icon`;
}

export function safeColor(sproutType: SproutTypeId): string {
  const raw = SPROUT_TYPES[sproutType]?.primaryColor;
  if (raw && HEX_COLOR_PATTERN.test(raw)) return raw;
  return FALLBACK_COLOR[sproutType];
}

export function safeDisplayName(sproutType: SproutTypeId): string {
  return SPROUT_TYPES[sproutType]?.displayName ?? sproutType;
}
