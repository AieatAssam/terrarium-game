// Guards the settled-Sprout crowd cap and the habitat occupancy sign that
// takes over past it (src/render/sprouts.ts + src/render/habitats.ts).
//
// Background: settled Sprouts are parked in a 3-column x 2-row slot table on
// the habitat's viewer-facing side, and the row index used to be taken modulo
// the row count — so the SEVENTH settled Sprout landed on the *identical*
// world position as the first. Habitats hold 8 with no upgrades and 17 with
// Habitat Capacity maxed, so every player ended up with coincident,
// z-fighting, unselectable billboards covering the habitat's own art.
//
// The behaviour that replaced it has three parts worth pinning, all of them
// pure functions so they can be checked without a Babylon scene (same
// approach as render.sproutHeights.test.ts):
//
//   1. Only SETTLE_VISIBLE_SLOTS Sprouts get a sprite; the rest have none.
//   2. The visible crowd visibly TIGHTENS as the population approaches
//      capacity, which is what keeps occupancy readable from the world once
//      the headcount stops growing (GameRules §8.1 forbids leaning on text).
//   3. The occupancy sign appears only past the threshold, and its meter/full
//      state track the real capacity — including a capacity upgrade making a
//      previously-full habitat not full any more.

import { describe, expect, it } from 'vitest';

import { occupancySignState } from '../../src/render/habitats';
import { SETTLE_VISIBLE_SLOTS, settleCrowdSpacing, sproutSettleOffset } from '../../src/render/sprouts';
import { HABITAT_BODIES } from '../../src/render/propDims';

const BASE_CAPACITY = 8;
const MAX_CAPACITY = 17; // base 8 + habitatCapacity maxLevel 3 x magnitudePerLevel 3

/** Half the Sprout billboard's edge length — the sprite's own footprint. */
const SPROUT_HALF_WIDTH = 0.35;

describe('settled Sprout slots', () => {
  it('has exactly six standing slots, below even the un-upgraded capacity', () => {
    // The threshold has to sit below the SMALLEST capacity, or the transition
    // to a counted population would be an edge case most players never see.
    expect(SETTLE_VISIBLE_SLOTS).toBe(6);
    expect(SETTLE_VISIBLE_SLOTS).toBeLessThan(BASE_CAPACITY);
  });

  it('gives every visible slot a distinct position — no Sprout stacked on another', () => {
    const seen = new Set<string>();
    for (let i = 0; i < SETTLE_VISIBLE_SLOTS; i += 1) {
      const offset = sproutSettleOffset(i, SETTLE_VISIBLE_SLOTS, BASE_CAPACITY);
      expect(offset, `slot ${i}`).not.toBeNull();
      seen.add(`${offset!.x.toFixed(4)},${offset!.z.toFixed(4)}`);
    }
    expect(seen.size).toBe(SETTLE_VISIBLE_SLOTS);
  });

  it('has no slot at all past the threshold, rather than wrapping onto an occupied one', () => {
    for (let i = SETTLE_VISIBLE_SLOTS; i < MAX_CAPACITY; i += 1) {
      expect(sproutSettleOffset(i, MAX_CAPACITY, MAX_CAPACITY), `index ${i}`).toBeNull();
    }
  });

  it('is deterministic, so a restored save rebuilds the same arrangement', () => {
    // A settling Sprout and a save-restored one both call this with the same
    // (index, count, capacity); they must not land in different places.
    for (let i = 0; i < SETTLE_VISIBLE_SLOTS; i += 1) {
      const live = sproutSettleOffset(i, 11, MAX_CAPACITY);
      const restored = sproutSettleOffset(i, 11, MAX_CAPACITY);
      expect(restored).toEqual(live);
    }
  });

  it('keeps every slot on the smallest habitat drum\'s flat top face', () => {
    // Ember Nook is the tightest: 1.1 outer radius less its 0.1 rim bevel.
    const emberFlatRadius = HABITAT_BODIES.emberNook.halfWidth - HABITAT_BODIES.emberNook.profile.topBevel;
    for (const [count, capacity] of [
      [1, BASE_CAPACITY],
      [SETTLE_VISIBLE_SLOTS, MAX_CAPACITY],
      [MAX_CAPACITY, MAX_CAPACITY],
    ]) {
      for (let i = 0; i < SETTLE_VISIBLE_SLOTS; i += 1) {
        const offset = sproutSettleOffset(i, count, capacity)!;
        expect(Math.hypot(offset.x, offset.z), `slot ${i} at ${count}/${capacity}`).toBeLessThan(emberFlatRadius);
      }
    }
  });
});

