import { describe, expect, it } from 'vitest';
import { ACHIEVEMENTS } from '../../src/data/achievements';
import type { GameEvent, GameEventType } from '../../src/events/types';

describe('achievement trigger events map to the GameEvent union', () => {
  const validTypes: GameEventType[] = [
    'sprout:spawned',
    'sprout:pickedUp',
    'sprout:dropped',
    'sprout:placed:correct',
    'sprout:placed:incorrect',
    'sprout:settled',
    'habitat:dewdropTick',
    'habitat:full',
    'currency:dewdropsChanged',
    'sprout:transportStarted',
    'sprout:transportCompleted',
    'automation:built',
    'automation:unlocked',
    'upgrade:purchased',
    'achievement:unlocked',
    'journal:entryDiscovered',
    'save:loaded',
    'save:written',
  ];

  it('every achievement triggerEvent is a real GameEvent type', () => {
    for (const achievement of Object.values(ACHIEVEMENTS)) {
      expect(validTypes).toContain(achievement.triggerEvent);
    }
  });

  it('firstPlacement triggers on sprout:placed:correct', () => {
    expect(ACHIEVEMENTS.firstPlacement.triggerEvent).toBe('sprout:placed:correct');
  });

  it('firstAutomation triggers on automation:built', () => {
    expect(ACHIEVEMENTS.firstAutomation.triggerEvent).toBe('automation:built');
  });

  it('firstFullHabitat triggers on habitat:full', () => {
    expect(ACHIEVEMENTS.firstFullHabitat.triggerEvent).toBe('habitat:full');
  });

  it('firstRareSprout triggers on sprout:spawned', () => {
    expect(ACHIEVEMENTS.firstRareSprout.triggerEvent).toBe('sprout:spawned');
  });

  it('firstExpansion triggers on upgrade:purchased', () => {
    expect(ACHIEVEMENTS.firstExpansion.triggerEvent).toBe('upgrade:purchased');
  });
});

describe('achievement conditions', () => {
  it('firstRareSprout only fires for a Star Sprout, not the common types', () => {
    const starEvent: GameEvent = { type: 'sprout:spawned', sproutId: 's1', sproutType: 'star', podId: 'p1' };
    const emberEvent: GameEvent = { type: 'sprout:spawned', sproutId: 's2', sproutType: 'ember', podId: 'p1' };

    expect(ACHIEVEMENTS.firstRareSprout.condition(starEvent)).toBe(true);
    expect(ACHIEVEMENTS.firstRareSprout.condition(emberEvent)).toBe(false);
  });

  it('firstExpansion only fires for the decorativeExpansion1 upgrade, not other purchases', () => {
    const decorativeEvent: GameEvent = { type: 'upgrade:purchased', upgradeId: 'decorativeExpansion1', level: 1 };
    const otherEvent: GameEvent = { type: 'upgrade:purchased', upgradeId: 'podRhythm', level: 1 };

    expect(ACHIEVEMENTS.firstExpansion.condition(decorativeEvent)).toBe(true);
    expect(ACHIEVEMENTS.firstExpansion.condition(otherEvent)).toBe(false);
  });

  it('firstPlacement, firstAutomation, and firstFullHabitat fire for any event of their trigger type', () => {
    const placed: GameEvent = { type: 'sprout:placed:correct', sproutId: 's1', habitatId: 'emberNook' };
    const built: GameEvent = { type: 'automation:built', automationId: 'gardenSlide', instanceId: 'a1' };
    const full: GameEvent = { type: 'habitat:full', habitatId: 'dewPond' };

    expect(ACHIEVEMENTS.firstPlacement.condition(placed)).toBe(true);
    expect(ACHIEVEMENTS.firstAutomation.condition(built)).toBe(true);
    expect(ACHIEVEMENTS.firstFullHabitat.condition(full)).toBe(true);
  });
});
