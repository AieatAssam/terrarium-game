// Pins the procedural garden generator in src/render/layout.ts.
//
// Two distinct jobs, and they matter for different reasons:
//
//   1. DETERMINISM. The garden must be identical across reloads, machines and
//      backends (docs/ART_DIRECTION.md §12, and the sim's own deterministic
//      fixed-step design). The generator is seeded and positional-hash based
//      rather than stream-PRNG based, but "seeded" is easy to break by
//      accident — one `Math.random`, one `Date.now`, one iteration-order
//      dependency and the guarantee is gone with no visible symptom. The
//      digest assertions below fail loudly if the generated layout changes at
//      all, so re-rolling the garden becomes a deliberate act (update the
//      expected numbers) rather than a silent regression.
//
//   2. GAMEPLAY SAFETY. Decoration must never land on or crowd an interactive
//      element, and the terrain must never lift or sink one. These are checked
//      as invariants over the whole generated set rather than as spot-checks,
//      so they hold no matter how the density fields are later retuned.
//
// Pure module: no Babylon import, no canvas, no DOM — layout.ts deliberately
// contains no rendering types, so this runs as a plain unit test.

import { describe, expect, it } from 'vitest';

import {
  AUTOMATION_SITE_TILES,
  BASE_SCENERY,
  EXPANSION_SCENERY,
  GARDEN_PATH_TILES,
  GARDEN_SEED,
  HABITAT_TILES,
  NURSERY_TILE,
  TERRAIN_AMPLITUDE,
  WATER_BASINS,
  fbm2D,
  groundTintAt,
  isReservedTile,
  rand01,
  reservedClearance,
  terrainHeightAt,
  valueNoise2D,
  type SceneryInstance,
} from '../../src/render/layout';

function tally(instances: readonly SceneryInstance[]): Record<string, number> {
  return instances.reduce<Record<string, number>>((acc, i) => {
    acc[i.kind] = (acc[i.kind] ?? 0) + 1;
    return acc;
  }, {});
}

/**
 * Order-independent digest of a generated layer. Summing (rather than hashing
 * sequentially) is deliberate: it pins the CONTENT of the layout without
 * pinning the order the generator happens to emit it in, which is an
 * implementation detail the renderer does not depend on.
 */
function digest(instances: readonly SceneryInstance[]): number {
  let sum = 0;
  for (const i of instances) {
    sum += Math.round((i.x * 1000 + i.z * 997 + i.y * 131 + i.scale * 61 + i.rotationY * 13 + i.variant) * 100);
  }
  return sum;
}

const ALL_RESERVED_TILES = [
  NURSERY_TILE,
  ...Object.values(HABITAT_TILES),
  ...Object.values(AUTOMATION_SITE_TILES),
  ...GARDEN_PATH_TILES,
];

const ALL_SCENERY = BASE_SCENERY.concat(EXPANSION_SCENERY);

describe('procedural generation — determinism', () => {
  it('derives everything from one fixed seed', () => {
    expect(GARDEN_SEED).toBe(0x7e44a17);
  });

  it('hashes positionally, so a cell decision never depends on draw order', () => {
    const a = rand01(GARDEN_SEED, 3, 7, 2);
    const b = rand01(GARDEN_SEED, 11, 1, 0);
    expect(rand01(GARDEN_SEED, 3, 7, 2)).toBe(a);
    expect(rand01(GARDEN_SEED, 11, 1, 0)).toBe(b);
    expect(a).not.toBe(b);
    // Different channels of the same cell are independent decisions.
    expect(rand01(GARDEN_SEED, 3, 7, 3)).not.toBe(a);
    for (let x = -4; x < 4; x++) {
      for (let z = -4; z < 4; z++) {
        const v = rand01(GARDEN_SEED, x, z, 1);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
      }
    }
  });

  it('produces continuous, bounded noise', () => {
    expect(valueNoise2D(GARDEN_SEED, 2, 2)).toBe(valueNoise2D(GARDEN_SEED, 2, 2));
    const here = valueNoise2D(GARDEN_SEED, 2.5, 3.5);
    expect(Math.abs(valueNoise2D(GARDEN_SEED, 2.51, 3.5) - here)).toBeLessThan(0.05);
  });

  it('generates a stable base layer', () => {
    expect(tally(BASE_SCENERY)).toEqual({
      pebble: 58,
      boulder: 12,
      tuft: 81,
      bush: 29,
      fern: 17,
      mushroom: 5,
      lily: 13,
    });
    expect(BASE_SCENERY).toHaveLength(215);
    expect(digest(BASE_SCENERY)).toBe(337704969);
  });

  it('generates a stable first-expansion layer', () => {
    expect(tally(EXPANSION_SCENERY)).toEqual({ blossom: 20, tuft: 72, kerb: 100, lantern: 6 });
    expect(EXPANSION_SCENERY).toHaveLength(198);
    expect(digest(EXPANSION_SCENERY)).toBe(311716805);
  });

  it('spreads water basins across the garden rather than clustering them', () => {
    expect(WATER_BASINS).toHaveLength(3);
    for (let i = 0; i < WATER_BASINS.length; i++) {
      for (let j = i + 1; j < WATER_BASINS.length; j++) {
        const a = WATER_BASINS[i];
        const b = WATER_BASINS[j];
        expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(a.radius + b.radius + 3);
      }
    }
  });
});

