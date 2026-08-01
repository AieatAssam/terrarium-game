// Real balance values (Subagent B, Phase 2). See docs/GAME_DESIGN.md
// ("Automation unlocks") for how these thresholds were derived and why
// Colour Gate's condition is behavioral rather than a placement count.

import type { AutomationId } from '../core/ids';
import { TICK_MS } from '../sim/loop';

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
  /** moodBell only: Colour Gate must already be built (alongside gardenSlide, via requiresGardenSlideBuilt). */
  requiresColourGateBuilt?: boolean;
}

export const UNLOCK_THRESHOLDS: Record<AutomationId, UnlockThreshold> = {
  gardenSlide: {
    automationId: 'gardenSlide',
    /**
     * Must stay below the garden's total base capacity (three habitats x
     * BASE_CAPACITY), because a placement into a full habitat is refused and
     * does not count. This value is load-bearing in two directions at once:
     * tests/unit/data.spawning.test.ts pins the intended 4-6 minute pacing to
     * roughly this many placements, while total capacity sets a hard ceiling
     * on how many are physically possible. BASE_CAPACITY was 6 (18 total),
     * i.e. below this number, so the Garden Slide could not be reached by
     * playing at all — every habitat filled, Sprouts piled up, and nothing
     * happened unless the player guessed that buying Habitat Capacity was an
     * unstated prerequisite. Raising BASE_CAPACITY to 8 (24 total) keeps the
     * deliberate pacing and makes it reachable; changing either number alone
     * re-breaks one side. Covered by the reachability test in
     * tests/unit/sim.systems.test.ts.
     */
    requiredCorrectPlacements: 20,
  },
  colourGate: {
    automationId: 'colourGate',
    requiredCorrectPlacements: 0,
    requiresGardenSlideBuilt: true,
    requiredSingleHabitatFeedTicks: 300,
    requiredUnsortedPileSize: 3,
  },
  moodBell: {
    automationId: 'moodBell',
    requiredCorrectPlacements: 0,
    // No tick/pile condition, unlike colourGate — simpler on purpose: "both
    // prior automations already exist" is itself the milestone (single-route
    // and dual-route both mastered, ready for a third routing dimension).
    requiresGardenSlideBuilt: true,
    requiresColourGateBuilt: true,
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

/**
 * Player-facing explanation of *why* the Colour Gate can't be bought yet, or
 * null once it can. The gate is behavioral, so an affordable-looking price
 * tag is not the whole story: without this, a player with plenty of Dewdrops
 * sees an enabled-looking button that silently does nothing when clicked
 * (purchaseUpgrade no-ops on the gate). GameRules.md §11 requires recovery
 * copy to be friendly and concrete, and §8.3 requires every upgrade to be
 * understandable — so this names the one specific thing still missing,
 * cheapest-to-satisfy first, in garden language rather than thresholds.
 */
export function colourGateLockReason(state: ColourGateUnlockState): string | null {
  if (isColourGateUnlocked(state)) return null;
  const threshold = UNLOCK_THRESHOLDS.colourGate;

  if (!state.gardenSlideBuilt) {
    return 'Your Garden Slide needs to be carrying Sprouts first.';
  }

  const ticksLeft = (threshold.requiredSingleHabitatFeedTicks ?? 0) - state.singleHabitatFeedTicks;
  if (ticksLeft > 0) {
    const secondsLeft = Math.ceil((ticksLeft * TICK_MS) / 1000);
    return `Let the Garden Slide work for about ${secondsLeft} more second${secondsLeft === 1 ? '' : 's'}.`;
  }

  const stillWaiting = (threshold.requiredUnsortedPileSize ?? 0) - state.unsortedPileSize;
  if (stillWaiting > 0) {
    return stillWaiting === 1
      ? 'One more Sprout of a kind the Slide does not carry needs to be waiting for a home.'
      : `${stillWaiting} more Sprouts of a kind the Slide does not carry need to be waiting for a home.`;
  }

  return null;
}

export interface MoodBellUnlockState {
  gardenSlideBuilt: boolean;
  colourGateBuilt: boolean;
}

export function isMoodBellUnlocked(state: MoodBellUnlockState): boolean {
  return state.gardenSlideBuilt && state.colourGateBuilt;
}

/** Mirrors colourGateLockReason's spirit: the one specific thing still missing, cheapest-to-satisfy first, in garden language. */
export function moodBellLockReason(state: MoodBellUnlockState): string | null {
  if (isMoodBellUnlocked(state)) return null;
  if (!state.gardenSlideBuilt) {
    return 'Your Garden Slide needs to be built first.';
  }
  return 'Your Colour Gate needs to be built first.';
}
