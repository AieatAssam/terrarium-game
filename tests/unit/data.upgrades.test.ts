import { describe, expect, it } from 'vitest';
import { getDewdropMultiplier, UPGRADE_LIST, UPGRADES } from '../../src/data/upgrades';
import { HABITATS } from '../../src/data/habitats';

describe('upgrade cost curves', () => {
  it('are monotonically increasing for every multi-level upgrade', () => {
    for (const upgrade of UPGRADE_LIST) {
      const costs = Array.from({ length: upgrade.maxLevel }, (_, i) => upgrade.costForLevel(i + 1));
      for (let i = 1; i < costs.length; i++) {
        expect(costs[i], `${upgrade.id} level ${i + 1} should cost more than level ${i}`).toBeGreaterThan(
          costs[i - 1],
        );
      }
      // Every cost is a positive, finite number — no placeholder zeros left over.
      for (const cost of costs) {
        expect(cost).toBeGreaterThan(0);
        expect(Number.isFinite(cost)).toBe(true);
      }
    }
  });

  it('level-1 costs are reachable within the first few minutes of settled-Sprout income', () => {
    // Sanity check against docs/GAME_DESIGN.md "Progression math": by the
    // time Garden Slide unlocks (~4-5 min in), a modest number of settled
    // Sprouts producing baseDewdropRate should already afford the cheapest
    // upgrades. This mirrors the doc's back-of-envelope estimate, not a full
    // sim run.
    const settledSproutsAtUnlock = 6; // conservative: well under the 24-slot habitat cap
    const ticksElapsed = 2700; // ~4.5 min at 100ms/tick
    const projectedDewdrops = settledSproutsAtUnlock * HABITATS.emberNook.baseDewdropRate * ticksElapsed;

    expect(UPGRADES.decorativeExpansion1.costForLevel(1)).toBeLessThanOrEqual(projectedDewdrops);
    expect(UPGRADES.podRhythm.costForLevel(1)).toBeLessThanOrEqual(projectedDewdrops);
  });
});

describe('getDewdropMultiplier', () => {
  it('is 1.0 with no dewdropMultiplier purchases', () => {
    expect(getDewdropMultiplier({})).toBe(1);
  });

  it('scales linearly with purchased levels', () => {
    const perLevel = UPGRADES.dewdropMultiplier.effect.magnitudePerLevel;
    expect(getDewdropMultiplier({ dewdropMultiplier: 1 })).toBeCloseTo(1 + perLevel);
    expect(getDewdropMultiplier({ dewdropMultiplier: 3 })).toBeCloseTo(1 + perLevel * 3);
  });
});
