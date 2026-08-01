import { describe, expect, it } from 'vitest';
import {
  isColourGateUnlocked,
  isGardenSlideUnlocked,
  isMoodBellUnlocked,
  moodBellLockReason,
  UNLOCK_THRESHOLDS,
  type ColourGateUnlockState,
  type MoodBellUnlockState,
} from '../../src/data/unlocks';

describe('Garden Slide unlock threshold', () => {
  const required = UNLOCK_THRESHOLDS.gardenSlide.requiredCorrectPlacements;

  it('is locked one placement short of the threshold', () => {
    expect(isGardenSlideUnlocked(required - 1)).toBe(false);
  });

  it('unlocks at exactly the threshold, not one past it', () => {
    expect(isGardenSlideUnlocked(required)).toBe(true);
  });

  it('stays unlocked beyond the threshold', () => {
    expect(isGardenSlideUnlocked(required + 5)).toBe(true);
  });
});

describe('Colour Gate unlock condition', () => {
  const threshold = UNLOCK_THRESHOLDS.colourGate;
  const requiredFeedTicks = threshold.requiredSingleHabitatFeedTicks ?? 0;
  const requiredPile = threshold.requiredUnsortedPileSize ?? 0;

  function state(overrides: Partial<ColourGateUnlockState>): ColourGateUnlockState {
    return {
      gardenSlideBuilt: true,
      singleHabitatFeedTicks: requiredFeedTicks,
      unsortedPileSize: requiredPile,
      ...overrides,
    };
  }

  it('is locked if Garden Slide has not been built, even if the other conditions are met', () => {
    expect(isColourGateUnlocked(state({ gardenSlideBuilt: false }))).toBe(false);
  });

  it('is locked one feed-tick short of the threshold', () => {
    expect(isColourGateUnlocked(state({ singleHabitatFeedTicks: requiredFeedTicks - 1 }))).toBe(false);
  });

  it('is locked one Sprout short of the unsorted-pile threshold', () => {
    expect(isColourGateUnlocked(state({ unsortedPileSize: requiredPile - 1 }))).toBe(false);
  });

  it('unlocks at exactly all three thresholds simultaneously, not before', () => {
    expect(isColourGateUnlocked(state({}))).toBe(true);
  });

  it('stays unlocked beyond the thresholds', () => {
    expect(
      isColourGateUnlocked(state({ singleHabitatFeedTicks: requiredFeedTicks + 100, unsortedPileSize: requiredPile + 5 })),
    ).toBe(true);
  });
});

describe('Mood Bell unlock condition', () => {
  function state(overrides: Partial<MoodBellUnlockState>): MoodBellUnlockState {
    return { gardenSlideBuilt: true, colourGateBuilt: true, ...overrides };
  }

  it('is locked if neither prior automation is built', () => {
    expect(isMoodBellUnlocked(state({ gardenSlideBuilt: false, colourGateBuilt: false }))).toBe(false);
  });

  it('is locked if only Garden Slide is built', () => {
    expect(isMoodBellUnlocked(state({ colourGateBuilt: false }))).toBe(false);
  });

  it('is locked if only Colour Gate is built', () => {
    expect(isMoodBellUnlocked(state({ gardenSlideBuilt: false }))).toBe(false);
  });

  it('unlocks once both prior automations are built', () => {
    expect(isMoodBellUnlocked(state({}))).toBe(true);
  });

  it('moodBellLockReason names the specific missing automation in garden language, never the other automation\'s own gate details', () => {
    const noSlide = moodBellLockReason(state({ gardenSlideBuilt: false }));
    expect(noSlide).not.toBeNull();
    expect(noSlide).not.toMatch(/colourGateUnlock|gardenSlide/);

    const noGate = moodBellLockReason(state({ colourGateBuilt: false }));
    expect(noGate).not.toBeNull();
    expect(noGate).not.toMatch(/colourGateUnlock/);

    expect(moodBellLockReason(state({}))).toBeNull();
  });
});
