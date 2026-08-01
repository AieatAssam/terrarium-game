// The Mood Bell — GameRules §9.5 (names it explicitly among Routing
// helpers), §7.3 (names "mood" as a future trait), §9.6 stage 4
// ("multi-attribute routes"). Unlike the Colour Gate, the Bell is a
// single-leg, single-rule automation: one mood toggle, delivering a
// matching Sprout of ANY type straight to ITS OWN correct habitat.
//
// The single most important property tested here is the TRAFFIC PARTITION:
// once the Bell is built, a Sprout matching its rule must be excluded from
// the Garden Slide's and Colour Gate's own Nursery-pickup eligibility — an
// advisor review of this feature's design caught that a naive
// implementation would let the Gate/Slide dominate the Bell (they're
// checked first in automationSystem's dispatch loop), making the Bell
// visibly do nothing for its cost. See "the traffic partition" describe
// block below — do not weaken those assertions to make them pass.

import { describe, expect, it } from 'vitest';

import { createInitialSimState, type SimState } from '../../src/sim/state';
import { automationSystem, moodBellDestination, placeAutomation, purchaseUpgrade, setMoodBellRule } from '../../src/sim/systems';
import { runTick } from '../../src/sim/tick';
import {
  COLOUR_GATE_TILE,
  GARDEN_SLIDE_TILE,
  HABITAT_TILES,
  MOOD_BELL_TILE,
  NURSERY_TILE,
  sameTile,
  tileDistance,
} from '../../src/sim/layout';
import type { GameEvent } from '../../src/events/types';
import type { MoodId, SproutTypeId } from '../../src/core/ids';

/** A state with a built Mood Bell (rule='sunny' unless overridden) and nothing else automating. */
function withBell(rule: MoodId = 'sunny', overrides: Partial<SimState> = {}): SimState {
  const base = createInitialSimState(1);
  return {
    ...base,
    automations: [
      {
        id: 'moodBell-1',
        automationId: 'moodBell',
        siteTile: MOOD_BELL_TILE,
        fromTile: NURSERY_TILE,
        toTile: MOOD_BELL_TILE,
        builtAtTick: 0,
        carryingSproutId: null,
        completesAtTick: null,
      },
    ],
    unlockedAutomations: ['moodBell'],
    moodBellRule: rule,
    ...overrides,
  };
}

/** A state with Garden Slide (targeting sunflowerMeadow), Colour Gate (default lanes), and Mood Bell all built. */
function withAllThree(rule: MoodId = 'sunny'): SimState {
  const base = withBell(rule);
  return {
    ...base,
    automations: [
      ...base.automations,
      {
        id: 'gardenSlide-1',
        automationId: 'gardenSlide',
        siteTile: GARDEN_SLIDE_TILE,
        fromTile: NURSERY_TILE,
        toTile: HABITAT_TILES.sunflowerMeadow,
        builtAtTick: 0,
        targetHabitatId: 'sunflowerMeadow',
        carryingSproutId: null,
        completesAtTick: null,
      },
      {
        id: 'colourGate-1',
        automationId: 'colourGate',
        siteTile: COLOUR_GATE_TILE,
        fromTile: NURSERY_TILE,
        toTile: COLOUR_GATE_TILE,
        builtAtTick: 0,
        carryingSproutId: null,
        completesAtTick: null,
      },
    ],
    unlockedAutomations: ['moodBell', 'gardenSlide', 'colourGate'],
    colourGateLanes: { west: 'ember', east: 'dew' },
  };
}

function withSprout(
  state: SimState,
  sproutType: SproutTypeId,
  mood: MoodId,
  id = 'test-sprout',
  tile = NURSERY_TILE,
): SimState {
  return { ...state, sprouts: [...state.sprouts, { id, sproutType, mood, tile, state: 'idle' as const }] };
}

