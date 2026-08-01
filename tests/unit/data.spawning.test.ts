import { describe, expect, it } from 'vitest';
import {
  BASE_POD_SPAWN_INTERVAL_MS,
  getPodSpawnIntervalMs,
  pickMood,
  pickSproutType,
  SPAWN_WEIGHTS,
  STAR_SPROUT_SPAWN_CHANCE,
} from '../../src/data/spawning';
import { UNLOCK_THRESHOLDS } from '../../src/data/unlocks';
import { nextRandom } from '../../src/sim/rng';
import type { MoodId, SproutTypeId } from '../../src/core/ids';

describe('spawn weights', () => {
  it('sum to exactly 1', () => {
    const total = Object.values(SPAWN_WEIGHTS).reduce((sum, w) => sum + w, 0);
    expect(total).toBe(1);
  });

  it('the 3 common types share an equal, non-star remainder', () => {
    expect(SPAWN_WEIGHTS.ember).toBe(SPAWN_WEIGHTS.dew);
    expect(SPAWN_WEIGHTS.dew).toBe(SPAWN_WEIGHTS.sun);
    expect(SPAWN_WEIGHTS.star).toBe(STAR_SPROUT_SPAWN_CHANCE);
  });
});

describe('pickSproutType', () => {
  it('is deterministic and covers the full [0,1) range without gaps', () => {
    // Lower edge of each cumulative band should resolve to that band's type.
    expect(pickSproutType(0)).toBe('ember');
    expect(pickSproutType(SPAWN_WEIGHTS.ember + 0.0001)).toBe('dew');
    expect(pickSproutType(SPAWN_WEIGHTS.ember + SPAWN_WEIGHTS.dew + 0.0001)).toBe('sun');
    expect(pickSproutType(1 - STAR_SPROUT_SPAWN_CHANCE / 2)).toBe('star');
    expect(pickSproutType(0.999999)).toBe('star');
  });
});

describe('pickMood', () => {
  it('is a deterministic 50/50 split', () => {
    expect(pickMood(0)).toBe('sunny');
    expect(pickMood(0.4999)).toBe('sunny');
    expect(pickMood(0.5)).toBe('sleepy');
    expect(pickMood(0.999999)).toBe('sleepy');
  });

  it('is uncorrelated with sproutType across a seeded run — mood must use its own RNG draw, never reuse the type roll', () => {
    // Regression guard for the exact bug an advisor review of this feature
    // flagged: if pickMood were ever called with the SAME random01 that
    // produced the type (instead of its own independent nextRandom draw),
    // mood would become a pure function of type — e.g. ember always sunny —
    // and the Mood Bell could never carry a mixed set of types. Two
    // INDEPENDENT successive nextRandom draws per iteration, matching how
    // spawnSystem must call these (see src/sim/systems.ts).
    let seed = 12345;
    const seenMoodsByType = new Map<SproutTypeId, Set<MoodId>>();
    for (let i = 0; i < 200; i += 1) {
      const typeRoll = nextRandom(seed);
      seed = typeRoll.nextSeed;
      const moodRoll = nextRandom(seed);
      seed = moodRoll.nextSeed;

      const type = pickSproutType(typeRoll.value);
      const mood = pickMood(moodRoll.value);
      const seen = seenMoodsByType.get(type) ?? new Set<MoodId>();
      seen.add(mood);
      seenMoodsByType.set(type, seen);
    }

    // Every common type seen should have shown up with BOTH moods at least
    // once in 200 iterations — if a type only ever produced one mood, mood
    // is almost certainly derived from (or correlated with) type rather
    // than independent of it.
    for (const [type, moods] of seenMoodsByType) {
      if (type === 'star') continue; // rare enough that 200 iterations may not sample both moods
      expect(moods.size, `sproutType "${type}" only ever produced mood(s): ${[...moods].join(', ')}`).toBe(2);
    }
  });
});

describe('getPodSpawnIntervalMs', () => {
  it('equals the base interval at level 0', () => {
    expect(getPodSpawnIntervalMs(0)).toBe(BASE_POD_SPAWN_INTERVAL_MS);
  });

  it('strictly decreases with each podRhythm level', () => {
    const level0 = getPodSpawnIntervalMs(0);
    const level1 = getPodSpawnIntervalMs(1);
    const level2 = getPodSpawnIntervalMs(2);
    expect(level1).toBeLessThan(level0);
    expect(level2).toBeLessThan(level1);
  });
});

describe('pacing target: Garden Slide unlock lands 4-6 minutes into play', () => {
  it('projected time-to-unlock (N placements at the base pod interval, 90% success rate) falls in [240s, 360s]', () => {
    // docs/GAME_DESIGN.md "Progression math": timeToUnlock ~= N * interval / successRate.
    // successRate models occasional missed/late drags; it is a documented
    // design assumption, not a simulated outcome.
    const requiredPlacements = UNLOCK_THRESHOLDS.gardenSlide.requiredCorrectPlacements;
    const assumedSuccessRate = 0.9;

    const projectedMs = (requiredPlacements * BASE_POD_SPAWN_INTERVAL_MS) / assumedSuccessRate;
    const projectedSeconds = projectedMs / 1000;

    expect(projectedSeconds).toBeGreaterThanOrEqual(240);
    expect(projectedSeconds).toBeLessThanOrEqual(360);
  });
});

describe('Star Sprout reachability in a ~20 minute session', () => {
  it('expected Star Sprout count is comfortably above 1 even under a pessimistic pod count', () => {
    // Pessimistic: only ~60 pods spawn/get handled in 20 minutes (slower than
    // the ~100 the base interval alone would allow), reflecting a session
    // that never buys podRhythm and spends real time on other things too.
    const pessimisticPodCount = 60;
    const expectedStars = pessimisticPodCount * STAR_SPROUT_SPAWN_CHANCE;
    expect(expectedStars).toBeGreaterThan(1);
  });

  it('probability of seeing zero Star Sprouts in 60 pods is low (comfortably reachable, not guaranteed-but-rare)', () => {
    const pessimisticPodCount = 60;
    const probabilityOfZero = (1 - STAR_SPROUT_SPAWN_CHANCE) ** pessimisticPodCount;
    expect(probabilityOfZero).toBeLessThan(0.05);
  });
});
