import { describe, expect, it } from 'vitest';
import { getEffectiveHabitatCapacity } from '../../src/data/habitats';
import { HABITAT_TILES, NURSERY_TILE } from '../../src/sim/layout';
import { createInitialSimState, type SimState, type SlideInstance } from '../../src/sim/state';
import {
  configureSlide,
  repairTransitRides,
  removeSlide,
  slideAutomationSystem,
} from '../../src/sim/systems';

const slideDefaults: SlideInstance = {
  id: 'slide-1',
  tile: { x: 8, z: 7 },
  acceptedKind: 'ember',
  destination: 'emberNook',
  enabled: true,
  builtAtTick: 0,
  carryingSproutId: null,
  fromTile: NURSERY_TILE,
  toTile: HABITAT_TILES.emberNook,
  completesAtTick: null,
};

function rideState(slide: Partial<SlideInstance> = {}): SimState {
  return {
    ...createInitialSimState(17),
    slides: [{ ...slideDefaults, ...slide }],
    sprouts: [{ id: 'ember-1', sproutType: 'ember', mood: 'sunny', tile: HABITAT_TILES.emberNook, state: 'transporting' }],
  };
}

describe('Garden Transit safety', () => {
  it('returns a passenger when its Slide is removed and explains the recovery', () => {
    const result = removeSlide(rideState({ carryingSproutId: 'ember-1', completesAtTick: 10 }), 'slide-1');
    expect(result.state.slides).toEqual([]);
    expect(result.state.sprouts[0]).toMatchObject({ state: 'idle', tile: NURSERY_TILE });
    expect(result.events).toContainEqual(expect.objectContaining({
      type: 'sprout:transportReturned',
      reason: 'removed',
      tile: NURSERY_TILE,
    }));
  });

  it('returns a passenger when a carrying Slide is disabled', () => {
    const result = configureSlide(rideState({ carryingSproutId: 'ember-1', completesAtTick: 10 }), 'slide-1', {
      acceptedKind: 'ember',
      destination: 'emberNook',
      enabled: false,
    });
    expect(result.state.slides[0]).toMatchObject({ enabled: false, carryingSproutId: null });
    expect(result.state.sprouts[0]).toMatchObject({ state: 'idle', tile: NURSERY_TILE });
    expect(result.events).toContainEqual(expect.objectContaining({ type: 'sprout:transportReturned', reason: 'disabled' }));
  });

  it('does not silently reroute an active ride when its rule changes', () => {
    const result = configureSlide(rideState({ carryingSproutId: 'ember-1', completesAtTick: 10 }), 'slide-1', {
      acceptedKind: 'any',
      destination: 'dewPond',
      enabled: true,
    });
    expect(result.state.slides[0]).toMatchObject({
      acceptedKind: 'any',
      destination: 'dewPond',
      carryingSproutId: 'ember-1',
      toTile: HABITAT_TILES.emberNook,
      completesAtTick: 10,
    });
    const finished = slideAutomationSystem({ ...result.state, tickCount: 10 });
    expect(finished.state.habitats.find((habitat) => habitat.habitatId === 'emberNook')?.count).toBe(1);
    expect(finished.state.habitats.find((habitat) => habitat.habitatId === 'dewPond')?.count).toBe(0);
  });

  it('returns a passenger when the destination fills during the ride', () => {
    const capacity = getEffectiveHabitatCapacity('emberNook', 0);
    const state = rideState({ carryingSproutId: 'ember-1', completesAtTick: 10 });
    const full = {
      ...state,
      tickCount: 10,
      habitats: state.habitats.map((habitat) => habitat.habitatId === 'emberNook' ? { ...habitat, count: capacity } : habitat),
    };
    const result = slideAutomationSystem(full);
    expect(result.state.sprouts[0]).toMatchObject({ state: 'idle', tile: NURSERY_TILE });
    expect(result.state.slides[0].carryingSproutId).toBeNull();
    expect(result.events).toContainEqual(expect.objectContaining({ type: 'sprout:transportReturned', reason: 'destinationFull' }));
  });

  it('returns a passenger from a stale saved target before the first tick', () => {
    const result = repairTransitRides(rideState({ carryingSproutId: 'ember-1', toTile: { x: 0, z: 0 }, completesAtTick: 10 }));
    expect(result.state.sprouts[0]).toMatchObject({ state: 'idle', tile: NURSERY_TILE });
    expect(result.state.slides[0].carryingSproutId).toBeNull();
    expect(result.events).toContainEqual(expect.objectContaining({ type: 'sprout:transportReturned', reason: 'saveRepair' }));
  });

  it('keeps the first competing Slide claim and clears the duplicate deterministically', () => {
    const state = {
      ...rideState({ id: 'slide-1', carryingSproutId: 'ember-1', completesAtTick: 10 }),
      slides: [
        { ...slideDefaults, id: 'slide-1', carryingSproutId: 'ember-1', completesAtTick: 10 },
        { ...slideDefaults, id: 'slide-2', tile: { x: 8, z: 6 }, carryingSproutId: 'ember-1', completesAtTick: 11 },
      ],
    };
    const repaired = repairTransitRides(state);
    expect(repaired.state.slides.map((slide) => slide.carryingSproutId)).toEqual(['ember-1', null]);
    expect(repaired.state.sprouts.filter((sprout) => sprout.id === 'ember-1')).toHaveLength(1);
    expect(JSON.parse(JSON.stringify(repairTransitRides(JSON.parse(JSON.stringify(state)) as SimState)))).toEqual(
      JSON.parse(JSON.stringify(repaired)),
    );
  });

  it('gives one Sprout to the first eligible Slide in stable order', () => {
    const state = {
      ...createInitialSimState(17),
      slides: [
        { ...slideDefaults, id: 'slide-1', acceptedKind: 'any' as const },
        { ...slideDefaults, id: 'slide-2', tile: { x: 8, z: 6 }, acceptedKind: 'any' as const },
      ],
      sprouts: [{ id: 'ember-1', sproutType: 'ember' as const, mood: 'sunny' as const, tile: NURSERY_TILE, state: 'idle' as const }],
    };
    const result = slideAutomationSystem(state);
    expect(result.events.filter((event) => event.type === 'sprout:transportStarted').map((event) => event.instanceId)).toEqual(['slide-1']);
    expect(result.state.slides.map((slide) => slide.carryingSproutId)).toEqual(['ember-1', null]);
  });
});