/** Runs the automation system for `ticks`, collecting every event. */
function drive(state: SimState, ticks: number): { state: SimState; events: GameEvent[] } {
  const events: GameEvent[] = [];
  let working = state;
  for (let i = 0; i < ticks; i += 1) {
    const result = runTick(working, [automationSystem]);
    working = result.state;
    events.push(...result.events);
  }
  return { state: working, events };
}

const sproutById = (state: SimState, id: string) => state.sprouts.find((s) => s.id === id);

describe('garden topology (the Bell has no ride waypoint, only a decorative site)', () => {
  it('gives the Bell its own site tile, distinct from the Nursery, Slide, and Gate', () => {
    expect(sameTile(MOOD_BELL_TILE, NURSERY_TILE)).toBe(false);
    expect(sameTile(MOOD_BELL_TILE, GARDEN_SLIDE_TILE)).toBe(false);
    expect(sameTile(MOOD_BELL_TILE, COLOUR_GATE_TILE)).toBe(false);
  });

  it('sits one tile from the Nursery, same as the Slide does on its own side', () => {
    expect(tileDistance(NURSERY_TILE, MOOD_BELL_TILE)).toBe(1);
  });
});

describe('moodBellDestination (the rule itself)', () => {
  it('resolves each common type to its own correct habitat, regardless of mood', () => {
    expect(moodBellDestination('ember')).toBe('emberNook');
    expect(moodBellDestination('dew')).toBe('dewPond');
    expect(moodBellDestination('sun')).toBe('sunflowerMeadow');
  });

  it('never routes a Star Sprout — it has no single correct habitat', () => {
    expect(moodBellDestination('star')).toBeNull();
  });
});

describe('setMoodBellRule', () => {
  it('changes the rule and announces it', () => {
    const result = setMoodBellRule(withBell('sunny'), 'sleepy');
    expect(result.state.moodBellRule).toBe('sleepy');
    expect(result.events).toEqual([{ type: 'automation:moodBellRuleChanged', mood: 'sleepy' }]);
  });

  it('is silent when nothing would change, so the UI can call it freely', () => {
    expect(setMoodBellRule(withBell('sunny'), 'sunny').events).toEqual([]);
  });
});

describe('a Sprout riding the Bell home (single leg, destination computed per-sprout)', () => {
  it('carries a matching-mood Sprout straight from the Nursery to ITS OWN habitat', () => {
    let state = withSprout(withBell('sunny'), 'ember', 'sunny');
    const result = drive(state, 100);
    const leg = result.events.find((e) => e.type === 'sprout:transportStarted');
    expect(leg).toBeDefined();
    if (leg?.type !== 'sprout:transportStarted') throw new Error('unreachable');
    expect(leg.fromTile).toEqual(NURSERY_TILE);
    expect(leg.toTile).toEqual(HABITAT_TILES.emberNook);
    expect(leg.automationId).toBe('moodBell');

    state = result.state;
    expect(sproutById(state, 'test-sprout')?.state).toBe('settled');
    expect(state.habitats.emberNook?.count).toBe(1);
  });

  it('does the same for a DIFFERENT type in the same run — proves the destination is per-sprout, not fixed at build time', () => {
    let state = withSprout(withBell('sunny'), 'dew', 'sunny');
    let result = drive(state, 100);
    expect(result.events.some((e) => e.type === 'sprout:settled' && e.habitatId === 'dewPond')).toBe(true);

    state = withSprout(withBell('sunny'), 'sun', 'sunny');
    result = drive(state, 100);
    expect(result.events.some((e) => e.type === 'sprout:settled' && e.habitatId === 'sunflowerMeadow')).toBe(true);
  });

  it('leaves a non-matching-mood Sprout idle at the Nursery', () => {
    const state = drive(withSprout(withBell('sunny'), 'ember', 'sleepy'), 200).state;
    const sprout = sproutById(state, 'test-sprout');
    expect(sprout?.state).toBe('idle');
    expect(sprout?.tile).toEqual(NURSERY_TILE);
  });

  it('never carries a matching-mood Star Sprout — no correct habitat to deliver it to', () => {
    const state = drive(withSprout(withBell('sunny'), 'star', 'sunny'), 200).state;
    expect(sproutById(state, 'test-sprout')?.state).toBe('idle');
  });

  it('waits rather than delivering into a full habitat', () => {
    let state = withSprout(withBell('sunny'), 'ember', 'sunny');
    state = { ...state, habitats: { emberNook: { id: 'emberNook', count: 8, capacity: 8 } } };
    const result = drive(state, 200);
    expect(result.events.some((e) => e.type === 'sprout:transportStarted')).toBe(false);
    expect(sproutById(result.state, 'test-sprout')?.state).toBe('idle');
  });
});

