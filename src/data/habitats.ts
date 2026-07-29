// Stub — types + ids are final, values are placeholders for Subagent B.

import type { HabitatId, SproutTypeId } from '../core/ids';

export interface HabitatDefinition {
  id: HabitatId;
  displayName: string;
  /** TODO(B): balance. Max Sprouts this habitat can hold before "full". */
  baseCapacity: number;
  /** TODO(B): balance. Dewdrops produced per occupied habitat per tick. */
  baseDewdropRate: number;
  /** The one Sprout type that correctly belongs here. */
  matchSproutType: SproutTypeId;
}

export const HABITATS: Record<HabitatId, HabitatDefinition> = {
  emberNook: {
    id: 'emberNook',
    displayName: 'TODO(B): Ember Nook',
    baseCapacity: 0,
    baseDewdropRate: 0,
    matchSproutType: 'ember',
  },
  dewPond: {
    id: 'dewPond',
    displayName: 'TODO(B): Dew Pond',
    baseCapacity: 0,
    baseDewdropRate: 0,
    matchSproutType: 'dew',
  },
  sunflowerMeadow: {
    id: 'sunflowerMeadow',
    displayName: 'TODO(B): Sunflower Meadow',
    baseCapacity: 0,
    baseDewdropRate: 0,
    matchSproutType: 'sun',
  },
};

export const HABITAT_LIST: HabitatDefinition[] = Object.values(HABITATS);
