// Core string ids shared across the whole app. Copied verbatim from
// docs/CONTRACTS.md ("Core string ids (do not rename)"). Any agent needing a
// new id reports it back for a CONTRACTS.md update rather than redefining it
// locally.

export type SproutTypeId = 'ember' | 'dew' | 'sun' | 'star';

export type HabitatId = 'emberNook' | 'dewPond' | 'sunflowerMeadow';

export type AutomationId = 'gardenSlide' | 'colourGate';

export type UpgradeId =
  | 'podRhythm'
  | 'habitatCapacity'
  | 'gardenSlideSpeed'
  | 'dewdropMultiplier'
  | 'decorativeExpansion1'
  | 'colourGateUnlock';

export type AchievementId =
  'firstPlacement' | 'firstAutomation' | 'firstFullHabitat' | 'firstRareSprout' | 'firstExpansion';
