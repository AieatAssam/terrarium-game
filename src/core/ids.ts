// Core string ids shared across the whole app. Copied verbatim from
// docs/CONTRACTS.md ("Core string ids (do not rename)"). Any agent needing a
// new id reports it back for a CONTRACTS.md update rather than redefining it
// locally.

export type SproutTypeId = 'ember' | 'dew' | 'sun' | 'star';

export type HabitatId = 'emberNook' | 'dewPond' | 'sunflowerMeadow';

/** A second, orthogonal Sprout attribute (GameRules §7.3) — never affects which habitat is correct for a Sprout. */
export type MoodId = 'sunny' | 'sleepy';

export type AutomationId = 'gardenSlide' | 'colourGate' | 'moodBell';

export type UpgradeId =
  | 'podRhythm'
  | 'habitatCapacity'
  | 'gardenSlideSpeed'
  | 'dewdropMultiplier'
  | 'decorativeExpansion1'
  | 'colourGateUnlock'
  | 'moodBellUnlock';

export type AchievementId =
  'firstPlacement' | 'firstAutomation' | 'firstFullHabitat' | 'firstRareSprout' | 'firstExpansion';
