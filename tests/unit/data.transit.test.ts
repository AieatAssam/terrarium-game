import { describe, expect, it } from 'vitest';
import {
  gardenSlidePrice,
  gardenSlideRefund,
  nextGardenSlidePrice,
  SPROUT_CONVEYOR_COST,
  TRANSIT_CAPS,
  transitCapMessage,
} from '../../src/data/transit';
import { conveyorLockReason, isConveyorUnlocked } from '../../src/data/unlocks';

describe('Garden Transit pricing', () => {
  it('pins the bounded Slide price sequence from GameRules §9.12', () => {
    expect([1, 2, 3, 4, 5, 6, 7].map(gardenSlidePrice)).toEqual([150, 270, 485, 875, 1575, 2400, 2400]);
  });

  it('charges the next Slide price from the number already owned', () => {
    expect([0, 1, 2, 3, 4, 5].map(nextGardenSlidePrice)).toEqual([150, 270, 485, 875, 1575, 2400]);
    expect(SPROUT_CONVEYOR_COST).toBe(15);
  });

  it('refunds the price of the count owned before removal', () => {
    expect(gardenSlideRefund(0)).toBe(0);
    expect(gardenSlideRefund(1)).toBe(150);
    expect(gardenSlideRefund(5)).toBe(1575);
  });

  it('keeps the Slide cap while leaving the route open-ended', () => {
    expect(TRANSIT_CAPS.gardenSlide).toBe(4);
    expect(TRANSIT_CAPS.sproutConveyor).toBe(Number.POSITIVE_INFINITY);
    expect(transitCapMessage('gardenSlide')).toContain('four Garden Slides');
    expect(transitCapMessage('sproutConveyor')).toContain('keep growing');
  });
});

describe('Garden Transit unlock sequencing', () => {
  it('keeps Conveyors locked until a Slide is placed', () => {
    expect(isConveyorUnlocked(0)).toBe(false);
    expect(conveyorLockReason(0)).toBe('Build a Garden Slide first to open a route for Sprouts.');
    expect(isConveyorUnlocked(1)).toBe(true);
    expect(conveyorLockReason(1)).toBeNull();
  });
});
