import { beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { CURRENT_SAVE_VERSION, clearSave, loadGame, saveGame } from '../../src/persistence/save';
import { idbSet } from '../../src/persistence/db';
import { createInitialSimState, type SimState } from '../../src/sim/state';
import { defaultColourGateLanes } from '../../src/sim/layout';

function buildSampleState(): SimState {
  const state = createInitialSimState(777);
  return {
    ...state,
    tickCount: 42,
    dewdrops: 13,
    sprouts: [{ id: 'sprout-1', sproutType: 'ember', tile: { x: 2, z: 3 }, state: 'settled' }],
    habitats: { emberNook: { id: 'emberNook', count: 1, capacity: 4 } },
    unlockedAutomations: ['gardenSlide'],
    upgradeLevels: { podRhythm: 2 },
    unlockedAchievements: ['firstPlacement'],
    journalDiscovered: ['ember'],
  };
}

describe('save round-trip through IndexedDB', () => {
  beforeEach(async () => {
    await clearSave();
  });

  it('preserves the full SimState shape through save + load', async () => {
    const original = buildSampleState();
    await saveGame(original, 1_700_000_000_000);

    const loaded = await loadGame();

    expect(loaded).toBeDefined();
    expect(loaded?.version).toBe(CURRENT_SAVE_VERSION);
    expect(loaded?.meta.lastSavedAt).toBe(1_700_000_000_000);
    expect(loaded?.sim).toEqual(original);
  });

  it('returns undefined when nothing has been saved yet', async () => {
    const loaded = await loadGame();
    expect(loaded).toBeUndefined();
  });

  it('defaults meta.lastSavedAt to now when not provided', async () => {
    const before = Date.now();
    const state = createInitialSimState(9);
    await saveGame(state);
    const after = Date.now();

    const loaded = await loadGame();
    expect(loaded?.meta.lastSavedAt).toBeGreaterThanOrEqual(before);
    expect(loaded?.meta.lastSavedAt).toBeLessThanOrEqual(after);
  });
});

describe('migration into v3 (Colour Gate rule + Nursery rhythm)', () => {
  beforeEach(async () => {
    await clearSave();
  });

  /** A v2 envelope: everything a v2 build wrote, and nothing v3 added. */
  function v2Envelope(): unknown {
    const {
      colourGateLanes: _lanes,
      nurseryRhythm: _rhythm,
      nurseryWaitingCount: _count,
      ...v2Sim
    } = { ...buildSampleState(), shapeVersion: 2 };
    return { version: 2, sim: v2Sim, meta: { lastSavedAt: 1_700_000_000_000 } };
  }

  it('gives a returning v2 garden the safe recommended lane rule', async () => {
    await idbSet('default', v2Envelope());
    const loaded = await loadGame();
    expect(loaded?.version).toBe(3);
    expect(loaded?.sim.shapeVersion).toBe(3);
    expect(loaded?.sim.colourGateLanes).toEqual(defaultColourGateLanes());
  });

  it('keeps every pre-existing field of a v2 garden untouched', async () => {
    // The migration must add, never rewrite: a returning player's Dewdrops,
    // Sprouts, homes and progress are exactly as they left them.
    const original = buildSampleState();
    await idbSet('default', v2Envelope());
    const loaded = await loadGame();
    expect(loaded?.sim.dewdrops).toBe(original.dewdrops);
    expect(loaded?.sim.sprouts).toEqual(original.sprouts);
    expect(loaded?.sim.habitats).toEqual(original.habitats);
    expect(loaded?.sim.upgradeLevels).toEqual(original.upgradeLevels);
    expect(loaded?.sim.journalDiscovered).toEqual(original.journalDiscovered);
  });

  it('leaves the last-announced waiting count at zero, so the crowd is re-announced on return', async () => {
    // `nurseryWaitingCount` is the figure the player was last TOLD, not the real
    // one. Starting it at zero guarantees the first tick after a load announces
    // the true crowd size rather than assuming the player already knows it.
    await idbSet('default', v2Envelope());
    const loaded = await loadGame();
    expect(loaded?.sim.nurseryWaitingCount).toBe(0);
    expect(loaded?.sim.nurseryRhythm).toBe('lively');
  });

  it('backfills a save that is LABELLED current but is missing a current field', async () => {
    // The dishonest case normaliseEnvelope exists for, and a real one: a
    // half-migrated envelope stamped v3 with v3's own fields absent. No
    // migration case will ever look at it again, so without the backfill the
    // Colour Gate comes back with an empty rule and routes nobody (found in
    // browser QA). Asserted by loading, not by reasoning about the branches.
    const { colourGateLanes: _lanes, ...brokenSim } = buildSampleState();
    await idbSet('default', { version: 3, sim: brokenSim, meta: { lastSavedAt: 1 } });

    const loaded = await loadGame();
    expect(loaded?.sim.colourGateLanes).toEqual(defaultColourGateLanes());
    // ...and it really is only additive — nothing else was disturbed.
    expect(loaded?.sim.dewdrops).toBe(buildSampleState().dewdrops);
    expect(loaded?.sim.sprouts).toEqual(buildSampleState().sprouts);
  });

  it('never overwrites a field the save genuinely carries', async () => {
    const state: SimState = { ...buildSampleState(), colourGateLanes: { west: 'sun', east: null } };
    await saveGame(state, 1);
    const loaded = await loadGame();
    expect(loaded?.sim.colourGateLanes).toEqual({ west: 'sun', east: null });
  });
});
