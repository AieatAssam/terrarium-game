import { beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { CURRENT_SAVE_VERSION, clearSave, loadGame, saveGame } from '../../src/persistence/save';
import { createInitialSimState, type SimState } from '../../src/sim/state';

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
