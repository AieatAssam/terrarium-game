// Stub — types + ids are final, values are placeholders for Subagent B.

import type { AchievementId } from '../core/ids';
import type { GameEvent, GameEventType } from '../events/types';

export interface AchievementDefinition {
  id: AchievementId;
  displayName: string;
  /** Which bus event type can possibly satisfy this achievement. */
  triggerEvent: GameEventType;
  /** TODO(B): real condition logic. Placeholder always fires on trigger. */
  condition: (event: GameEvent) => boolean;
  /** TODO(B): copy. */
  rewardText: string;
}

const alwaysTrue = (_event: GameEvent): boolean => true;

export const ACHIEVEMENTS: Record<AchievementId, AchievementDefinition> = {
  firstPlacement: {
    id: 'firstPlacement',
    displayName: 'TODO(B): First Placement',
    triggerEvent: 'sprout:placed:correct',
    condition: alwaysTrue,
    rewardText: 'TODO(B)',
  },
  firstAutomation: {
    id: 'firstAutomation',
    displayName: 'TODO(B): First Automation',
    triggerEvent: 'automation:built',
    condition: alwaysTrue,
    rewardText: 'TODO(B)',
  },
  firstFullHabitat: {
    id: 'firstFullHabitat',
    displayName: 'TODO(B): First Full Habitat',
    triggerEvent: 'habitat:full',
    condition: alwaysTrue,
    rewardText: 'TODO(B)',
  },
  firstRareSprout: {
    id: 'firstRareSprout',
    displayName: 'TODO(B): First Rare Sprout',
    triggerEvent: 'sprout:spawned',
    condition: alwaysTrue,
    rewardText: 'TODO(B)',
  },
  firstExpansion: {
    id: 'firstExpansion',
    displayName: 'TODO(B): First Expansion',
    triggerEvent: 'upgrade:purchased',
    condition: alwaysTrue,
    rewardText: 'TODO(B)',
  },
};

export const ACHIEVEMENT_LIST: AchievementDefinition[] = Object.values(ACHIEVEMENTS);
