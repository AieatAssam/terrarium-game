// Fixed-step accumulator. Feed it real elapsed frame time (variable, e.g.
// from requestAnimationFrame deltas); it tells you how many 100ms sim ticks
// to run so the simulation never drifts with frame rate. The renderer
// interpolates between ticks using the leftover accumulatorMs (CONTRACTS.md:
// "Fixed timestep (100ms) drives sim; renderer interpolates").

export const TICK_MS = 100;

export interface SimClock {
  accumulatorMs: number;
  tickCount: number;
}

export function createSimClock(): SimClock {
  return { accumulatorMs: 0, tickCount: 0 };
}

export interface AdvanceClockResult {
  clock: SimClock;
  ticksToRun: number;
}

/**
 * Clamp guards against a huge single delta (e.g. the render loop was
 * throttled/paused in a background tab for minutes) turning into an equally
 * huge synchronous tick burst on resume. This is a deviation from
 * CONTRACTS.md, which doesn't mention a clamp — flagged for the integrator.
 *
 * IMPORTANT: offline progress (CONTRACTS.md `save:loaded` event's
 * `offlineSeconds`/`offlineDewdrops`, B's "offline cap") must NOT be computed
 * by feeding a multi-hour delta through advanceClock — it will silently be
 * clamped to ~10 ticks. Offline catch-up needs its own calculation (e.g. a
 * closed-form formula over elapsed real time, capped separately), not a
 * degenerate case of the render-loop accumulator.
 */
const MAX_DELTA_MS = 1000;

export function advanceClock(
  clock: SimClock,
  realDeltaMs: number,
  tickMs: number = TICK_MS,
): AdvanceClockResult {
  const cappedDelta = Math.max(0, Math.min(realDeltaMs, MAX_DELTA_MS));
  let accumulatorMs = clock.accumulatorMs + cappedDelta;
  let ticksToRun = 0;

  while (accumulatorMs >= tickMs) {
    accumulatorMs -= tickMs;
    ticksToRun += 1;
  }

  return {
    clock: { accumulatorMs, tickCount: clock.tickCount + ticksToRun },
    ticksToRun,
  };
}
