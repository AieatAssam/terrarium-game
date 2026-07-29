import { describe, expect, it } from 'vitest';
import { createInitialSimState } from '../../src/sim/state';
import { runTick, type SimSystem } from '../../src/sim/tick';
import type { GameEvent } from '../../src/events/types';

// A toy system used only to prove that `runTick` composition is
// deterministic given the same input sequence — it is test-local, not
// gameplay content living in src/.
const collectDewdrop: SimSystem = (state) => {
  const events: GameEvent[] = [
    { type: 'currency:dewdropsChanged', total: state.dewdrops + 1, delta: 1 },
  ];
  return { state: { ...state, dewdrops: state.dewdrops + 1 }, events };
};

function runN(seed: number, n: number, systems: readonly SimSystem[]) {
  let state = createInitialSimState(seed);
  const allEvents: GameEvent[] = [];
  for (let i = 0; i < n; i++) {
    const result = runTick(state, systems);
    state = result.state;
    allEvents.push(...result.events);
  }
  return { state, allEvents };
}

describe('sim determinism', () => {
  it('produces deep-equal SimState for the same seed + same input sequence, run twice', () => {
    const runA = runN(12345, 50, [collectDewdrop]);
    const runB = runN(12345, 50, [collectDewdrop]);

    expect(runA.state).toEqual(runB.state);
    expect(runA.allEvents).toEqual(runB.allEvents);
  });

  it('advances tickCount and rngSeed deterministically without external randomness', () => {
    const { state } = runN(42, 10, []);
    expect(state.tickCount).toBe(10);
    // rngSeed must have moved from the initial seed (proves the PRNG is
    // actually being stepped as part of the tick, not just carried along).
    expect(state.rngSeed).not.toBe(42);
  });

  it('produces different states for different seeds (sanity check, not a hash test)', () => {
    const runA = runN(1, 25, [collectDewdrop]);
    const runB = runN(2, 25, [collectDewdrop]);
    expect(runA.state.rngSeed).not.toBe(runB.state.rngSeed);
  });
});
