// Deterministic PRNG (mulberry32). Pure: takes the current seed/state and
// returns the next value plus the next seed. Callers persist `nextSeed` as
// part of SimState (see state.ts) so two runs from the same seed with the
// same input sequence are bit-for-bit reproducible — nothing in sim reads
// Math.random() or Date.now() directly.
export interface RandomResult {
  value: number; // in [0, 1)
  nextSeed: number;
}

export function nextRandom(seed: number): RandomResult {
  const a = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { value, nextSeed: a };
}
