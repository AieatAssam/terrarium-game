import type { TransitArtifactKind } from '../core/ids';

export type PricedTransitKind = Extract<TransitArtifactKind, 'gardenSlide' | 'sproutConveyor'>;

export const TRANSIT_CAPS: Record<PricedTransitKind, number> = {
  gardenSlide: 4,
  sproutConveyor: 30,
};

export const SPROUT_CONVEYOR_COST = 15;

const GARDEN_SLIDE_BASE_COST = 150;
const GARDEN_SLIDE_GROWTH = 1.8;
const GARDEN_SLIDE_MAX_COST = 2400;

function roundTo5(value: number): number {
  return Math.round(value / 5) * 5;
}

/** Price of Slide N, where N is one-based. */
export function gardenSlidePrice(slideNumber: number): number {
  const number = Math.max(1, Math.trunc(slideNumber));
  return Math.min(GARDEN_SLIDE_MAX_COST, roundTo5(GARDEN_SLIDE_BASE_COST * GARDEN_SLIDE_GROWTH ** (number - 1)));
}

/** Price charged when placing the next Slide. */
export function nextGardenSlidePrice(ownedSlideCount: number): number {
  return gardenSlidePrice(ownedSlideCount + 1);
}

/** Refund when removing a Slide, using the count before removal. */
export function gardenSlideRefund(ownedSlideCount: number): number {
  return ownedSlideCount > 0 ? gardenSlidePrice(ownedSlideCount) : 0;
}

export function transitCapMessage(kind: PricedTransitKind): string {
  return kind === 'gardenSlide'
    ? 'Your garden has room for four Garden Slides for now.'
    : 'Your garden has room for thirty Sprout Conveyor segments for now.';
}

export function conveyorUnlockMessage(): string {
  return 'Build a Garden Slide first to open a route for Sprouts.';
}
