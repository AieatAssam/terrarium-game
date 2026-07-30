// Pins the garden path's piece-type + orientation derivation
// (src/render/layout.ts). The first render pass drew every path tile with the
// single `path.segment.straight` key at zero rotation, so corners, the Nursery
// junction and the dead ends all rendered as straight runs pointing the same
// way. The fix derives each tile's piece from its neighbours, and the art→world
// orientation depends on a texture-V convention that is easy to get backwards
// (it WAS gotten backwards once and only showed up as a mirrored corner in the
// browser) — so both the classifier's logic and the concrete expected result
// for the shipped layout are asserted here.

import { describe, expect, it } from 'vitest';

import {
  classifyPathTile,
  GARDEN_PATH_PIECES,
  GARDEN_PATH_TILES,
  pathDistancesFromNursery,
} from '../../src/render/layout';
import { COLOUR_GATE_TILE, GARDEN_SLIDE_TILE, HABITAT_TILES, NURSERY_TILE } from '../../src/sim/layout';

/** Art-space direction bits, mirroring PATH_DIRECTIONS in layout.ts. */
const UP = 1 << 0;
const LEFT = 1 << 1;
const DOWN = 1 << 2;
const RIGHT = 1 << 3;

describe('classifyPathTile', () => {
  it('recognises each piece at its unrotated art orientation', () => {
    expect(classifyPathTile(LEFT | RIGHT)).toEqual({ piece: 'straight', quarterTurns: 0 });
    expect(classifyPathTile(UP | RIGHT)).toEqual({ piece: 'corner', quarterTurns: 0 });
    expect(classifyPathTile(LEFT | DOWN | RIGHT)).toEqual({ piece: 'tee', quarterTurns: 0 });
    expect(classifyPathTile(UP | LEFT | DOWN | RIGHT)).toEqual({ piece: 'cross', quarterTurns: 0 });
    expect(classifyPathTile(RIGHT)).toEqual({ piece: 'end', quarterTurns: 0 });
  });

  it('picks the rotation whose art mask lands on the requested connections', () => {
    // Every single-connection mask must resolve to an end cap, and rotating
    // that cap's own mask by the reported turns must reproduce the request.
    for (const bit of [UP, LEFT, DOWN, RIGHT]) {
      const { piece, quarterTurns } = classifyPathTile(bit);
      expect(piece).toBe('end');
      expect(1 << ((3 + quarterTurns) % 4)).toBe(bit);
    }
  });

  it('never describes a junction with a less specific piece', () => {
    // A tee's mask is not any rotation of a straight or corner, so the
    // most-connected-first match order must return the tee.
    expect(classifyPathTile(UP | LEFT | RIGHT).piece).toBe('tee');
    expect(classifyPathTile(UP | DOWN).piece).toBe('straight');
    expect(classifyPathTile(UP | LEFT).piece).toBe('corner');
  });

  it('falls back to a capped stub rather than nothing for an isolated tile', () => {
    expect(classifyPathTile(0)).toEqual({ piece: 'end', quarterTurns: 0 });
  });
});

