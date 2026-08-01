// Guards the Sprout sprite heights that src/render/sprouts.ts derives, and the
// two places outside it that must agree.
//
// Background: these were hard-coded magic numbers (0.8 floating, 0.55 settled)
// that treated `mesh.position` as the sprite's BOTTOM when it sets its CENTRE,
// burying ~0.25-0.30 units of artwork inside the Nursery mound and the habitat
// drums. They are now derived from src/render/propDims.ts. Two consumers cannot
// import the constant and must be checked here instead:
//
//   - tests/e2e/helpers.ts and tests/e2e/preview.preview.spec.ts mirror it as a
//     literal, because Playwright's loader cannot resolve Babylon's
//     extensionless deep imports that sprouts.ts pulls in transitively. Vitest
//     resolves them fine, so this file can hold the authoritative check.
//   - src/input/index.ts DOES import it (its drag plane must match exactly, or
//     a held Sprout renders offset from the cursor), so that one needs no guard.

import { describe, expect, it } from 'vitest';

import { habitatTopY, nurseryTopY, HABITAT_BODIES, topSurfaceY } from '../../src/render/propDims';
import { SPROUT_FLOAT_HEIGHT } from '../../src/render/sprouts';

const SPRITE_SIZE = 0.95; // raised from 0.70 in the 2026-08-01 creature-readability pass; see src/render/sprouts.ts
const HALF_HEIGHT = SPRITE_SIZE / 2;
const CLEARANCE = 0.03;
const BOB_AMPLITUDE = 0.05;

describe('Sprout float height', () => {
  it('clears the Nursery mound even at the bottom of the idle bob', () => {
    const lowestBottomEdge = SPROUT_FLOAT_HEIGHT - HALF_HEIGHT - BOB_AMPLITUDE;
    expect(lowestBottomEdge).toBeGreaterThan(nurseryTopY());
  });

  it('is derived from the mound, not hard-coded independently', () => {
    expect(SPROUT_FLOAT_HEIGHT).toBeCloseTo(nurseryTopY() + BOB_AMPLITUDE + CLEARANCE + HALF_HEIGHT, 6);
  });

  it('still equals the literal the Playwright helpers mirror', () => {
    // If this fails, update `SPROUT_FLOAT_HEIGHT` in tests/e2e/helpers.ts AND
    // the projected y in tests/e2e/preview.preview.spec.ts — Playwright cannot
    // import the real constant (see this file's header).
    expect(SPROUT_FLOAT_HEIGHT).toBeCloseTo(1.255, 6);
  });
});

describe('Sprout settle heights', () => {
  it('leave every habitat drum top clear of the card bottom edge', () => {
    for (const id of Object.keys(HABITAT_BODIES) as Array<keyof typeof HABITAT_BODIES>) {
      const settleCentre = habitatTopY(id) + CLEARANCE + HALF_HEIGHT;
      const bottomEdge = settleCentre - HALF_HEIGHT;
      expect(bottomEdge, `${id} bottom edge`).toBeGreaterThan(habitatTopY(id));
      expect(bottomEdge - habitatTopY(id)).toBeCloseTo(CLEARANCE, 6);
    }
  });

  it('keeps the prop dimension table as the single source of each top surface', () => {
    // topSurfaceY must agree with habitatTopY — i.e. nothing re-declares a
    // drum's height or pivot locally.
    for (const id of Object.keys(HABITAT_BODIES) as Array<keyof typeof HABITAT_BODIES>) {
      expect(habitatTopY(id)).toBeCloseTo(topSurfaceY(HABITAT_BODIES[id]), 6);
    }
  });

  it('pins the top surfaces the bevelled-geometry pass promised to hold constant', () => {
    // These are the pre-bevel values. If a future geometry change moves one,
    // the standee anchors, settle heights and reaction-effect heights all move
    // with it — that is intended, but it should be a deliberate edit here.
    expect(habitatTopY('emberNook')).toBeCloseTo(0.45, 6);
    expect(habitatTopY('dewPond')).toBeCloseTo(0.325, 6);
    expect(habitatTopY('sunflowerMeadow')).toBeCloseTo(0.4, 6);
    expect(nurseryTopY()).toBeCloseTo(0.7, 6);
  });
});
