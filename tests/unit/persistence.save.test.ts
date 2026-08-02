import { beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { CURRENT_SAVE_VERSION, clearSave, loadGame, saveGame } from '../../src/persistence/save';
import { idbSet } from '../../src/persistence/db';
import { createInitialSimState, type SimState } from '../../src/sim/state';
import { GARDEN_PATH_TILES, GARDEN_SLIDE_TILE, HABITAT_TILES, NURSERY_TILE, defaultColourGateLanes } from '../../src/sim/layout';

/** The current (v7, instance-model) habitat array: all three originals, Ember Nook holding one Sprout. */
function instanceHabitats(): SimState['habitats'] {
  return (Object.keys(HABITAT_TILES) as (keyof typeof HABITAT_TILES)[]).map((habitatId) => ({
    id: `${habitatId}-1`,
    habitatId,
    tile: HABITAT_TILES[habitatId],
    count: habitatId === 'emberNook' ? 1 : 0,
    builtAtTick: 0,
  }));
}

/** The pre-v6 habitat shape (kind-keyed record) a v2/v3/v4/v5 save actually carried. */
function legacyHabitats(habitats: SimState['habitats']): Record<string, { id: string; count: number; capacity: number }> {
  const out: Record<string, { id: string; count: number; capacity: number }> = {};
  for (const h of habitats) out[h.habitatId] = { id: h.habitatId, count: h.count, capacity: 8 };
  return out;
}

function buildSampleState(): SimState {
  const state = createInitialSimState(777);
  return {
    ...state,
    tickCount: 42,
    dewdrops: 13,
    sprouts: [{ id: 'sprout-1', sproutType: 'ember', mood: 'sleepy', tile: { x: 2, z: 3 }, state: 'settled' }],
    habitats: instanceHabitats(),
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

describe('migration into v7 (Garden Transit)', () => {
  beforeEach(async () => {
    await clearSave();
  });

  function v6Envelope(targetHabitatId: unknown = 'sunflowerMeadow'): unknown {
    const sample = buildSampleState();
    const { slides: _slides, conveyors: _conveyors, ...v6Base } = sample;
    return {
      version: 6,
      sim: {
        ...v6Base,
        shapeVersion: 6,
        automations: [
          {
            id: 'gardenSlide-1',
            automationId: 'gardenSlide' as const,
            siteTile: GARDEN_SLIDE_TILE,
            fromTile: NURSERY_TILE,
            toTile: HABITAT_TILES.sunflowerMeadow,
            builtAtTick: 42,
            targetHabitatId,
            carryingSproutId: null,
            completesAtTick: null,
          },
          {
            id: 'colourGate-1',
            automationId: 'colourGate' as const,
            siteTile: { x: 8, z: 6 },
            fromTile: NURSERY_TILE,
            toTile: { x: 8, z: 6 },
            builtAtTick: 20,
            carryingSproutId: null,
            completesAtTick: null,
          },
        ],
      },
      meta: { lastSavedAt: 1_700_000_000_000 },
    };
  }

  it('converts legacy Slide, backfills old path network, preserves garden', async () => {
    await idbSet('default', v6Envelope());
    const loaded = await loadGame();

    expect(loaded?.version).toBe(CURRENT_SAVE_VERSION);
    expect(loaded?.sim.shapeVersion).toBe(7);
    expect(loaded?.sim.slides).toEqual([
      {
        id: 'slide-1',
        tile: GARDEN_SLIDE_TILE,
        acceptedKind: 'any',
        destination: 'sunflowerMeadow',
        enabled: true,
        builtAtTick: 42,
      },
    ]);
    expect(loaded?.sim.automations).toHaveLength(1);
    expect(loaded?.sim.automations[0].automationId).toBe('colourGate');
    expect(loaded?.sim.conveyors).toEqual(
      GARDEN_PATH_TILES.map((tile) => ({ id: `conveyor-${tile.x}-${tile.z}`, tile, builtAtTick: 0 })),
    );
    expect(loaded?.sim.dewdrops).toBe(13);
    expect(loaded?.sim.sprouts).toEqual([
      { id: 'sprout-1', sproutType: 'ember', mood: 'sleepy', tile: { x: 2, z: 3 }, state: 'settled' },
    ]);
  });

  it('reconstructs corrupt legacy destination from Slide site', async () => {
    await idbSet('default', v6Envelope('not-a-habitat'));
    const loaded = await loadGame();
    expect(loaded?.sim.slides[0].destination).toBe('sunflowerMeadow');
  });

  it('loads same legacy envelope deterministically twice', async () => {
    const envelope = v6Envelope('emberNook');
    await idbSet('default', envelope);
    const first = await loadGame();
    await idbSet('default', envelope);
    const second = await loadGame();
    expect(second?.sim).toEqual(first?.sim);
  });
});

describe('migration into v3 (Colour Gate rule + Nursery rhythm)', () => {
  beforeEach(async () => {
    await clearSave();
  });

  /** A v2 envelope: everything a v2 build wrote, and nothing v3 added. */
  function v2Envelope(): unknown {
    const sample = buildSampleState();
    const {
      colourGateLanes: _lanes,
      nurseryRhythm: _rhythm,
      nurseryWaitingCount: _count,
      moodBellRule: _rule,
      ...v2SimWithoutRule
    } = { ...sample, shapeVersion: 2 };
    // A genuine v2 save also predates `mood` (added in v4) and the habitat
    // INSTANCE model (added in v6) and Garden Transit (added in v7) — strip
    // mood/transit from every sprout and convert
    // habitats back to the old kind-keyed record so this fixture is faithful
    // to what a real v2 envelope actually looked like.
    const { slides: _slides, conveyors: _conveyors, ...v2WithoutTransit } = v2SimWithoutRule;
    const v2Sim = {
      ...v2WithoutTransit,
      sprouts: sample.sprouts.map(({ mood: _mood, ...rest }) => rest),
      habitats: legacyHabitats(sample.habitats),
    };
    return { version: 2, sim: v2Sim, meta: { lastSavedAt: 1_700_000_000_000 } };
  }

  it('gives a returning v2 garden the safe recommended lane rule', async () => {
    // A v2 save now migrates all the way to the CURRENT version (7, via the
    // v3 Mood Bell step, v4 manual-placement step and v5 habitat-instance
    // step, all added after this v2->v3 migration was written) — v3 is no
    // longer terminal.
    await idbSet('default', v2Envelope());
    const loaded = await loadGame();
    expect(loaded?.version).toBe(7);
    expect(loaded?.sim.shapeVersion).toBe(7);
    expect(loaded?.sim.colourGateLanes).toEqual(defaultColourGateLanes());
  });

  it('a v2 garden also picks up the v3->v4 Mood Bell backfill along the way', async () => {
    await idbSet('default', v2Envelope());
    const loaded = await loadGame();
    expect(loaded?.sim.moodBellRule).toBe('sunny');
    for (const sprout of loaded?.sim.sprouts ?? []) {
      expect(sprout.mood).toBe('sunny');
    }
  });

  it('keeps every pre-existing field of a v2 garden untouched', async () => {
    // The migration must add, never rewrite: a returning player's Dewdrops,
    // Sprouts, homes and progress are exactly as they left them. `mood` is
    // the one exception — a genuine v2 save never had it (added in v4), so
    // it is legitimately BACKFILLED (to 'sunny'), not preserved; every OTHER
    // sprout field must still match exactly.
    const original = buildSampleState();
    await idbSet('default', v2Envelope());
    const loaded = await loadGame();
    expect(loaded?.sim.dewdrops).toBe(original.dewdrops);
    expect(loaded?.sim.sprouts).toEqual(original.sprouts.map((s) => ({ ...s, mood: 'sunny' })));
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

describe('migration into v4 (Mood Bell: per-sprout mood + moodBellRule)', () => {
  beforeEach(async () => {
    await clearSave();
  });

  /** A v3 envelope: everything a v3 build wrote, and nothing v4 (mood) added. */
  function v3Envelope(): unknown {
    const sample = buildSampleState();
    const { moodBellRule: _rule, ...v3SimWithoutRule } = { ...sample, shapeVersion: 3 };
    const { slides: _slides, conveyors: _conveyors, ...v3WithoutTransit } = v3SimWithoutRule;
    const v3Sim = {
      ...v3WithoutTransit,
      sprouts: sample.sprouts.map(({ mood: _mood, ...rest }) => rest),
      habitats: legacyHabitats(sample.habitats),
    };
    return { version: 3, sim: v3Sim, meta: { lastSavedAt: 1_700_000_000_000 } };
  }

  it('backfills mood on every pre-existing sprout, defaulting to sunny', async () => {
    // A v3 save now migrates all the way to the CURRENT version (7, via the
    // v4 manual-placement step and v5 habitat-instance step, both added after
    // this v3->v4 migration was written) — v4 is no longer terminal.
    await idbSet('default', v3Envelope());
    const loaded = await loadGame();
    expect(loaded?.version).toBe(7);
    expect(loaded?.sim.shapeVersion).toBe(7);
    expect(loaded?.sim.sprouts).toHaveLength(1);
    for (const sprout of loaded?.sim.sprouts ?? []) {
      expect(sprout.mood).toBe('sunny');
    }
  });

  it('backfills moodBellRule, defaulting to sunny', async () => {
    await idbSet('default', v3Envelope());
    const loaded = await loadGame();
    expect(loaded?.sim.moodBellRule).toBe('sunny');
  });

  it('keeps every pre-existing field of a v3 garden untouched', async () => {
    const original = buildSampleState();
    await idbSet('default', v3Envelope());
    const loaded = await loadGame();
    expect(loaded?.sim.dewdrops).toBe(original.dewdrops);
    expect(loaded?.sim.habitats).toEqual(original.habitats);
    expect(loaded?.sim.upgradeLevels).toEqual(original.upgradeLevels);
    expect(loaded?.sim.colourGateLanes).toEqual(original.colourGateLanes);
    // Every OTHER sprout field survives; only `mood` was ever missing.
    expect(loaded?.sim.sprouts?.[0]).toMatchObject({
      id: original.sprouts[0].id,
      sproutType: original.sprouts[0].sproutType,
      tile: original.sprouts[0].tile,
      state: original.sprouts[0].state,
    });
  });

  it('never overwrites a mood the save genuinely carries', async () => {
    const state: SimState = { ...buildSampleState(), moodBellRule: 'sleepy' };
    await saveGame(state, 1);
    const loaded = await loadGame();
    expect(loaded?.sim.moodBellRule).toBe('sleepy');
    expect(loaded?.sim.sprouts[0].mood).toBe('sleepy'); // buildSampleState's own sprout is genuinely 'sleepy'
  });
});

describe('migration into v5 (manual placement: per-automation siteTile)', () => {
  beforeEach(async () => {
    await clearSave();
  });

  /** A v4 envelope: a built Garden Slide and Colour Gate, neither carrying `siteTile` — v4 predates manual placement, every automation was auto-built at a single fixed default tile per automationId. Typed `unknown` deliberately: a real v4-shaped record on disk never had this field, so this must NOT structurally satisfy the current (v5) AutomationInstance type. */
  function v4Envelope(): unknown {
    const sample = buildSampleState();
    const { slides: _slides, conveyors: _conveyors, ...v4Base } = sample;
    const v4Sim = {
      ...v4Base,
      shapeVersion: 4,
      habitats: legacyHabitats(sample.habitats),
      automations: [
        {
          id: 'gardenSlide-1',
          automationId: 'gardenSlide' as const,
          fromTile: { x: 8, z: 8 },
          toTile: { x: 8, z: 13 },
          builtAtTick: 0,
          targetHabitatId: 'sunflowerMeadow' as const,
          carryingSproutId: null,
          completesAtTick: null,
        },
        {
          id: 'colourGate-1',
          automationId: 'colourGate' as const,
          fromTile: { x: 8, z: 8 },
          toTile: { x: 8, z: 6 },
          builtAtTick: 0,
          carryingSproutId: null,
          completesAtTick: null,
        },
      ],
    };
    return { version: 4, sim: v4Sim, meta: { lastSavedAt: 1_700_000_000_000 } };
  }

  it('backfills siteTile from the old fixed default tile for every pre-existing automation', async () => {
    await idbSet('default', v4Envelope());
    const loaded = await loadGame();
    expect(loaded?.version).toBe(7);
    expect(loaded?.sim.shapeVersion).toBe(7);
    const gate = loaded?.sim.automations.find((a) => a.automationId === 'colourGate');
    // These are the true historical values — AUTOMATION_SITE_TILES is where
    // every v4 build always placed them, there is no other tile they could
    // have stood at.
    expect(loaded?.sim.slides[0].tile).toEqual({ x: 8, z: 7 });
    expect(gate?.siteTile).toEqual({ x: 8, z: 6 });
  });

  it('never overwrites a siteTile the save genuinely carries', async () => {
    const state: SimState = {
      ...buildSampleState(),
      automations: [
        {
          id: 'colourGate-1',
          automationId: 'colourGate',
          siteTile: { x: 8, z: 6 },
          fromTile: { x: 8, z: 8 },
          toTile: { x: 8, z: 6 },
          builtAtTick: 0,
          carryingSproutId: null,
          completesAtTick: null,
        },
      ],
    };
    await saveGame(state, 1);
    const loaded = await loadGame();
    expect(loaded?.sim.automations[0].siteTile).toEqual({ x: 8, z: 6 });
  });
});

describe('migration into v6 (buildable habitats: the instance model)', () => {
  beforeEach(async () => {
    await clearSave();
  });

  /** A v5 envelope: automations carry `siteTile` (v5's own addition), but
   * `habitats` is still the OLD kind-keyed record and
   * `habitatDewdropFraction` is kind-keyed too — both v6 converts. */
  function v5Envelope(): unknown {
    const sample = buildSampleState();
    const { slides: _slides, conveyors: _conveyors, ...v5Base } = sample;
    const v5Sim = {
      ...v5Base,
      shapeVersion: 5,
      habitats: legacyHabitats(sample.habitats),
      habitatDewdropFraction: { emberNook: 0.5 },
    };
    return { version: 5, sim: v5Sim, meta: { lastSavedAt: 1_700_000_000_000 } };
  }

  it('rebuilds the instance array from the old kind-keyed record, preserving counts and tiles', async () => {
    await idbSet('default', v5Envelope());
    const loaded = await loadGame();
    expect(loaded?.version).toBe(7);
    expect(loaded?.sim.shapeVersion).toBe(7);
    // Every kind gets an instance (even kinds a v5 save never settled — the
    // old record could legitimately lack them), at the fixed original tile,
    // with the old count preserved.
    expect(loaded?.sim.habitats).toEqual(
      (Object.keys(HABITAT_TILES) as (keyof typeof HABITAT_TILES)[]).map((habitatId) => ({
        id: `${habitatId}-1`,
        habitatId,
        tile: HABITAT_TILES[habitatId],
        count: habitatId === 'emberNook' ? 1 : 0,
        builtAtTick: 0,
      })),
    );
  });

  it('re-keys habitatDewdropFraction from kind to the original instance id', async () => {
    await idbSet('default', v5Envelope());
    const loaded = await loadGame();
    expect(loaded?.sim.habitatDewdropFraction).toEqual({ 'emberNook-1': 0.5 });
  });
});
