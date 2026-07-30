// The Nursery's accumulation rule — GameRules §7.4 and §9.7.
//
// The pod used to open on a fixed cadence forever, while the three habitats cap
// at 8 each. Once every home filled, every subsequent Sprout was permanent
// clutter waiting at the Nursery: a real save was measured holding 768 live
// Sprouts, which is neither kind (§9.7) nor free of "visual chaos or selection
// frustration" (§7.4).
//
// The fix has to hold four things at once, and each of these tests pins one of
// them, because satisfying any three while breaking the fourth is easy:
//
//   1. the queue is BOUNDED — that's the actual bug;
//   2. no Sprout is EVER deleted or lost (§7.4 forbids despawning for player
//      inaction, so a cap must come from not spawning, never from removing);
//   3. there is no failure state and no punishment — recovery is always
//      available by settling Sprouts or buying room, and is never delayed by a
//      backlog of "owed" spawns firing all at once;
//   4. the player is TOLD, through a change the UI can react to.

import { describe, expect, it } from 'vitest';

import { createInitialSimState, type SimState } from '../../src/sim/state';
import { adjudicatePlacement, countWaitingSprouts, spawnSystem, TICK_SYSTEMS } from '../../src/sim/systems';
import { runTick } from '../../src/sim/tick';
import { TICK_MS } from '../../src/sim/loop';
import { NURSERY_TILE } from '../../src/sim/layout';
import {
  BASE_POD_SPAWN_INTERVAL_MS,
  NURSERY_EASE_THRESHOLD,
  NURSERY_REST_THRESHOLD,
  getNurseryPaceMultiplier,
  getNurseryRhythm,
} from '../../src/data/spawning';
import { HABITATS } from '../../src/data/habitats';
import { UNLOCK_THRESHOLDS } from '../../src/data/unlocks';
import type { GameEvent } from '../../src/events/types';

const CAP = HABITATS.emberNook.baseCapacity;

/** A state already holding `count` idle Sprouts at the Nursery. */
function waiting(count: number, overrides: Partial<SimState> = {}): SimState {
  const base = createInitialSimState(1);
  return {
    ...base,
    sprouts: Array.from({ length: count }, (_, i) => ({
      id: `waiting-${i}`,
      sproutType: 'ember' as const,
      tile: NURSERY_TILE,
      state: 'idle' as const,
    })),
    ...overrides,
  };
}

function runSpawn(state: SimState, ticks: number): { state: SimState; events: GameEvent[]; spawned: number } {
  let working = state;
  const events: GameEvent[] = [];
  let spawned = 0;
  for (let i = 0; i < ticks; i += 1) {
    const result = spawnSystem(working);
    working = result.state;
    for (const e of result.events) {
      events.push(e);
      if (e.type === 'sprout:spawned') spawned += 1;
    }
  }
  return { state: working, events, spawned };
}

const TICKS_PER_INTERVAL = Math.ceil(BASE_POD_SPAWN_INTERVAL_MS / TICK_MS);

describe('nursery rhythm thresholds', () => {
  it('stays lively while the waiting area is comfortable', () => {
    expect(getNurseryRhythm(0)).toBe('lively');
    expect(getNurseryRhythm(NURSERY_EASE_THRESHOLD)).toBe('lively');
    expect(getNurseryPaceMultiplier(NURSERY_EASE_THRESHOLD)).toBe(1);
  });

  it('eases gradually rather than dropping off a cliff', () => {
    // §9.7 wants the cause shown through world state BEFORE it bites. A pod that
    // goes straight from normal to stopped reads as a bug, not as a signal.
    let previous = 1;
    for (let n = NURSERY_EASE_THRESHOLD + 1; n < NURSERY_REST_THRESHOLD; n += 1) {
      expect(getNurseryRhythm(n)).toBe('easing');
      const multiplier = getNurseryPaceMultiplier(n);
      expect(multiplier).toBeGreaterThan(previous);
      previous = multiplier;
    }
  });

  it('rests once the waiting area is crowded, and stays rested above that', () => {
    expect(getNurseryRhythm(NURSERY_REST_THRESHOLD)).toBe('resting');
    expect(getNurseryRhythm(NURSERY_REST_THRESHOLD + 500)).toBe('resting');
  });

  it('leaves plenty of headroom under the Colour Gate’s own unlock condition', () => {
    // The Gate arms on a pile of unsorted Sprouts. If easing began below that
    // number the automation chain could throttle itself out of reach — the
    // coupling that already bit once between habitat capacity and the Garden
    // Slide threshold (see src/data/unlocks.ts).
    expect(UNLOCK_THRESHOLDS.colourGate.requiredUnsortedPileSize ?? 0).toBeLessThan(NURSERY_EASE_THRESHOLD);
    expect(NURSERY_EASE_THRESHOLD).toBeLessThan(NURSERY_REST_THRESHOLD);
  });
});

