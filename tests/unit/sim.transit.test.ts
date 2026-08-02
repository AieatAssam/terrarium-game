import { describe, expect, it } from 'vitest';
import { UNLOCK_THRESHOLDS } from '../../src/data/unlocks';
import { createInitialSimState, getConveyorPorts, getSlidePorts, type SimState } from '../../src/sim/state';
import {
  deriveTransitRouteState,
  deriveTransitRouteStates,
  placeConveyor,
  placeSlide,
  removeConveyor,
  removeSlide,
  transitArtifacts,
  transitPlacementLockReason,
  unlockSystem,
} from '../../src/sim/systems';
import { GARDEN_PATH_TILES, GARDEN_SLIDE_TILE, HABITAT_TILES } from '../../src/sim/layout';

function transitFixture(): SimState {
  const state = createInitialSimState(17);
  const slides = (['ember', 'dew', 'sun'] as const).map((acceptedKind, index) => {
    const slide = {
      id: `slide-${index + 1}`,
      tile: GARDEN_PATH_TILES[index + 1],
      acceptedKind,
      destination: (['emberNook', 'dewPond', 'sunflowerMeadow'] as const)[index],
      enabled: true,
      builtAtTick: index,
    };
    return { ...slide, ...getSlidePorts(slide) };
  });
  const conveyors = GARDEN_PATH_TILES.slice(0, 10).map((tile, index) => {
    const segment = { id: `conveyor-${index + 1}`, tile, builtAtTick: 0 };
    return { ...segment, ...getConveyorPorts(segment) };
  });
  return { ...state, slides, conveyors };
}

