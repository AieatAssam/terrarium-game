import { describe, expect, it } from 'vitest';
import { UNLOCK_THRESHOLDS } from '../../src/data/unlocks';
import { createInitialSimState, type SimState } from '../../src/sim/state';
import {
  deriveTransitRouteState,
  deriveTransitRouteStates,
  moveConveyor,
  moveSlide,
  placeConveyor,
  placeSlide,
  removeConveyor,
  removeSlide,
  configureSlide,
  slideAutomationSystem,
  transitArtifacts,
  transitPlacementLockReason,
  toggleSlide,
  unlockSystem,
} from '../../src/sim/systems';
import { findConveyorRoute, GARDEN_PATH_TILES, GARDEN_SLIDE_TILE, HABITAT_TILES } from '../../src/sim/layout';

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
    return slide;
  });
  const conveyors = GARDEN_PATH_TILES.slice(0, 10).map((tile, index) => {
    const segment = { id: `conveyor-${index + 1}`, tile, builtAtTick: 0 };
    return segment;
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

  it('runs multiple Slides in stable order, respects filters, completes delivery, and toggles safely', () => {
    let state: SimState = {
      ...createInitialSimState(17),
      correctPlacementCount: UNLOCK_THRESHOLDS.gardenSlide.requiredCorrectPlacements,
      dewdrops: 1000,
      sprouts: [
        { id: 'ember-1', sproutType: 'ember' as const, mood: 'sunny' as const, tile: { x: 8, z: 8 }, state: 'idle' as const },
        { id: 'dew-1', sproutType: 'dew' as const, mood: 'sleepy' as const, tile: { x: 8, z: 8 }, state: 'idle' as const },
      ],
    };
    state = unlockSystem(state).state;
    state = placeSlide(state, { tile: { x: 8, z: 7 }, destination: 'emberNook', acceptedKind: 'ember' }).state;
    state = placeSlide(state, { tile: { x: 8, z: 6 }, destination: 'dewPond', acceptedKind: 'dew' }).state;

    const started = slideAutomationSystem(state);
    expect(started.events.filter((event) => event.type === 'sprout:transportStarted').map((event) => event.instanceId)).toEqual([
      'slide-1',
      'slide-2',
    ]);
    expect(started.state.sprouts.every((sprout) => sprout.state === 'transporting')).toBe(true);
    const finishTick = Math.max(...started.state.slides.map((slide) => slide.completesAtTick ?? 0));
    const finished = slideAutomationSystem({ ...started.state, tickCount: finishTick });
    expect(finished.state.habitats.find((habitat) => habitat.habitatId === 'emberNook')?.count).toBe(1);
    expect(finished.state.habitats.find((habitat) => habitat.habitatId === 'dewPond')?.count).toBe(1);

    const disabled = toggleSlide(state, 'slide-2');
    expect(disabled.state.slides.find((slide) => slide.id === 'slide-2')?.enabled).toBe(false);
    expect(slideAutomationSystem(disabled.state).events.filter((event) => event.type === 'sprout:transportStarted').map((event) => event.instanceId)).toEqual(['slide-1']);
    const configured = configureSlide(disabled.state, 'slide-2', { acceptedKind: 'dew', destination: 'dewPond', enabled: true });
    expect(configured.state.slides.find((slide) => slide.id === 'slide-2')?.enabled).toBe(true);
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

    const conveyorResult = placeConveyor(slideResult.state, { x: 8, z: 6 });
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
    const poorConveyor = placeConveyor(poorState, { x: 8, z: 6 });
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

  it('requires a Conveyor to touch a valid transit or habitat port', () => {
    let state = {
      ...createInitialSimState(17),
      correctPlacementCount: UNLOCK_THRESHOLDS.gardenSlide.requiredCorrectPlacements,
      dewdrops: 500,
    };
    state = unlockSystem(state).state;
    state = placeSlide(state, { tile: GARDEN_SLIDE_TILE, destination: 'sunflowerMeadow' }).state;
    expect(placeConveyor(state, { x: 7, z: 8 }).state).toBe(state);
    const habitatSide = placeConveyor(state, { x: 4, z: 5 });
    expect(habitatSide.state.conveyors[0]?.tile).toEqual({ x: 4, z: 5 });
  });

  it('refunds removals at the current owned count and makes buy-sell-buy neutral', () => {
    let state = {
      ...createInitialSimState(17),
      correctPlacementCount: UNLOCK_THRESHOLDS.gardenSlide.requiredCorrectPlacements,
      dewdrops: 1000,
    };
    state = unlockSystem(state).state;
    state = placeSlide(state, { tile: { x: 8, z: 7 }, destination: 'sunflowerMeadow' }).state;
    state = placeSlide(state, { tile: { x: 8, z: 6 }, destination: 'dewPond' }).state;
    expect(state.dewdrops).toBe(580);

    const sold = removeSlide(state, 'slide-2');
    expect(sold.state.dewdrops).toBe(850);
    expect(sold.events).toEqual(expect.arrayContaining([{ type: 'currency:dewdropsChanged', total: 850, delta: 270 }]));
    const rebought = placeSlide(sold.state, { tile: { x: 8, z: 6 }, destination: 'dewPond' });
    expect(rebought.state.dewdrops).toBe(580);

    const conveyor = placeConveyor({ ...rebought.state, dewdrops: 15 }, { x: 7, z: 6 });
    expect(removeConveyor(conveyor.state, conveyor.state.conveyors[0].id).state.dewdrops).toBe(15);
  });

  it('moves owned artifacts without charging and refuses occupied destinations', () => {
    let state = {
      ...createInitialSimState(17),
      correctPlacementCount: UNLOCK_THRESHOLDS.gardenSlide.requiredCorrectPlacements,
      dewdrops: 1000,
    };
    state = unlockSystem(state).state;
    state = placeSlide(state, { tile: GARDEN_SLIDE_TILE, destination: 'sunflowerMeadow' }).state;
    state = placeSlide(state, { tile: { x: 8, z: 6 }, destination: 'dewPond' }).state;
    const route = placeConveyor({ ...state, dewdrops: 15 }, { x: 7, z: 6 });
    state = route.state;
    const moved = moveSlide(state, 'slide-1', { x: 9, z: 6 });
    expect(moved.state.slides.find((slide) => slide.id === 'slide-1')?.tile).toEqual({ x: 9, z: 6 });
    expect(moved.state.dewdrops).toBe(state.dewdrops);
    expect(moved.events).toEqual([{ type: 'transit:artifactMoved', artifactId: 'slide-1', artifactKind: 'gardenSlide', tile: { x: 9, z: 6 } }]);
    expect(moveSlide(moved.state, 'slide-1', HABITAT_TILES.emberNook).state).toBe(moved.state);

    const conveyor = placeConveyor({ ...moved.state, dewdrops: 15 }, { x: 7, z: 5 });
    const conveyorMove = moveConveyor(conveyor.state, 'conveyor-7-5', { x: 8, z: 5 });
    expect(conveyorMove.state.conveyors.find((segment) => segment.id === 'conveyor-7-5')?.tile).toEqual({ x: 8, z: 5 });
    expect(conveyorMove.state.dewdrops).toBe(0);
  });

  it('moves a Slide away and back to its original port site', () => {
    let state = {
      ...createInitialSimState(17),
      correctPlacementCount: UNLOCK_THRESHOLDS.gardenSlide.requiredCorrectPlacements,
      dewdrops: 500,
    };
    state = unlockSystem(state).state;
    state = placeSlide(state, { tile: GARDEN_SLIDE_TILE, destination: 'sunflowerMeadow' }).state;

    const moved = moveSlide(state, 'slide-1', { x: 8, z: 12 });
    expect(moved.state.slides[0]?.tile).toEqual({ x: 8, z: 12 });

    const returned = moveSlide(moved.state, 'slide-1', GARDEN_SLIDE_TILE);
    expect(returned.state.slides[0]?.tile).toEqual(GARDEN_SLIDE_TILE);
  });

  it('composes a deterministic three-segment route and leaves a loose segment inert', () => {
    const segments = [
      { id: 'conveyor-8-6', tile: { x: 8, z: 6 }, builtAtTick: 0 },
      { id: 'conveyor-7-6', tile: { x: 7, z: 6 }, builtAtTick: 0 },
      { id: 'conveyor-6-6', tile: { x: 6, z: 6 }, builtAtTick: 0 },
    ];
    const route = findConveyorRoute({ x: 8, z: 7 }, { x: 6, z: 7 }, segments);
    expect(route).toEqual({
      tiles: [{ x: 8, z: 7 }, { x: 8, z: 6 }, { x: 7, z: 6 }, { x: 6, z: 6 }, { x: 6, z: 7 }],
      segmentIds: segments.map((segment) => segment.id),
      length: 4,
    });
    expect(findConveyorRoute({ x: 8, z: 7 }, { x: 6, z: 7 }, JSON.parse(JSON.stringify(segments)))).toEqual(route);
    expect(findConveyorRoute({ x: 8, z: 7 }, HABITAT_TILES.emberNook, [...segments, { id: 'loose', tile: { x: 12, z: 12 } }])).toBeNull();

    const slide = {
      id: 'slide-1',
      tile: { x: 8, z: 7 },
      acceptedKind: 'ember' as const,
      destination: 'emberNook' as const,
      enabled: true,
      builtAtTick: 0,
    };
    const state = {
      ...createInitialSimState(17),
      slides: [slide],
      conveyors: [...segments, { id: 'loose', tile: { x: 12, z: 12 }, builtAtTick: 0 }],
      habitats: [
        ...createInitialSimState(17).habitats,
        { id: 'emberNook-2', habitatId: 'emberNook' as const, tile: { x: 6, z: 7 }, count: 0, builtAtTick: 0 },
      ],
      sprouts: [{ id: 'ember-1', sproutType: 'ember' as const, mood: 'sunny' as const, tile: { x: 8, z: 8 }, state: 'idle' as const }],
    };
    const started = slideAutomationSystem(state);
    expect(started.events).toEqual([
      expect.objectContaining({ type: 'sprout:transportStarted', toTile: { x: 6, z: 7 }, durationMs: 1700 }),
    ]);
    expect(deriveTransitRouteStates(state)).toMatchObject({
      'slide-1': 'idle',
      'conveyor-8-6': 'idle',
      'conveyor-7-6': 'idle',
      'conveyor-6-6': 'idle',
      loose: 'waiting',
    });
  });
});