describe('GARDEN_PATH_PIECES', () => {
  it('covers every path tile exactly once', () => {
    expect(GARDEN_PATH_PIECES).toHaveLength(GARDEN_PATH_TILES.length);
    const keys = new Set(GARDEN_PATH_PIECES.map((p) => `${p.tile.x},${p.tile.z}`));
    expect(keys.size).toBe(GARDEN_PATH_TILES.length);
  });

  it('produces real piece variety, not an all-straight network', () => {
    const counts = new Map<string, number>();
    for (const { piece } of GARDEN_PATH_PIECES) counts.set(piece, (counts.get(piece) ?? 0) + 1);
    // Layout: a trunk north out of the Nursery (8,8) to the Colour Gate (8,6),
    // which forks west to (4,4) and east to (12,4), plus the untouched southern
    // run to (8,13) — one junction at the Gate, two corners where the lanes
    // turn north, three dead ends at the habitats, straights everywhere else.
    // No cross piece is used by this network (the cross art exists for future
    // layouts).
    expect(counts.get('tee')).toBe(1);
    expect(counts.get('corner')).toBe(2);
    expect(counts.get('end')).toBe(3);
    expect(counts.get('straight')).toBe(GARDEN_PATH_TILES.length - 6);
    expect(counts.get('cross')).toBeUndefined();
  });

  it('puts the one junction on the Colour Gate tile — the fork the Gate exists to govern', () => {
    // This is the whole point of the topology redesign. The previous layout
    // unioned three Nursery-rooted runs, whose only shared tile was the Nursery
    // itself, so the network fanned out immediately and contained no fork
    // anywhere a Colour Gate could make a decision (GameRules §9.4). The
    // junction now sits exactly where the Gate stands.
    const at = (x: number, z: number) => GARDEN_PATH_PIECES.find((p) => p.tile.x === x && p.tile.z === z);
    const gate = at(COLOUR_GATE_TILE.x, COLOUR_GATE_TILE.z);
    expect(gate?.piece).toBe('tee');
    // ...and it is a real three-way: trunk in from the south, one lane out west,
    // one out east.
    const arms = new Set(gate?.flowSegments.map((s) => s.halfDirection));
    expect(arms).toEqual(new Set([1 /* west lane */, 3 /* east lane */, 2 /* trunk, inbound */]));
  });

  it('runs the trunk through the Garden Slide and the Nursery, and dead-ends at each habitat', () => {
    const at = (x: number, z: number) => GARDEN_PATH_PIECES.find((p) => p.tile.x === x && p.tile.z === z);
    // Both automations stand ON the path now — GameRules §9.2 requires Phase 1
    // paths to connect Nursery, Slide, Gate and Habitat, and both site tiles
    // used to sit in open grass.
    expect(at(GARDEN_SLIDE_TILE.x, GARDEN_SLIDE_TILE.z)).toBeDefined();
    expect(at(COLOUR_GATE_TILE.x, COLOUR_GATE_TILE.z)).toBeDefined();
    // The Nursery is a plain straight now: the trunk leaves north, the Meadow
    // run leaves south, and nothing else touches it.
    expect(at(NURSERY_TILE.x, NURSERY_TILE.z)?.piece).toBe('straight');
    for (const tile of Object.values(HABITAT_TILES)) {
      expect(at(tile.x, tile.z)?.piece).toBe('end');
    }
  });

  it('orients the two corners so their arms point at their actual neighbours', () => {
    const at = (x: number, z: number) => GARDEN_PATH_PIECES.find((p) => p.tile.x === x && p.tile.z === z);
    // (4,6) joins the west lane (neighbour +X) to the x=4 run up to Ember Nook
    // (neighbour -Z). The corner art opens up+right, art-up is world -Z and
    // art-right is world +X, so this one needs no rotation at all.
    // (12,6) joins the east lane (neighbour -X) to the x=12 run up to Dew Pond
    // (-Z): one turn. The art→world mapping these depend on was checked against
    // a browser render — a mirrored mapping reports 1 and 2 here and draws both
    // corners with an arm pointing away from the road.
    expect(at(4, 6)).toMatchObject({ piece: 'corner', quarterTurns: 0 });
    expect(at(12, 6)).toMatchObject({ piece: 'corner', quarterTurns: 1 });
  });

  it('keeps every reported rotation consistent with the tile it sits on', () => {
    // Independent re-derivation: rotate each chosen piece's art mask by its
    // reported quarter turns and confirm it equals the tile's real neighbour
    // mask. Guards against a piece/rotation pair drifting out of agreement.
    const directions = [
      { x: 0, z: -1 },
      { x: -1, z: 0 },
      { x: 0, z: 1 },
      { x: 1, z: 0 },
    ];
    const artMasks: Record<string, number> = {
      straight: LEFT | RIGHT,
      corner: UP | RIGHT,
      tee: LEFT | DOWN | RIGHT,
      cross: UP | LEFT | DOWN | RIGHT,
      end: RIGHT,
    };
    const pathKeys = new Set(GARDEN_PATH_TILES.map((t) => `${t.x},${t.z}`));
    for (const { tile, piece, quarterTurns } of GARDEN_PATH_PIECES) {
      let worldMask = 0;
      for (let d = 0; d < 4; d++) {
        if (pathKeys.has(`${tile.x + directions[d].x},${tile.z + directions[d].z}`)) worldMask |= 1 << d;
      }
      let rotated = 0;
      for (let d = 0; d < 4; d++) {
        if (artMasks[piece] & (1 << d)) rotated |= 1 << ((d + quarterTurns) % 4);
      }
      expect(rotated, `tile ${tile.x},${tile.z} (${piece})`).toBe(worldMask);
    }
  });
});