describe('the traffic partition — the Bell must actually get traffic, not lose it to the Slide/Gate', () => {
  it('claims a Sprout the Colour Gate would otherwise also carry', () => {
    // Gate's west lane invites 'ember'; Bell's rule is 'sunny'. A sunny Ember
    // Sprout is eligible for BOTH — must go to the Bell.
    const state = withSprout(withAllThree('sunny'), 'ember', 'sunny');
    const result = drive(state, 100);
    const leg = result.events.find((e) => e.type === 'sprout:transportStarted');
    expect(leg).toBeDefined();
    if (leg?.type !== 'sprout:transportStarted') throw new Error('unreachable');
    expect(leg.automationId).toBe('moodBell');
  });

  it('claims a Sprout the Garden Slide would otherwise also carry', () => {
    // Slide targets sunflowerMeadow (Sun Sprouts); Bell's rule is 'sunny'. A
    // sunny Sun Sprout is eligible for BOTH — must go to the Bell.
    const state = withSprout(withAllThree('sunny'), 'sun', 'sunny');
    const result = drive(state, 100);
    const leg = result.events.find((e) => e.type === 'sprout:transportStarted');
    expect(leg).toBeDefined();
    if (leg?.type !== 'sprout:transportStarted') throw new Error('unreachable');
    expect(leg.automationId).toBe('moodBell');
  });

  it('does NOT over-exclude: a non-matching-mood Sprout still goes to the Gate/Slide exactly as before', () => {
    const emberState = withSprout(withAllThree('sunny'), 'ember', 'sleepy', 'e1');
    const emberResult = drive(emberState, 200);
    const emberLeg = emberResult.events.find((e) => e.type === 'sprout:transportStarted');
    expect(emberLeg).toBeDefined();
    if (emberLeg?.type !== 'sprout:transportStarted') throw new Error('unreachable');
    expect(emberLeg.automationId).toBe('colourGate');

    const sunState = withSprout(withAllThree('sunny'), 'sun', 'sleepy', 's1');
    const sunResult = drive(sunState, 200);
    const sunLeg = sunResult.events.find((e) => e.type === 'sprout:transportStarted');
    expect(sunLeg).toBeDefined();
    if (sunLeg?.type !== 'sprout:transportStarted') throw new Error('unreachable');
    expect(sunLeg.automationId).toBe('gardenSlide');
  });

  it('does not exclude Slide/Gate traffic before the Bell is built (behavior must be unchanged from today)', () => {
    // Same scenario as the first partition test, but with NO Mood Bell
    // instance at all (realistically "not built yet" — an automation only
    // ever exists in `state.automations` once purchaseUpgrade adds it there
    // atomically with `unlockedAutomations`, so this is the state a real
    // player would actually be in before buying it) — the Gate should
    // behave exactly as it always has.
    const base = withAllThree('sunny');
    const state = withSprout(
      {
        ...base,
        automations: base.automations.filter((a) => a.automationId !== 'moodBell'),
        unlockedAutomations: base.unlockedAutomations.filter((id) => id !== 'moodBell'),
      },
      'ember',
      'sunny',
    );
    const result = drive(state, 200);
    const leg = result.events.find((e) => e.type === 'sprout:transportStarted');
    expect(leg).toBeDefined();
    if (leg?.type !== 'sprout:transportStarted') throw new Error('unreachable');
    expect(leg.automationId).toBe('colourGate');
  });

  it('does not strand a Sprout already mid-journey at the Gate signpost when the Bell is later built (leg 2 is never partitioned)', () => {
    // A Sprout that already reached the Gate's signpost before the partition
    // rule applies to it must keep going — only NEW Nursery pickups are
    // excluded.
    let state = withSprout(withAllThree('sunny'), 'ember', 'sunny');
    // Advance one tick: leg 1 boards (Gate wins this particular race because
    // moodBell isn't unlocked yet in this state variant)... instead, directly
    // place the sprout AT the Gate tile to simulate "already mid-journey".
    state = {
      ...state,
      sprouts: [{ id: 'test-sprout', sproutType: 'ember', mood: 'sunny', tile: COLOUR_GATE_TILE, state: 'idle' }],
    };
    const result = drive(state, 200);
    expect(result.events.some((e) => e.type === 'sprout:settled' && e.habitatId === 'emberNook')).toBe(true);
  });
});