describe('countWaitingSprouts', () => {
  it('counts only the ones still looking for a home', () => {
    const state: SimState = {
      ...createInitialSimState(1),
      sprouts: [
        { id: 'a', sproutType: 'ember', tile: NURSERY_TILE, state: 'idle' },
        { id: 'b', sproutType: 'dew', tile: NURSERY_TILE, state: 'transporting' },
        { id: 'c', sproutType: 'sun', tile: NURSERY_TILE, state: 'settled' },
        // Pausing at the Colour Gate's signpost — still waiting for a home.
        { id: 'd', sproutType: 'ember', tile: { x: 8, z: 6 }, state: 'idle' },
      ],
    };
    expect(countWaitingSprouts(state)).toBe(2);
  });
});

describe('spawnSystem under a growing queue', () => {
  it('spawns at full pace while lively', () => {
    expect(runSpawn(waiting(0), TICKS_PER_INTERVAL * 3).spawned).toBe(3);
  });

  it('spawns more slowly, but still spawns, while easing', () => {
    const easing = NURSERY_REST_THRESHOLD - 1;
    const ticks = TICKS_PER_INTERVAL * 6;
    const eased = runSpawn(waiting(easing), ticks).spawned;
    const lively = runSpawn(waiting(0), ticks).spawned;
    expect(eased).toBeGreaterThan(0); // never a dead stop while merely easing
    expect(eased).toBeLessThan(lively);
  });

  it('adds nobody at all while resting — and removes nobody either', () => {
    const before = waiting(NURSERY_REST_THRESHOLD);
    const after = runSpawn(before, TICKS_PER_INTERVAL * 50);
    expect(after.spawned).toBe(0);
    // The cap comes from not spawning, NEVER from despawning (§7.4).
    expect(after.state.sprouts).toHaveLength(before.sprouts.length);
    expect(after.state.sprouts.map((s) => s.id)).toEqual(before.sprouts.map((s) => s.id));
  });

  it('announces a change of rhythm exactly once, not every tick', () => {
    const result = runSpawn(waiting(NURSERY_REST_THRESHOLD), TICKS_PER_INTERVAL * 4);
    const announcements = result.events.filter((e) => e.type === 'nursery:rhythmChanged');
    expect(announcements).toEqual([
      { type: 'nursery:rhythmChanged', rhythm: 'resting', waitingCount: NURSERY_REST_THRESHOLD },
    ]);
  });

  it('re-announces the crowd size as it shrinks, so the quoted number is never stale', () => {
    // The note quotes the figure ("814 little ones are waiting"). Announcing
    // only on a change of RHYTHM froze that number at whatever it was when the
    // pod dozed off, while the real one kept dropping as the player settled
    // Sprouts — seen in the browser against a real 814-Sprout garden. A stale
    // number is worse than no number.
    let state = runSpawn(waiting(NURSERY_REST_THRESHOLD), 5).state;
    state = { ...state, sprouts: state.sprouts.slice(0, NURSERY_REST_THRESHOLD - 1) };
    const result = runSpawn(state, 3);
    const announcements = result.events.filter((e) => e.type === 'nursery:rhythmChanged');
    expect(announcements).toEqual([
      { type: 'nursery:rhythmChanged', rhythm: 'easing', waitingCount: NURSERY_REST_THRESHOLD - 1 },
    ]);
  });

  it('does not re-announce for every ordinary spawn while lively', () => {
    // While lively the note is hidden, so the count is not news. The event must
    // stay rare rather than becoming a per-spawn stream.
    const result = runSpawn(waiting(0), TICKS_PER_INTERVAL * 4);
    expect(result.spawned).toBeGreaterThan(1);
    expect(result.events.filter((e) => e.type === 'nursery:rhythmChanged')).toEqual([]);
  });

  it('announces going back to lively when the garden recovers', () => {
    let state = runSpawn(waiting(NURSERY_REST_THRESHOLD), 10).state;
    expect(state.nurseryRhythm).toBe('resting');
    state = { ...state, sprouts: state.sprouts.slice(0, 2) }; // player settled most of them
    const result = runSpawn(state, 5);
    expect(result.events.filter((e) => e.type === 'nursery:rhythmChanged')).toEqual([
      { type: 'nursery:rhythmChanged', rhythm: 'lively', waitingCount: 2 },
    ]);
  });
});

