import { describe, expect, it } from 'vitest';
import { createInitialSimState, getConveyorPorts, getSlidePorts, type SimState } from '../../src/sim/state';
import { deriveTransitRouteState, deriveTransitRouteStates, transitArtifacts } from '../../src/sim/systems';
import { GARDEN_PATH_TILES, HABITAT_TILES } from '../../src/sim/layout';

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
});