describe('procedural generation — gameplay safety', () => {
  it('never places decoration on a reserved tile', () => {
    for (const instance of ALL_SCENERY) {
      const tile = { x: Math.round(instance.x), z: Math.round(instance.z) };
      expect(
        isReservedTile(tile),
        `${instance.kind} at (${instance.x.toFixed(2)}, ${instance.z.toFixed(2)}) landed on reserved tile ${tile.x},${tile.z}`,
      ).toBe(false);
    }
  });

  it('keeps decoration clear of every interactive prop footprint', () => {
    // Stronger than the tile check above: a habitat drum is 2.6 world units
    // across, so it overhangs its own tile by more than a whole tile in every
    // direction. Lily pads are excluded — they are generated inside basins,
    // which are themselves placed clear of reserved space.
    for (const instance of ALL_SCENERY) {
      if (instance.kind === 'lily') continue;
      expect(
        reservedClearance(instance.x, instance.z),
        `${instance.kind} at (${instance.x.toFixed(2)}, ${instance.z.toFixed(2)})`,
      ).toBeGreaterThan(0);
    }
  });

  it('leaves the terrain exactly flat under every gameplay surface', () => {
    // Props, path tiles and their contact shadows all assume the ground datum
    // they were authored against. The undulation is decoration and is not
    // allowed to move it.
    for (const tile of ALL_RESERVED_TILES) {
      expect(Math.abs(terrainHeightAt(tile.x, tile.z)), `tile ${tile.x},${tile.z}`).toBeLessThan(1e-9);
    }
  });

  it('keeps terrain relief small enough not to occlude gameplay', () => {
    let min = Infinity;
    let max = -Infinity;
    for (let x = -2; x <= 17; x += 0.25) {
      for (let z = -2; z <= 17; z += 0.25) {
        const h = terrainHeightAt(x, z);
        if (h < min) min = h;
        if (h > max) max = h;
      }
    }
    expect(max).toBeLessThanOrEqual(TERRAIN_AMPLITUDE);
    // The only thing allowed below the datum by more than the swell amplitude
    // is a carved basin bowl.
    const deepestBasin = Math.max(...WATER_BASINS.map((b) => b.depth));
    expect(min).toBeGreaterThan(-(TERRAIN_AMPLITUDE + deepestBasin + 1e-6));
  });

  it('sits scattered objects on the ground they were generated over', () => {
    for (const instance of BASE_SCENERY) {
      if (instance.kind === 'lily') continue;
      expect(instance.y).toBeCloseTo(terrainHeightAt(instance.x, instance.z), 10);
    }
  });

  it('floats lily pads on the water, not on the bowl floor', () => {
    const lilies = BASE_SCENERY.filter((i) => i.kind === 'lily');
    expect(lilies.length).toBeGreaterThan(0);
    for (const lily of lilies) {
      const basin = WATER_BASINS.find((b) => Math.hypot(b.x - lily.x, b.z - lily.z) <= b.waterRadius);
      expect(basin, `lily at ${lily.x.toFixed(2)},${lily.z.toFixed(2)} is not inside any basin`).toBeDefined();
      expect(lily.y).toBeGreaterThan(terrainHeightAt(lily.x, lily.z));
    }
  });
});

describe('procedural generation — visual hierarchy', () => {
  it('keeps per-instance tints subtle, so decoration cannot out-shout interactive props', () => {
    // GameRules §4.1: interactive elements must stay instantly distinguishable
    // from decoration. Per-instance tint is a MULTIPLIER over a shared
    // material's albedo; a wide range would let one shrub read as a saturated
    // focal object competing with a Sprout.
    for (const instance of ALL_SCENERY) {
      const channels = [instance.tint.r, instance.tint.g, instance.tint.b];
      for (const channel of channels) {
        expect(channel).toBeGreaterThan(0.7);
        expect(channel).toBeLessThan(1.35);
      }
      // Channel spread is the saturation swing; keep it small.
      expect(Math.max(...channels) - Math.min(...channels)).toBeLessThan(0.35);
    }
  });

  it('keeps the ground tint a gentle modulation rather than a second palette', () => {
    for (let x = -2; x <= 17; x += 0.7) {
      for (let z = -2; z <= 17; z += 0.7) {
        const tint = groundTintAt(x, z);
        for (const channel of [tint.r, tint.g, tint.b]) {
          expect(channel).toBeGreaterThan(0.75);
          expect(channel).toBeLessThan(1.35);
        }
      }
    }
  });

  it('gives foliage sway and stone none', () => {
    const rigidKinds = new Set(['pebble', 'boulder', 'kerb', 'lantern', 'mushroom']);
    for (const instance of ALL_SCENERY) {
      if (rigidKinds.has(instance.kind)) expect(instance.sway, instance.kind).toBe(0);
      else expect(instance.sway, instance.kind).toBeGreaterThan(0);
    }
  });

  it('exposes a usable fbm field for terrain', () => {
    for (let i = 0; i < 40; i++) {
      const v = fbm2D(GARDEN_SEED, i * 0.37, i * 0.91, 3);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});