describe('recovery is never punished', () => {
  it('does not fire a backlog of pods the moment the garden makes room', () => {
    // A garden left resting for forty pod-intervals must not answer the player's
    // tidying up with forty pods at once — that would turn solving the problem
    // into a fresh, larger version of it. The accumulator is clamped while
    // resting, so exactly one Sprout is "owed" no matter how long the rest was.
    const restedIntervals = 40;
    let state = waiting(NURSERY_REST_THRESHOLD);
    state = runSpawn(state, TICKS_PER_INTERVAL * restedIntervals).state;
    state = { ...state, sprouts: [] }; // everybody settled
    const recovered = runSpawn(state, TICKS_PER_INTERVAL);
    // One immediately (the owed pod), then the ordinary cadence resumes.
    expect(recovered.spawned).toBeLessThanOrEqual(2);
    expect(recovered.spawned).toBeGreaterThan(0);
  });

  it('picks straight back up once there is room, with no dead period', () => {
    let state = runSpawn(waiting(NURSERY_REST_THRESHOLD), TICKS_PER_INTERVAL * 5).state;
    state = { ...state, sprouts: [] };
    // First tick after recovery: the clamped accumulator is already at one full
    // interval, so a Sprout arrives promptly rather than after another wait.
    expect(runSpawn(state, 1).spawned).toBe(1);
  });

  it('lets a completely full garden recover by buying Habitat Room', () => {
    // The worst case the old code produced: every home full, Sprouts piling up
    // forever. Progress must never be permanently stalled — settled Sprouts keep
    // earning Dewdrops, and more room restarts everything.
    let state: SimState = {
      ...waiting(NURSERY_REST_THRESHOLD),
      habitats: {
        emberNook: { id: 'emberNook', count: CAP, capacity: CAP },
        dewPond: { id: 'dewPond', count: CAP, capacity: CAP },
        sunflowerMeadow: { id: 'sunflowerMeadow', count: CAP, capacity: CAP },
      },
    };
    expect(runSpawn(state, TICKS_PER_INTERVAL * 10).spawned).toBe(0);

    // Habitat Room is the recommended purchase the UI points at, and it is the
    // way out: more space, so the waiting crowd can be settled.
    state = { ...state, upgradeLevels: { habitatCapacity: 3 } };
    const toSettle = NURSERY_REST_THRESHOLD - NURSERY_EASE_THRESHOLD + 1;
    let settled = 0;
    for (const sprout of state.sprouts.slice(0, toSettle)) {
      const result = adjudicatePlacement(state, sprout.id, 'emberNook');
      if (result.events.some((e) => e.type === 'sprout:settled')) settled += 1;
      state = result.state;
    }
    expect(settled).toBe(toSettle); // room really did open up
    expect(countWaitingSprouts(state)).toBeLessThanOrEqual(NURSERY_EASE_THRESHOLD);
    // ...and the pod wakes up on its own, with no further prompting.
    const resumed = runSpawn(state, TICKS_PER_INTERVAL * 2);
    expect(resumed.spawned).toBeGreaterThan(0);
    expect(resumed.state.nurseryRhythm).not.toBe('resting');
  });
});

describe('the 768-Sprout regression', () => {
  it('keeps a neglected garden bounded over a very long unattended run', () => {
    // Drive the REAL tick system list for the equivalent of hours of play with
    // the player doing nothing at all, and with every home already full so
    // nothing can ever be delivered. Previously this grew without limit.
    let state: SimState = {
      ...createInitialSimState(11),
      habitats: {
        emberNook: { id: 'emberNook', count: CAP, capacity: CAP },
        dewPond: { id: 'dewPond', count: CAP, capacity: CAP },
        sunflowerMeadow: { id: 'sunflowerMeadow', count: CAP, capacity: CAP },
      },
    };
    let previousPopulation = 0;
    let everShrank = false;
    let peakPopulation = 0;
    for (let tick = 0; tick < 120_000; tick += 1) {
      state = runTick(state, TICK_SYSTEMS).state;
      // ...and never loses anybody along the way. Accumulated rather than
      // asserted per tick, so this stays one assertion instead of 120,000.
      if (state.sprouts.length < previousPopulation) everShrank = true;
      previousPopulation = state.sprouts.length;
      if (previousPopulation > peakPopulation) peakPopulation = previousPopulation;
    }
    expect(everShrank).toBe(false);
    expect(peakPopulation).toBeLessThanOrEqual(NURSERY_REST_THRESHOLD);
    expect(state.nurseryRhythm).toBe('resting');
    expect(countWaitingSprouts(state)).toBeLessThanOrEqual(NURSERY_REST_THRESHOLD);
    expect(state.sprouts.length).toBeLessThanOrEqual(NURSERY_REST_THRESHOLD);
  });
});