describe('conveyor flow direction', () => {
  const DIRECTIONS = [
    { x: 0, z: -1 }, // 0
    { x: -1, z: 0 }, // 1
    { x: 0, z: 1 }, // 2
    { x: 1, z: 0 }, // 3
  ];

  it('always points away from the Nursery, never back toward it', () => {
    // The requirement is that flow follows real gameplay transport: Sprouts
    // ride outward from the Nursery to a habitat. So on every tile the flow
    // neighbour must be strictly further from the Nursery than the tile
    // itself — with the single exception of a dead end, which has no such
    // neighbour and instead keeps heading outward into the habitat.
    const distance = pathDistancesFromNursery();
    const key = (x: number, z: number) => `${x},${z}`;
    const habitatKeys = new Set(Object.values(HABITAT_TILES).map((t) => key(t.x, t.z)));
    for (const { tile, flowDirection } of GARDEN_PATH_PIECES) {
      if (key(tile.x, tile.z) === key(NURSERY_TILE.x, NURSERY_TILE.z)) continue; // fan-out junction
      const here = distance.get(key(tile.x, tile.z));
      expect(here, `tile ${tile.x},${tile.z} unreachable`).toBeDefined();
      const step = DIRECTIONS[flowDirection];
      const there = distance.get(key(tile.x + step.x, tile.z + step.z));
      if (habitatKeys.has(key(tile.x, tile.z))) {
        // Dead end: the flow target is off the path network entirely, i.e. it
        // continues outward rather than doubling back onto a nearer tile.
        expect(there, `dead end ${tile.x},${tile.z} turned back`).toBeUndefined();
      } else {
        expect(there, `tile ${tile.x},${tile.z}`).toBe((here as number) + 1);
      }
    }
  });

  it('is not one global direction — every run flows along its own axis', () => {
    const used = new Set(GARDEN_PATH_PIECES.map((p) => p.flowDirection));
    // Three runs leave the Nursery on three different bearings, so at least
    // three of the four directions must appear. A single value here would mean
    // the conveyor was scrolling everything one uniform way.
    expect(used.size).toBeGreaterThanOrEqual(3);
  });

  it('rotates the leaving segment so its local +X lands on the flow direction', () => {
    // A +90° turn about world +Y sends local +X → -Z → -X → +Z, and
    // DIRECTIONS is ordered [-Z, -X, +Z, +X]; so applying travelQuarterTurns to
    // +X (index 3) must land on the direction that segment travels in.
    for (const { tile, flowDirection, flowSegments } of GARDEN_PATH_PIECES) {
      const leaving = flowSegments.find((s) => s.halfDirection === flowDirection);
      expect(leaving, `tile ${tile.x},${tile.z} has no leaving segment`).toBeDefined();
      expect((3 + (leaving as { travelQuarterTurns: number }).travelQuarterTurns) % 4).toBe(flowDirection);
    }
  });

  it('covers the arriving half too, travelling toward the tile centre', () => {
    // Without this segment a straight run would only be chevroned on half of
    // each tile. The arriving half travels from its edge INTO the centre, i.e.
    // opposite to the direction the inbound neighbour lies in.
    const distance = pathDistancesFromNursery();
    const key = (x: number, z: number) => `${x},${z}`;
    for (const { tile, flowSegments } of GARDEN_PATH_PIECES) {
      const here = distance.get(key(tile.x, tile.z)) as number;
      if (here === 0) continue; // Nursery tile: nothing flows in
      const inbound = flowSegments.find((s) => (3 + s.travelQuarterTurns) % 4 === (s.halfDirection + 2) % 4);
      expect(inbound, `tile ${tile.x},${tile.z} has no arriving segment`).toBeDefined();
      const step = DIRECTIONS[(inbound as { halfDirection: number }).halfDirection];
      expect(distance.get(key(tile.x + step.x, tile.z + step.z))).toBe(here - 1);
    }
  });

  it('never paints a conveyor segment over a half-tile with no tread', () => {
    // Each segment covers centre → one edge, and that edge must be one the
    // tile's tread actually reaches — i.e. a real path connection. A corner has
    // no tread in the quadrant opposite its bend, which is exactly where a
    // single full-tile quad used to spill chevrons onto bare soil.
    const pathKeys = new Set(GARDEN_PATH_TILES.map((t) => `${t.x},${t.z}`));
    for (const { tile, flowSegments, piece } of GARDEN_PATH_PIECES) {
      for (const segment of flowSegments) {
        const step = DIRECTIONS[segment.halfDirection];
        const neighbourIsPath = pathKeys.has(`${tile.x + step.x},${tile.z + step.z}`);
        // An end cap is the one legitimate exception: its outward half is the
        // rounded cap, which IS tread even though no path tile lies beyond it.
        if (!neighbourIsPath) expect(piece, `tile ${tile.x},${tile.z}`).toBe('end');
      }
    }
  });

  it('measures Nursery distance along the path, not as the crow flies', () => {
    const distance = pathDistancesFromNursery();
    expect(distance.get(`${NURSERY_TILE.x},${NURSERY_TILE.z}`)).toBe(0);
    // Every path tile must be reachable, or a tile would have no flow.
    for (const tile of GARDEN_PATH_TILES) {
      expect(distance.get(`${tile.x},${tile.z}`), `tile ${tile.x},${tile.z}`).toBeDefined();
    }
  });
});