describe('crowd packing', () => {
  it('stays roomy while the headcount itself is still the display', () => {
    const roomy = settleCrowdSpacing(1, BASE_CAPACITY);
    expect(settleCrowdSpacing(SETTLE_VISIBLE_SLOTS, BASE_CAPACITY)).toEqual(roomy);
    // Neighbours still overlap a little at the loosest spacing — that is the
    // intended cosy huddle, not an error — but they are never coincident.
    expect(roomy.lateral).toBeGreaterThan(0.3);
  });

  it('tightens monotonically as a habitat fills, for both capacities', () => {
    for (const capacity of [BASE_CAPACITY, MAX_CAPACITY]) {
      let previous = settleCrowdSpacing(SETTLE_VISIBLE_SLOTS, capacity);
      for (let count = SETTLE_VISIBLE_SLOTS + 1; count <= capacity; count += 1) {
        const spacing = settleCrowdSpacing(count, capacity);
        expect(spacing.lateral, `${count}/${capacity} lateral`).toBeLessThan(previous.lateral);
        expect(spacing.row, `${count}/${capacity} row`).toBeLessThan(previous.row);
        previous = spacing;
      }
      // A full habitat is visibly more packed than one that just crossed the
      // threshold — this is the "plainly has no room" signal GameRules §8.1
      // asks for, carried by the world rather than by the sign's text.
      expect(settleCrowdSpacing(capacity, capacity).lateral).toBeLessThan(
        settleCrowdSpacing(SETTLE_VISIBLE_SLOTS, capacity).lateral * 0.85,
      );
    }
  });

  it('never packs neighbours so tightly that they become one blob', () => {
    const tightest = settleCrowdSpacing(MAX_CAPACITY, MAX_CAPACITY);
    // Two 0.7-wide billboards at this spacing still leave each silhouette's
    // outer half clear, so six creatures remain six creatures.
    expect(tightest.lateral).toBeGreaterThan(SPROUT_HALF_WIDTH * 0.7);
  });

  it('loosens again when a capacity upgrade adds room', () => {
    // Eight Sprouts in an eight-capacity habitat are shoulder to shoulder;
    // the same eight in a seventeen-capacity habitat have space again.
    expect(settleCrowdSpacing(BASE_CAPACITY, MAX_CAPACITY).lateral).toBeGreaterThan(
      settleCrowdSpacing(BASE_CAPACITY, BASE_CAPACITY).lateral,
    );
  });
});

describe('habitat occupancy sign', () => {
  const stateFor = (count: number, capacity: number) => occupancySignState(count, capacity, SETTLE_VISIBLE_SLOTS);

  it('stays hidden while every settled Sprout is still shown individually', () => {
    for (let count = 0; count <= SETTLE_VISIBLE_SLOTS; count += 1) {
      expect(stateFor(count, BASE_CAPACITY).visible, `count ${count}`).toBe(false);
    }
  });

  it('appears exactly when the first Sprout loses its standing slot', () => {
    expect(stateFor(SETTLE_VISIBLE_SLOTS + 1, BASE_CAPACITY).visible).toBe(true);
    expect(stateFor(SETTLE_VISIBLE_SLOTS + 1, BASE_CAPACITY).count).toBe(SETTLE_VISIBLE_SLOTS + 1);
  });

  it('can never reach "full" while still hidden', () => {
    // Only true because the smallest capacity is above the slot count; if a
    // future habitat held six or fewer, "no room" would have to be shown some
    // other way and this guard is where that would be noticed.
    for (let count = 0; count <= SETTLE_VISIBLE_SLOTS; count += 1) {
      expect(stateFor(count, BASE_CAPACITY).full, `count ${count}`).toBe(false);
    }
  });

  it('reports a meter fraction that tracks real occupancy', () => {
    expect(stateFor(10, MAX_CAPACITY).fill).toBeCloseTo(10 / 17, 6);
    expect(stateFor(BASE_CAPACITY, BASE_CAPACITY).fill).toBe(1);
  });

  it('clears the full state as soon as a capacity upgrade adds room', () => {
    // The renderer derives capacity from the upgrade level rather than from
    // the sim's sticky "is full" set, precisely so this works: a habitat that
    // was full must stop showing its no-room cues the instant it gains space.
    expect(stateFor(BASE_CAPACITY, BASE_CAPACITY).full).toBe(true);
    expect(stateFor(BASE_CAPACITY, BASE_CAPACITY + 3).full).toBe(false);
    expect(stateFor(BASE_CAPACITY, BASE_CAPACITY + 3).fill).toBeLessThan(1);
  });

  it('clamps a population that somehow exceeds capacity instead of overdrawing', () => {
    expect(stateFor(99, BASE_CAPACITY).fill).toBe(1);
    expect(stateFor(99, BASE_CAPACITY).full).toBe(true);
    expect(stateFor(3, 0).capacity).toBeGreaterThan(0); // no divide-by-zero meter
  });
});
