// Real balance values (Subagent B, Phase 2). See docs/GAME_DESIGN.md
// ("Automation unlocks") for how these thresholds were derived and why
// Colour Gate's condition is behavioral rather than a placement count.

import type { AutomationId } from '../core/ids';

export interface UnlockThreshold {
  automationId: AutomationId;
  /**
   * Correct manual placements (of any Sprout type) required before this
   * automation unlocks. Only meaningful for gardenSlide — colourGate uses 0
   * here and is gated by the fields below instead (it always unlocks after
   * gardenSlide anyway, so an independent placement count would be redundant).
   */
  requiredCorrectPlacements: number;
  /** colourGate only: Garden Slide must already be built. */
  requiresGardenSlideBuilt?: boolean;
  /**
   * colourGate only: consecutive sim ticks (100ms each) the single Garden
   * Slide must have been actively feeding its one target habitat. 300 ticks
   * == 30 seconds — long enough that the player has watched it work, not an
   * instant flash.
   */
  requiredSingleHabitatFeedTicks?: number;
  /**
   * colourGate only: minimum number of idle (unsorted, not-yet-placed)
   * Sprouts of a DIFFERENT type than the one the Garden Slide is feeding,
   * present at the same time. This is the measurable stand-in for
   * "experienced the limitation of one manual slide" — the slide only routes
   * one type/habitat, so while it happily feeds e.g. Ember Nook, Dew and Sun
   * Sprouts keep piling up unsorted at the nursery. Once 3 are waiting at
   * once, the player has visibly felt that limitation.
   */
  requiredUnsortedPileSize?: number;
}

export const UNLOCK_THRESHOLDS: Record<AutomationId, UnlockThreshold> = {
  gardenSlide: {
    automationId: 'gardenSlide',
    requiredCorrectPlacements: 20,
  },
  colourGate: {
    automationId: 'colourGate',
    requiredCorrectPlacements: 0,
    requiresGardenSlideBuilt: true,
    requiredSingleHabitatFeedTicks: 300,
    requiredUnsortedPileSize: 3,
  },
};

export const UNLOCK_THRESHOLD_LIST: UnlockThreshold[] = Object.values(UNLOCK_THRESHOLDS);

/** Exact-threshold check for Garden Slide: unlocks AT the required count, not one past it. */
export function isGardenSlideUnlocked(correctPlacements: number): boolean {
  return correctPlacements >= UNLOCK_THRESHOLDS.gardenSlide.requiredCorrectPlacements;
}

export interface ColourGateUnlockState {
  gardenSlideBuilt: boolean;
  /** Consecutive ticks the single Garden Slide has been actively feeding its one target habitat right now. */
  singleHabitatFeedTicks: number;
  /** How many Sprouts of a different type than the fed one are idle/unsorted right now. */
  unsortedPileSize: number;
}

export function isColourGateUnlocked(state: ColourGateUnlockState): boolean {
  const threshold = UNLOCK_THRESHOLDS.colourGate;
  return (
    state.gardenSlideBuilt &&
    state.singleHabitatFeedTicks >= (threshold.requiredSingleHabitatFeedTicks ?? 0) &&
    state.unsortedPileSize >= (threshold.requiredUnsortedPileSize ?? 0)
  );
}
