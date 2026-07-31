// Guards the Nursery waiting-area crowd cap (src/render/sprouts.ts), the
// counterpart to render.settleSlots.test.ts for habitats.
//
// Background: every idle Sprout used to sit at the EXACT SAME world position
// (the Nursery tile's centre), set once at spawn and never moved again unless
// dragged. GameRules §7.4 forbids ever deleting a Sprout for player inaction,
// so a long session's unclaimed queue can run into the hundreds — a measured
// save held 850 live Sprouts at 16.5 FPS. Past a small, fixed number of
// standing spots, a waiting Sprout is represented only by the mesh being
// disabled (still fully alive in SimState, still counted by the HUD note in
// src/ui/components/nurseryNote.ts) rather than drawn on top of another one.

import { describe, expect, it } from 'vitest';

import { NURSERY_VISIBLE_SLOTS, nurseryWaitOffset } from '../../src/render/sprouts';

describe('Nursery waiting slots', () => {
  it('has a small, fixed number of standing slots', () => {
    expect(NURSERY_VISIBLE_SLOTS).toBeGreaterThan(0);
    expect(NURSERY_VISIBLE_SLOTS).toBeLessThan(20); // a crowd, not a stadium
  });

  it('gives every visible slot a distinct position — no Sprout stacked on another', () => {
    const seen = new Set<string>();
    for (let i = 0; i < NURSERY_VISIBLE_SLOTS; i += 1) {
      const offset = nurseryWaitOffset(i);
      expect(offset, `slot ${i}`).not.toBeNull();
      seen.add(`${offset!.x.toFixed(4)},${offset!.z.toFixed(4)}`);
    }
    expect(seen.size).toBe(NURSERY_VISIBLE_SLOTS);
  });

  it('has no slot at all past the visible count, rather than wrapping onto an occupied one', () => {
    for (let i = NURSERY_VISIBLE_SLOTS; i < NURSERY_VISIBLE_SLOTS + 50; i += 1) {
      expect(nurseryWaitOffset(i), `index ${i}`).toBeNull();
    }
  });

  it('rejects a negative index rather than returning something plausible-looking', () => {
    expect(nurseryWaitOffset(-1)).toBeNull();
  });

  it('is deterministic, so a restored save rebuilds the same arrangement', () => {
    for (let i = 0; i < NURSERY_VISIBLE_SLOTS; i += 1) {
      expect(nurseryWaitOffset(i)).toEqual(nurseryWaitOffset(i));
    }
  });
});
