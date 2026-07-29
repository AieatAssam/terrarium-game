// Real balance values (Subagent B, Phase 2). Each achievement's `condition`
// narrows the GameEvent for its `triggerEvent` type — the achievement system
// (whoever wires it up) should call `condition(event)` only when
// `event.type === triggerEvent` AND the achievement isn't already unlocked;
// "first X" semantics come from that already-unlocked check, not from state
// tracked here (this module stays a pure, stateless table).

import type { AchievementId } from '../core/ids';
import type { GameEvent, GameEventType } from '../events/types';

export interface AchievementDefinition {
  id: AchievementId;
  displayName: string;
  /** Which bus event type can possibly satisfy this achievement. */
  triggerEvent: GameEventType;
  /** Extra condition beyond "this event type happened" (e.g. which sprout/upgrade). */
  condition: (event: GameEvent) => boolean;
  rewardText: string;
}

const alwaysTrue = (_event: GameEvent): boolean => true;

export const ACHIEVEMENTS: Record<AchievementId, AchievementDefinition> = {
  firstPlacement: {
    id: 'firstPlacement',
    displayName: 'First Placement',
    triggerEvent: 'sprout:placed:correct',
    // Any correct placement qualifies — "first" comes from the unlocked-check, not this condition.
    condition: alwaysTrue,
    rewardText: 'You guided your first Sprout home. The garden remembers.',
  },
  firstAutomation: {
    id: 'firstAutomation',
    displayName: 'First Automation',
    triggerEvent: 'automation:built',
    // Any automation instance being built qualifies (in practice this is always Garden Slide first).
    condition: alwaysTrue,
    rewardText: 'The Garden Slide is built — your Sprouts can find their own way now.',
  },
  firstFullHabitat: {
    id: 'firstFullHabitat',
    displayName: 'First Full Habitat',
    triggerEvent: 'habitat:full',
    // Any habitat reaching capacity qualifies, whichever one it is.
    condition: alwaysTrue,
    rewardText: "A habitat is full to the brim — maybe it's time to make more room.",
  },
  firstRareSprout: {
    id: 'firstRareSprout',
    displayName: 'First Rare Sprout',
    triggerEvent: 'sprout:spawned',
    // Not every spawn is rare: only fires for the Star Sprout specifically.
    condition: (event) => event.type === 'sprout:spawned' && event.sproutType === 'star',
    rewardText: 'A Star Sprout! It settles happily in any habitat you choose.',
  },
  firstExpansion: {
    id: 'firstExpansion',
    displayName: 'First Expansion',
    triggerEvent: 'upgrade:purchased',
    // Specifically the decorative expansion upgrade, not just any purchase.
    condition: (event) => event.type === 'upgrade:purchased' && event.upgradeId === 'decorativeExpansion1',
    rewardText: 'New scenery takes root. The garden is starting to feel like yours.',
  },
};

export const ACHIEVEMENT_LIST: AchievementDefinition[] = Object.values(ACHIEVEMENTS);