describe('purchaseUpgrade: moodBellUnlock', () => {
  function withBothPriorAutomations(): SimState {
    return {
      ...createInitialSimState(1),
      dewdrops: 1500,
      unlockedAutomations: ['gardenSlide', 'colourGate'],
      automations: [
        {
          id: 'gardenSlide-1',
          automationId: 'gardenSlide',
          siteTile: GARDEN_SLIDE_TILE,
          fromTile: NURSERY_TILE,
          toTile: HABITAT_TILES.sunflowerMeadow,
          builtAtTick: 0,
          targetHabitatId: 'sunflowerMeadow',
          carryingSproutId: null,
          completesAtTick: null,
        },
        {
          id: 'colourGate-1',
          automationId: 'colourGate',
          siteTile: COLOUR_GATE_TILE,
          fromTile: NURSERY_TILE,
          toTile: COLOUR_GATE_TILE,
          builtAtTick: 0,
          carryingSproutId: null,
          completesAtTick: null,
        },
      ],
    };
  }

  it('does NOT unlock when only one prior automation is actually placed', () => {
    // moodBellBehavioralState is keyed off state.automations (an actual
    // placed instance), not unlockedAutomations — 2026-08-01, see its own
    // doc comment — so the fixture must genuinely lack a placed Gate, not
    // just omit it from unlockedAutomations.
    const both = withBothPriorAutomations();
    const state: SimState = {
      ...both,
      unlockedAutomations: ['gardenSlide'],
      automations: both.automations.filter((a) => a.automationId !== 'colourGate'),
    };
    const result = purchaseUpgrade(state, 'moodBellUnlock');
    expect(result.events).toEqual([]);
    expect(result.state.dewdrops).toBe(state.dewdrops);
    expect(result.state.unlockedAutomations).not.toContain('moodBell');
  });

  it('unlocks once both prior automations are placed and it is affordable; placeAutomation then builds it on the spur with the safe default rule', () => {
    // 2026-08-01: purchaseUpgrade only unlocks now (plan.yaml Phase 1.2) —
    // placeAutomation is what actually builds it and sets the default rule.
    const unlocked = purchaseUpgrade(withBothPriorAutomations(), 'moodBellUnlock');
    expect(unlocked.events).toContainEqual({ type: 'automation:unlocked', automationId: 'moodBell' });
    expect(unlocked.state.dewdrops).toBe(0);

    const result = placeAutomation(unlocked.state, 'moodBell', MOOD_BELL_TILE);
    expect(result.events).toContainEqual({ type: 'automation:moodBellRuleChanged', mood: 'sunny' });
    expect(result.state.moodBellRule).toBe('sunny');
    const bell = result.state.automations.find((a) => a.automationId === 'moodBell');
    expect(bell).toBeDefined();
    expect(bell?.siteTile).toEqual(MOOD_BELL_TILE);
  });
});
