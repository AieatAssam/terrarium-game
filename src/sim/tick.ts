// Pure tick composition. A SimSystem is a pure function: (state) => next
// state + events emitted along the way. runTick composes zero or more
// systems, then advances the shared tick counter and PRNG exactly once per
// tick so behavior is identical regardless of which/how many systems run.
//
// Phase 1 ships no gameplay systems (that's Phase 2 content, owned by
// whoever implements a given feature) — this is the extension seam they
// plug into without touching the loop or the state shape.

import type { GameEvent } from '../events/types';
import { nextRandom } from './rng';
import type { SimState } from './state';

export interface TickResult {
  state: SimState;
  events: GameEvent[];
}

export type SimSystem = (state: SimState) => TickResult;

export function runTick(state: SimState, systems: readonly SimSystem[] = []): TickResult {
  let events: GameEvent[] = [];
  let next = state;

  for (const system of systems) {
    const result = system(next);
    next = result.state;
    if (result.events.length > 0) {
      events = events.concat(result.events);
    }
  }

  const { nextSeed } = nextRandom(next.rngSeed);
  next = { ...next, tickCount: next.tickCount + 1, rngSeed: nextSeed };

  return { state: next, events };
}