describe('Garden Transit domain model', () => {
  it('round-trips multiple Slides and a Conveyor route without renderer state', () => {
    const original = transitFixture();
    const restored = JSON.parse(JSON.stringify(original)) as SimState;

    expect(restored).toEqual(original);
    expect(restored.slides.map((slide) => slide.acceptedKind)).toEqual(['ember', 'dew', 'sun']);
    expect(restored.conveyors).toHaveLength(10);
    expect(transitArtifacts(restored)).toHaveLength(13);
  });

  it('derives route states from state for every artifact, including a 30-segment route', () => {
    const original = transitFixture();
    const thirtySegments = Array.from({ length: 30 }, (_, index) => ({
      id: `long-conveyor-${index}`,
      tile: { x: index, z: 0 },
      builtAtTick: 0,
    }));
    const state = { ...original, conveyors: thirtySegments };
    const routeStates = deriveTransitRouteStates(state);

    expect(Object.keys(routeStates)).toHaveLength(33);
    expect(Object.values(routeStates).every((routeState) => routeState === 'idle' || routeState === 'waiting')).toBe(true);
    expect(deriveTransitRouteState({ ...state, slides: [{ ...state.slides[0], enabled: false }] }, 'slide-1')).toBe('disabled');
    expect(deriveTransitRouteState({ ...state, slides: [{ ...state.slides[0], destination: 'missing' as keyof typeof HABITAT_TILES }] }, 'slide-1')).toBe('invalid');
    expect(deriveTransitRouteState(state, 'missing-artifact')).toBe('invalid');
  });

  it('charges valid Slide placement, unlocks Conveyor placement, and preserves the balance in JSON', () => {
    let state = {
      ...createInitialSimState(17),
      correctPlacementCount: UNLOCK_THRESHOLDS.gardenSlide.requiredCorrectPlacements,
      dewdrops: 165,
    };
    state = unlockSystem(state).state;

    const slideResult = placeSlide(state, { tile: GARDEN_SLIDE_TILE, destination: 'sunflowerMeadow' });
    expect(slideResult.state.dewdrops).toBe(15);
    expect(slideResult.state.slides[0]).toMatchObject({ acceptedKind: 'any', destination: 'sunflowerMeadow', enabled: true });
    expect(slideResult.events).toEqual(
      expect.arrayContaining([
        { type: 'currency:dewdropsChanged', total: 15, delta: -150 },
        expect.objectContaining({ type: 'transit:slideBuilt' }),
      ]),
    );

    const conveyorResult = placeConveyor(slideResult.state, { x: 7, z: 8 });
    expect(conveyorResult.state.dewdrops).toBe(0);
    expect(conveyorResult.state.conveyors).toHaveLength(1);
    expect(JSON.parse(JSON.stringify(conveyorResult.state))).toEqual(conveyorResult.state);
  });

  it('does not spend on an unaffordable or capped placement and explains the gate', () => {
    const fresh = createInitialSimState(17);
    const locked = placeConveyor(fresh, { x: 7, z: 8 });
    expect(locked.state).toBe(fresh);
    expect(transitPlacementLockReason(fresh, 'sproutConveyor')).toBe('Build a Garden Slide first to open a route for Sprouts.');

    const nearlyReady = {
      ...fresh,
      correctPlacementCount: UNLOCK_THRESHOLDS.gardenSlide.requiredCorrectPlacements,
      dewdrops: 149,
    };
    const unlocked = unlockSystem(nearlyReady).state;
    expect(placeSlide(unlocked, { tile: GARDEN_SLIDE_TILE, destination: 'sunflowerMeadow' }).state).toBe(unlocked);
    expect(transitPlacementLockReason(unlocked, 'gardenSlide')).toBe('You need 150 Dewdrops to place this Garden Slide.');

    const capped = {
      ...unlocked,
      dewdrops: 1000,
      slides: Array.from({ length: 4 }, (_, index) => ({
        id: `slide-${index + 1}`,
        tile: GARDEN_PATH_TILES[index + 1],
        acceptedKind: 'any' as const,
        destination: 'sunflowerMeadow' as const,
        enabled: true,
        builtAtTick: 0,
      })),
    };
    expect(placeSlide(capped, { tile: { x: 8, z: 5 }, destination: 'sunflowerMeadow' }).state).toBe(capped);
    expect(transitPlacementLockReason(capped, 'gardenSlide')).toContain('four Garden Slides');

    const withSlide = placeSlide({ ...unlocked, dewdrops: 150 }, { tile: GARDEN_SLIDE_TILE, destination: 'sunflowerMeadow' }).state;
    const poorState = { ...withSlide, dewdrops: 14 };
    const poorConveyor = placeConveyor(poorState, { x: 7, z: 8 });
    expect(poorConveyor.state).toBe(poorState);
    expect(transitPlacementLockReason(poorState, 'sproutConveyor')).toBe(
      'You need 15 Dewdrops to place this Sprout Conveyor segment.',
    );

    const conveyorCap = {
      ...withSlide,
      dewdrops: 1000,
      conveyors: Array.from({ length: 30 }, (_, index) => ({
        id: `conveyor-${index}-0`,
        tile: { x: index % 16, z: Math.floor(index / 16) },
        builtAtTick: 0,
      })),
    };
    expect(placeConveyor(conveyorCap, { x: 5, z: 5 }).state).toBe(conveyorCap);
    expect(transitPlacementLockReason(conveyorCap, 'sproutConveyor')).toContain('thirty Sprout Conveyor segments');
  });

  it('refunds removals at the current owned count and makes buy-sell-buy neutral', () => {
    let state = {
      ...createInitialSimState(17),
      correctPlacementCount: UNLOCK_THRESHOLDS.gardenSlide.requiredCorrectPlacements,
      dewdrops: 1000,
    };
    state = unlockSystem(state).state;
    state = placeSlide(state, { tile: { x: 8, z: 7 }, destination: 'sunflowerMeadow' }).state;
    state = placeSlide(state, { tile: { x: 7, z: 6 }, destination: 'dewPond' }).state;
    expect(state.dewdrops).toBe(580);

    const sold = removeSlide(state, 'slide-2');
    expect(sold.state.dewdrops).toBe(850);
    expect(sold.events).toEqual(expect.arrayContaining([{ type: 'currency:dewdropsChanged', total: 850, delta: 270 }]));
    const rebought = placeSlide(sold.state, { tile: { x: 7, z: 6 }, destination: 'dewPond' });
    expect(rebought.state.dewdrops).toBe(580);

    const conveyor = placeConveyor({ ...rebought.state, dewdrops: 15 }, { x: 7, z: 8 });
    expect(removeConveyor(conveyor.state, conveyor.state.conveyors[0].id).state.dewdrops).toBe(15);
  });
});
