import { describe, expect, it } from 'vitest';
import { advanceClock, createSimClock, TICK_MS } from '../../src/sim/loop';

describe('fixed-step accumulator', () => {
  it('runs exactly one tick for one exact tick-length delta', () => {
    let clock = createSimClock();
    const { clock: next, ticksToRun } = advanceClock(clock, TICK_MS);
    clock = next;
    expect(ticksToRun).toBe(1);
    expect(clock.accumulatorMs).toBe(0);
    expect(clock.tickCount).toBe(1);
  });

  it('does not drift with variable, irregular real-frame deltas', () => {
    // Irregular deltas as if from requestAnimationFrame at varying frame
    // rates, including a couple of hitches. Sum is a whole number of ticks
    // so we can assert an exact expected tick count.
    const deltas = [16, 16, 17, 16, 50, 1, 84, 300, 16, 16, 17, 16, 33, 202];
    const totalMs = deltas.reduce((sum, d) => sum + d, 0);
    expect(totalMs % TICK_MS).toBe(0); // sanity: fixture sums to whole ticks

    let clock = createSimClock();
    let totalTicks = 0;
    for (const delta of deltas) {
      const result = advanceClock(clock, delta);
      clock = result.clock;
      totalTicks += result.ticksToRun;
    }

    expect(totalTicks).toBe(totalMs / TICK_MS);
    expect(clock.tickCount).toBe(totalMs / TICK_MS);
    expect(clock.accumulatorMs).toBe(0);
  });

  it('carries a partial-tick remainder in the accumulator instead of dropping it', () => {
    let clock = createSimClock();
    ({ clock } = advanceClock(clock, 250)); // 2 ticks, 50ms left over
    expect(clock.tickCount).toBe(2);
    expect(clock.accumulatorMs).toBe(50);

    ({ clock } = advanceClock(clock, 60)); // +60ms = 110ms -> 1 more tick, 10ms left
    expect(clock.tickCount).toBe(3);
    expect(clock.accumulatorMs).toBe(10);
  });

  it('produces the same total tick count regardless of how the same total delta is chunked', () => {
    const totalMs = 1000;

    let coarseClock = createSimClock();
    ({ clock: coarseClock } = advanceClock(coarseClock, totalMs));

    let fineClock = createSimClock();
    for (let i = 0; i < 100; i++) {
      ({ clock: fineClock } = advanceClock(fineClock, totalMs / 100));
    }

    expect(fineClock.tickCount).toBe(coarseClock.tickCount);
  });

  it('clamps an extreme single delta (e.g. backgrounded tab) instead of running a huge tick burst', () => {
    const clock = createSimClock();
    const { ticksToRun } = advanceClock(clock, 5 * 60 * 1000); // 5 minutes in one delta
    // Should be clamped well below "5 minutes worth of ticks" (3000 ticks).
    expect(ticksToRun).toBeLessThan(3000);
  });
});
