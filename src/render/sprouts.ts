// Sprout visuals: one billboarded sprite mesh per live Sprout instance,
// created/updated/animated from GameEvent bus traffic. Texture per
// idle/walk/happy/reveal state is loaded via the exact manifest key pattern
// from docs/CONTRACTS.md (`sprout.<type>.<state>`).
//
// Drag position updates (every pointermove while held) are NOT bus events —
// there's no such member in the GameEvent union, and spamming the bus with a
// per-frame position wouldn't fit its "discrete moments" shape anyway — so
// src/input calls `setDragPosition` directly. Discrete moments (picked up,
// dropped, placed, settled, transported) all come through bus subscriptions
// like every other system.

import { Color3 } from '@babylonjs/core/Maths/math.color';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { PBRMetallicRoughnessMaterial } from '@babylonjs/core/Materials/PBR/pbrMetallicRoughnessMaterial';
import type { Scene } from '@babylonjs/core/scene';

import { createManifestMaterial, swapManifestMaterialTexture } from './assets';
import { GARDEN_CAMERA_ALPHA } from './camera';
import { tileToWorld, type TileCoord } from './coords';
import { GARDEN_PATH_TILES, HABITAT_TILES, NURSERY_TILE } from './layout';
import { easingFn, type MotionConfig } from './motion';
import { createSparkleBurst } from './particles';
import { habitatTopY, nurseryTopY } from './propDims';
import type { EventBus } from '../events/bus';
import type { HabitatId, SproutTypeId } from '../core/ids';
import { SPROUT_TYPES } from '../data/sproutTypes';

export type SproutVisualState = 'reveal' | 'idle' | 'walk' | 'happy' | 'settled';

// ---------------------------------------------------------------------------
// Sprite heights
// ---------------------------------------------------------------------------
// These used to be two hard-coded magic numbers (0.8 floating, 0.55 settled)
// whose comments claimed they cleared the props underneath. They did not: a
// Sprout is a `CreatePlane({ size: SPROUT_SPRITE_SIZE })` billboard and
// `mesh.position` places its CENTRE, so 0.8 put the card's bottom edge at
// 0.8 - 0.35 = 0.45 against a Nursery mound whose top face is 0.70, and 0.55
// put a settled card's bottom edge at 0.20 against an Ember Nook top face of
// 0.45. Both buried roughly a quarter of a unit of artwork inside opaque
// geometry. Measured in-browser before the fix: the floating Nursery Sprout's
// bounding box ran 0.4006 -> 1.1006 while the mound top was 0.70.
//
// (`attachStandee`'s callers never had this bug because they pass
// `surfaceTop + cardHeight / 2` — the same arithmetic now used here.)
//
// So every height below is DERIVED: the surface's own top face (from the
// shared prop-dimension table in src/render/propDims.ts, which is also what
// builds those meshes) plus this sprite's own half-height plus an explicit
// clearance. Change a drum's height or the sprite size and these follow.

/** Edge length of the Sprout billboard plane. */
const SPROUT_SPRITE_SIZE = 0.7;
/** Offset from the sprite's centre (what `position` sets) to its bottom edge. */
const SPROUT_HALF_HEIGHT = SPROUT_SPRITE_SIZE / 2;
/** Air gap left between a surface and the sprite's bottom edge. */
const SPROUT_SURFACE_CLEARANCE = 0.03;
/** Peak amplitude of the idle bob in `update` below. The floating height has
 * to budget for it: without this term the bob's DOWNWARD half would dip the
 * card's bottom edge back under the Nursery's top face. */
const SPROUT_BOB_AMPLITUDE = 0.05;

/**
 * Resting/drag/transport height for a Sprout that is NOT settled — clears the
 * Nursery mound (the tallest thing a Sprout hovers over) by its own
 * half-height plus the bob amplitude plus the clearance. Exported because
 * src/input/index.ts's pointer-to-world drag plane has to sit at exactly this
 * height, and tests/e2e/helpers.ts projects it to find the pickup point.
 */
export const SPROUT_FLOAT_HEIGHT = nurseryTopY() + SPROUT_BOB_AMPLITUDE + SPROUT_SURFACE_CLEARANCE + SPROUT_HALF_HEIGHT;

/** Resting height for a Sprout settled on a given habitat's top face. Settled
 * Sprouts don't bob (see `update`), so no bob budget is needed. */
function sproutSettleHeight(habitatId: HabitatId): number {
  return habitatTopY(habitatId) + SPROUT_SURFACE_CLEARANCE + SPROUT_HALF_HEIGHT;
}

// Where settled Sprouts stand on a habitat's top face.
//
// The original ring (`angle = count * 0.9`, `radius = 0.35 + (count % 4) * 0.1`)
// swept the full circle around the drum centre, which put roughly half of all
// settled Sprouts BEHIND the habitat's own standee card — and that card is a
// camera-facing billboard standing at the drum centre, so it cut the Sprout in
// half. Confirmed in browser QA: a Sprout settled on the Ember Nook rendered as
// a partial sliver poking out from behind the habitat symbol.
//
// Fix: lay the slots out on the VIEWER-FACING side of the card only. That is
// well-defined because the garden camera's yaw is a fixed invariant — no input
// path rotates alpha (see GARDEN_CAMERA_ALPHA in src/render/camera.ts) — so
// "toward the viewer" is one constant world direction for the whole session.
// The same invariant is what makes the lit billboard treatment safe (see
// `spawn` below).
/** Unit XZ vector from a habitat's centre toward the viewer. */
const VIEWER_X = Math.cos(GARDEN_CAMERA_ALPHA);
const VIEWER_Z = Math.sin(GARDEN_CAMERA_ALPHA);
/** Unit XZ vector across the screen (perpendicular to the above). */
const LATERAL_X = -Math.sin(GARDEN_CAMERA_ALPHA);
const LATERAL_Z = Math.cos(GARDEN_CAMERA_ALPHA);
const SETTLE_SLOTS_PER_ROW = 3;
const SETTLE_ROWS = 2;
const SETTLE_SLOT_SPACING = 0.34;
/** How far in front of the card the first row stands. Kept small enough that
 * even the smallest habitat's FLAT top face (Ember Nook: 1.1 outer radius less
 * its 0.1 rim bevel = 1.0) comfortably contains every slot — the furthest is
 * hypot(0.62, 0.34) = 0.71 from the centre. */
const SETTLE_FRONT_DISTANCE = 0.62;
const SETTLE_ROW_SPACING = 0.26;

/** Deterministic XZ offset from a habitat's centre for the Nth settled Sprout —
 * a small crowd standing in front of the habitat's sign, never behind it. */
function sproutSettleOffset(index: number): { x: number; z: number } {
  const row = Math.floor(index / SETTLE_SLOTS_PER_ROW) % SETTLE_ROWS;
  const column = index % SETTLE_SLOTS_PER_ROW;
  const lateral = (column - (SETTLE_SLOTS_PER_ROW - 1) / 2) * SETTLE_SLOT_SPACING;
  const forward = SETTLE_FRONT_DISTANCE - row * SETTLE_ROW_SPACING;
  return {
    x: VIEWER_X * forward + LATERAL_X * lateral,
    z: VIEWER_Z * forward + LATERAL_Z * lateral,
  };
}

// ---------------------------------------------------------------------------
// Garden-path routes for transported Sprouts
// ---------------------------------------------------------------------------
// A carried Sprout used to lerp STRAIGHT from the Nursery tile to the habitat
// tile — a diagonal drift across open grass, with the L-shaped garden path
// sitting unused right beside it. GameRules §9.2 makes the paths the physical
// route and §9.3 requires the Slide to visibly carry Sprouts along it, so the
// ride now follows the real tile route.
//
// The route is found by breadth-first search over GARDEN_PATH_TILES (built in
// src/render/layout.ts by unioning `pathBetween(NURSERY_TILE, habitatTile)`
// for every habitat). BFS rather than re-deriving the Manhattan run: the union
// is the authoritative network, and searching it means this can never disagree
// with the tiles actually painted on the ground. In the shipped layout that
// network is a tree, so the shortest walk is also the only walk.
//
// Corners are then ROUNDED — a quadratic Bézier fillet across each turn —
// because a raw tile polyline makes a carried Sprout stop dead and pivot 90°.
// Sampling by arc length keeps the pace even through the bend, so the ride
// reads as gentle conveyance rather than two straight dashes.
//
// Everything here is computed once per (from, to) pair and cached: the
// per-frame code below only walks a prebuilt Float64Array and allocates
// nothing.

/** World-space polyline for one route, with corner fillets already baked in. */
export interface GardenRoute {
  /** Flattened [x0, z0, x1, z1, ...] world-space points. */
  points: Float64Array;
  /** `cumulative[i]` is the arc length from the start of the route to point i. */
  cumulative: Float64Array;
  /** Number of points (`points.length / 2`). */
  count: number;
  totalLength: number;
}

const ROUTE_NEIGHBOUR_STEPS: ReadonlyArray<TileCoord> = [
  { x: 1, z: 0 },
  { x: -1, z: 0 },
  { x: 0, z: 1 },
  { x: 0, z: -1 },
];

/** How far from a corner the fillet starts, in world units (tiles are 1 unit). */
const ROUTE_CORNER_RADIUS = 0.45;
/** Bézier samples per rounded corner — enough to read as a curve, few enough to stay cheap. */
const ROUTE_CORNER_SAMPLES = 7;

function routeTileKey(tile: TileCoord): string {
  return `${tile.x},${tile.z}`;
}

const PATH_TILE_KEYS: ReadonlySet<string> = new Set(GARDEN_PATH_TILES.map(routeTileKey));

/** Breadth-first walk over the garden path graph; null if either end is off the path. */
function findTileRoute(from: TileCoord, to: TileCoord): TileCoord[] | null {
  const fromKey = routeTileKey(from);
  const toKey = routeTileKey(to);
  if (!PATH_TILE_KEYS.has(fromKey) || !PATH_TILE_KEYS.has(toKey)) return null;
  if (fromKey === toKey) return [from];

  const cameFrom = new Map<string, TileCoord | null>([[fromKey, null]]);
  let frontier: TileCoord[] = [from];
  while (frontier.length > 0) {
    const next: TileCoord[] = [];
    for (const tile of frontier) {
      for (const step of ROUTE_NEIGHBOUR_STEPS) {
        const neighbour: TileCoord = { x: tile.x + step.x, z: tile.z + step.z };
        const key = routeTileKey(neighbour);
        if (!PATH_TILE_KEYS.has(key) || cameFrom.has(key)) continue;
        cameFrom.set(key, tile);
        if (key === toKey) {
          const reversed: TileCoord[] = [];
          let cursor: TileCoord | null = neighbour;
          while (cursor) {
            reversed.push(cursor);
            cursor = cameFrom.get(routeTileKey(cursor)) ?? null;
          }
          return reversed.reverse();
        }
        next.push(neighbour);
      }
    }
    frontier = next;
  }
  return null;
}

/** Turns a tile walk into an arc-length-parameterised polyline with rounded corners. */
function buildGardenRoute(tiles: TileCoord[]): GardenRoute | null {
  const xs: number[] = [];
  const zs: number[] = [];
  const push = (x: number, z: number): void => {
    const n = xs.length;
    // Corner fillets can land on top of the previous point when two turns are
    // adjacent; a zero-length segment would make the arc-length walk divide by
    // ~0, so collapse duplicates here instead of guarding every frame.
    if (n > 0 && Math.abs(xs[n - 1] - x) < 1e-6 && Math.abs(zs[n - 1] - z) < 1e-6) return;
    xs.push(x);
    zs.push(z);
  };

  const centres = tiles.map((tile) => tileToWorld(tile));
  push(centres[0].x, centres[0].z);
  for (let i = 1; i < centres.length - 1; i += 1) {
    const prev = centres[i - 1];
    const cur = centres[i];
    const next = centres[i + 1];
    const inX = cur.x - prev.x;
    const inZ = cur.z - prev.z;
    const outX = next.x - cur.x;
    const outZ = next.z - cur.z;
    // Cross product ~0 means the walk carries straight on through this tile.
    if (Math.abs(inX * outZ - inZ * outX) < 1e-6) {
      push(cur.x, cur.z);
      continue;
    }
    const inLength = Math.hypot(inX, inZ);
    const outLength = Math.hypot(outX, outZ);
    const radius = Math.min(ROUTE_CORNER_RADIUS, inLength / 2, outLength / 2);
    const ax = cur.x - (inX / inLength) * radius;
    const az = cur.z - (inZ / inLength) * radius;
    const bx = cur.x + (outX / outLength) * radius;
    const bz = cur.z + (outZ / outLength) * radius;
    push(ax, az);
    for (let s = 1; s < ROUTE_CORNER_SAMPLES; s += 1) {
      const t = s / ROUTE_CORNER_SAMPLES;
      const u = 1 - t;
      push(u * u * ax + 2 * u * t * cur.x + t * t * bx, u * u * az + 2 * u * t * cur.z + t * t * bz);
    }
    push(bx, bz);
  }
  const last = centres[centres.length - 1];
  push(last.x, last.z);

  const count = xs.length;
  if (count < 2) return null;
  const points = new Float64Array(count * 2);
  const cumulative = new Float64Array(count);
  let total = 0;
  for (let i = 0; i < count; i += 1) {
    points[i * 2] = xs[i];
    points[i * 2 + 1] = zs[i];
    if (i > 0) total += Math.hypot(xs[i] - xs[i - 1], zs[i] - zs[i - 1]);
    cumulative[i] = total;
  }
  if (total <= 1e-6) return null;
  return { points, cumulative, count, totalLength: total };
}

const routeCache = new Map<string, GardenRoute | null>();

/**
 * The garden-path route between two tiles, or null when there isn't one (in
 * which case callers fall back to a straight lerp — a Sprout must always still
 * visibly arrive, even if a future layout puts an endpoint off the path).
 */
export function gardenRouteBetween(from: TileCoord, to: TileCoord): GardenRoute | null {
  const key = `${routeTileKey(from)}>${routeTileKey(to)}`;
  const cached = routeCache.get(key);
  if (cached !== undefined) return cached;
  const tiles = findTileRoute(from, to);
  const route = tiles && tiles.length > 1 ? buildGardenRoute(tiles) : null;
  routeCache.set(key, route);
  return route;
}

/** Fallback ms-per-tile if a `sprout:transportStarted` ever arrives without the
 * sim's own `durationMs` (e.g. a stale bundle mid-HMR). Mirrors
 * BASE_TRANSPORT_MS_PER_TILE in src/sim/systems.ts, but is NEVER the normal
 * path — the sim's figure is authoritative because only it knows the
 * gardenSlideSpeed upgrade level. */
const FALLBACK_TRANSPORT_MS_PER_TILE = 420;

/** Peak height of the carried arc above the normal float height. */
const TRANSPORT_HOP_HEIGHT = 0.18;

export interface SproutVisual {
  id: string;
  sproutType: SproutTypeId;
  mesh: Mesh;
  material: PBRMetallicRoughnessMaterial;
  state: SproutVisualState;
  tile: TileCoord;
  held: boolean;
  settledHabitat: HabitatId | null;
  wanderSeed: number;
}

export interface SproutManager {
  get: (id: string) => SproutVisual | undefined;
  all: () => SproutVisual[];
  meshes: () => Mesh[];
  setDragPosition: (id: string, worldX: number, worldZ: number) => void;
  setDragValidity: (id: string, valid: boolean | null) => void;
  update: (motion: MotionConfig, nowMs: number) => void;
  dispose: () => void;
}

function parseHexColor(hex: string | undefined, fallback: Color3): Color3 {
  if (!hex) return fallback;
  const match = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!match) return fallback;
  return Color3.FromHexString(hex);
}

const TYPE_FALLBACK_COLOR: Record<SproutTypeId, Color3> = {
  ember: new Color3(0.9, 0.4, 0.25),
  dew: new Color3(0.4, 0.65, 0.9),
  sun: new Color3(0.95, 0.8, 0.3),
  star: new Color3(0.75, 0.55, 0.95),
};

export function createSproutManager(scene: Scene, bus: EventBus): SproutManager {
  const visuals = new Map<string, SproutVisual>();

  const textureKey = (type: SproutTypeId, state: 'idle' | 'walk' | 'happy' | 'reveal'): string =>
    `sprout.${type}.${state}`;

  const setState = (visual: SproutVisual, state: SproutVisualState): void => {
    visual.state = state;
    const key = state === 'settled' ? 'happy' : state;
    if (key === 'idle' || key === 'walk' || key === 'happy' || key === 'reveal') {
      swapManifestMaterialTexture(scene, visual.material, textureKey(visual.sproutType, key));
    }
  };

  const spawn = (id: string, sproutType: SproutTypeId, podId: string): void => {
    void podId;
    if (visuals.has(id)) return;
    const nurseryWorld = tileToWorld(NURSERY_TILE);
    const mesh = MeshBuilder.CreatePlane(`terrarium.sprout.${id}`, { size: SPROUT_SPRITE_SIZE }, scene);
    mesh.billboardMode = Mesh.BILLBOARDMODE_Y;
    mesh.position.set(nurseryWorld.x, SPROUT_FLOAT_HEIGHT, nurseryWorld.z);
    mesh.scaling.set(0.01, 0.01, 0.01); // pop-in from nothing during reveal
    mesh.isPickable = true;

    const fallback = parseHexColor(SPROUT_TYPES[sproutType]?.primaryColor, TYPE_FALLBACK_COLOR[sproutType]);
    const material = createManifestMaterial(scene, `terrarium.sprout.${id}.mat`, textureKey(sproutType, 'reveal'), fallback);
    // Lit, not unlit-disableLighting — the brief explicitly calls out Sprouts
    // as an "interactive focal asset" that must not be a flat unlit sticker.
    // This is safe from the inconsistent-billboard-lighting risk that would
    // normally make a lit camera-facing sprite look odd as the camera
    // orbits: src/render/camera.ts's ArcRotateCamera alpha (yaw) is never
    // rotated by any input path (pan/zoom only), so a BILLBOARDMODE_Y
    // sprite's world-facing direction — and therefore its lit response to
    // the fixed key light — is constant for the whole session, not
    // per-frame-varying. Roughness/metallic stay at PBRMetallicRoughnessMaterial
    // defaults (waxy/matte, non-metal); a modest emissive keeps the design
    // readable even in the fill light's cooler shadow side.
    material.roughness = 0.55;
    material.metallic = 0;
    material.emissiveColor = fallback.scale(0.35);
    mesh.material = material;

    const visual: SproutVisual = {
      id,
      sproutType,
      mesh,
      material,
      state: 'reveal',
      tile: NURSERY_TILE,
      held: false,
      settledHabitat: null,
      wanderSeed: Math.random() * 1000,
    };
    mesh.metadata = { kind: 'sprout', sproutId: id };
    visuals.set(id, visual);

    // Emitted from the mound's top face, not the tile centre: the burst adds
    // its own +0.3 internally, so a tile-centre y of 0 put the whole reveal
    // sparkle at 0.30 — inside a mound whose top face is at 0.70.
    createSparkleBurst(scene, { x: nurseryWorld.x, y: nurseryTopY(), z: nurseryWorld.z }, { count: 16, color: undefined });

    const revealStart = performance.now();
    const observer = scene.onBeforeRenderObservable.add(() => {
      const durationMs = 420; // reveal always plays at a fixed, readable pace regardless of motion config's ambient scaling
      const t = Math.min(1, (performance.now() - revealStart) / durationMs);
      const eased = easingFn('bounce')(t);
      const scale = 0.01 + eased * 0.99;
      mesh.scaling.set(scale, scale, scale);
      if (t >= 1) {
        scene.onBeforeRenderObservable.remove(observer);
        mesh.scaling.set(1, 1, 1);
        if (visual.state === 'reveal') setState(visual, 'idle');
      }
    });
  };

  // Live ride animations, keyed by Sprout id, so a ride can be torn down the
  // moment the SIMULATION says it is over. Without this the ride's observer
  // keeps writing `mesh.position` after `sprout:settled` has already parked the
  // Sprout in its habitat slot, and the two fight over the same mesh — trivial
  // to hit with the dev speed control, which finishes a ride in a couple of
  // frames while the animation is still budgeted for the full interval.
  const rides = new Map<string, { observer: ReturnType<typeof scene.onBeforeRenderObservable.add>; toTile: TileCoord }>();

  /** Stops any in-flight ride for `id`, leaving the Sprout logically arrived. */
  const endRide = (id: string): void => {
    const ride = rides.get(id);
    if (!ride) return;
    scene.onBeforeRenderObservable.remove(ride.observer);
    rides.delete(id);
    const visual = visuals.get(id);
    if (visual) visual.tile = ride.toTile;
  };

  // Latest MotionConfig seen by `update` (called every frame from
  // src/render/index.ts's render loop). The ride animation reads it per frame
  // rather than capturing it at ride start, so toggling Reduced motion mid-ride
  // takes effect immediately.
  let lastMotion: MotionConfig | null = null;

  const remove = (id: string): void => {
    const visual = visuals.get(id);
    if (!visual) return;
    endRide(id);
    visual.mesh.dispose();
    visual.material.dispose();
    visuals.delete(id);
  };

  const unsubscribers = [
    bus.subscribe('sprout:spawned', (e) => spawn(e.sproutId, e.sproutType, e.podId)),
    bus.subscribe('sprout:pickedUp', (e) => {
      const visual = visuals.get(e.sproutId);
      if (!visual) return;
      visual.held = true;
      setState(visual, 'walk');
    }),
    bus.subscribe('sprout:dropped', (e) => {
      const visual = visuals.get(e.sproutId);
      if (!visual) return;
      visual.held = false;
      if (!e.overHabitat) setState(visual, 'idle');
    }),
    bus.subscribe('sprout:placed:correct', (e) => {
      const visual = visuals.get(e.sproutId);
      if (!visual) return;
      setState(visual, 'happy');
      createSparkleBurst(scene, { x: visual.mesh.position.x, y: visual.mesh.position.y, z: visual.mesh.position.z }, { count: 20 });
    }),
    bus.subscribe('sprout:placed:incorrect', (e) => {
      const visual = visuals.get(e.sproutId);
      if (!visual) return;
      // Friendly retry: walk back toward the nursery, no fail-state framing
      // (a gentle habitat wobble plays separately, see habitats.ts).
      setState(visual, 'walk');
      const from = { x: visual.mesh.position.x, z: visual.mesh.position.z };
      const nurseryWorld = tileToWorld(NURSERY_TILE);
      const durationMs = 480;
      const start = performance.now();
      const observer = scene.onBeforeRenderObservable.add(() => {
        const t = Math.min(1, (performance.now() - start) / durationMs);
        const eased = easingFn('easeOut')(t);
        visual.mesh.position.x = from.x + (nurseryWorld.x - from.x) * eased;
        visual.mesh.position.z = from.z + (nurseryWorld.z - from.z) * eased;
        if (t >= 1) {
          scene.onBeforeRenderObservable.remove(observer);
          visual.tile = NURSERY_TILE;
          if (visual.state === 'walk') setState(visual, 'idle');
        }
      });
    }),
    bus.subscribe('sprout:settled', (e) => {
      const visual = visuals.get(e.sproutId);
      if (!visual) return;
      endRide(e.sproutId); // whatever the ride animation still had planned, the sim says it's home
      visual.settledHabitat = e.habitatId;
      visual.mesh.isPickable = false;
      setState(visual, 'settled');
      const habitatTile = HABITAT_TILES[e.habitatId];
      const world = tileToWorld(habitatTile);
      // Deterministic slot on the habitat's viewer-facing side so multiple
      // settled Sprouts neither overlap each other nor hide behind the
      // habitat's standee card — see sproutSettleOffset.
      const alreadySettled = Array.from(visuals.values()).filter(
        (v) => v.settledHabitat === e.habitatId && v.id !== e.sproutId,
      ).length;
      const offset = sproutSettleOffset(alreadySettled);
      visual.mesh.position.set(world.x + offset.x, sproutSettleHeight(e.habitatId), world.z + offset.z);
    }),
    // Restored save: Sprouts alive when the game was saved never re-emit
    // `sprout:spawned`, so without this the garden comes back visually empty
    // (measured: 15 Sprout meshes before a reload, 1 after) even though the
    // simulation restored them correctly. Deliberately NOT done by replaying
    // `sprout:spawned` per Sprout, which would fire the pod-open SFX and
    // reveal animation for creatures the player met long ago; these are
    // placed already-arrived, in their final pose.
    bus.subscribe('save:loaded', (e) => {
      for (const restored of e.snapshot.sprouts ?? []) {
        if (visuals.get(restored.id)) continue;
        spawn(restored.id, restored.sproutType, 'restored');
        const visual = visuals.get(restored.id);
        if (!visual) continue;
        visual.mesh.scaling.set(1, 1, 1); // skip the reveal pop-in
        if (restored.settled && restored.habitatId) {
          visual.settledHabitat = restored.habitatId;
          visual.mesh.isPickable = false;
          setState(visual, 'settled');
          const world = tileToWorld(HABITAT_TILES[restored.habitatId]);
          const alreadySettled = Array.from(visuals.values()).filter(
            (v) => v.settledHabitat === restored.habitatId && v.id !== restored.id,
          ).length;
          const offset = sproutSettleOffset(alreadySettled);
          visual.mesh.position.set(world.x + offset.x, sproutSettleHeight(restored.habitatId), world.z + offset.z);
        } else {
          setState(visual, 'idle');
          const world = tileToWorld(restored.tile);
          visual.mesh.position.set(world.x, SPROUT_FLOAT_HEIGHT, world.z);
        }
      }
    }),
    bus.subscribe('sprout:transportStarted', (e) => {
      const visual = visuals.get(e.sproutId);
      if (!visual) return;
      endRide(e.sproutId); // never stack two ride observers on one Sprout
      setState(visual, 'walk');

      const from = tileToWorld(e.fromTile);
      const to = tileToWorld(e.toTile);
      // The garden path is the physical route (GameRules §9.2) — follow it,
      // corners and all, instead of drifting diagonally across the grass.
      // Straight lerp stays as the fallback for an endpoint that somehow isn't
      // on the path network, so a Sprout always still visibly arrives.
      const route = gardenRouteBetween(e.fromTile, e.toTile);

      // Duration comes from the SIM, which is the only side that knows the
      // gardenSlideSpeed upgrade level (src/events/types.ts explains why). The
      // local fallback exists purely for resilience — e.g. a stale HMR bundle
      // emitting the pre-change event shape — and is never the normal path.
      const distanceTiles = Math.max(1, Math.abs(e.toTile.x - e.fromTile.x) + Math.abs(e.toTile.z - e.fromTile.z));
      const durationMs =
        Number.isFinite(e.durationMs) && e.durationMs > 0 ? e.durationMs : FALLBACK_TRANSPORT_MS_PER_TILE * distanceTiles;

      const start = performance.now();
      // Monotonic cursor into the route polyline: `t` only ever increases, so
      // each frame resumes the scan where the last one stopped and the whole
      // ride costs O(points) in total, with zero per-frame allocation.
      let segment = 0;
      const observer = scene.onBeforeRenderObservable.add(() => {
        // CONSTANT speed along the route's arc length, sampled off the wall
        // clock every render frame — not off sim ticks, and not with a
        // per-segment `t` that restarts at each tile. Either of those makes a
        // ride visibly step: the sim advances at 10Hz, and a per-tile parameter
        // resets velocity at every tile boundary. Arc length keeps the pace
        // continuous ACROSS segment boundaries, which is what makes a rounded
        // corner read as a belt curving rather than a Sprout pivoting.
        //
        // Deliberately linear rather than eased: a Garden Slide is a conveyor,
        // and an ease-in-out here reads as the ride speeding up in the middle.
        const t = Math.min(1, (performance.now() - start) / durationMs);
        if (route) {
          const target = t * route.totalLength;
          while (segment < route.count - 2 && route.cumulative[segment + 1] < target) segment += 1;
          const startDistance = route.cumulative[segment];
          const span = route.cumulative[segment + 1] - startDistance;
          const local = span > 1e-6 ? Math.min(1, Math.max(0, (target - startDistance) / span)) : 0;
          const i = segment * 2;
          visual.mesh.position.x = route.points[i] + (route.points[i + 2] - route.points[i]) * local;
          visual.mesh.position.z = route.points[i + 1] + (route.points[i + 3] - route.points[i + 1]) * local;
        } else {
          visual.mesh.position.x = from.x + (to.x - from.x) * t;
          visual.mesh.position.z = from.z + (to.z - from.z) * t;
        }
        // The carried arc is decoration on top of the essential travel, so it
        // is the part reduced motion drops: ambientIntensity 0 rides flat, and
        // the Sprout still visibly moves along the path.
        const hop = TRANSPORT_HOP_HEIGHT * (lastMotion?.ambientIntensity ?? 1);
        visual.mesh.position.y = SPROUT_FLOAT_HEIGHT + Math.sin(t * Math.PI) * hop;
        if (t >= 1) endRide(e.sproutId);
      });
      rides.set(e.sproutId, { observer, toTile: e.toTile });
    }),
    bus.subscribe('sprout:transportCompleted', (e) => {
      const visual = visuals.get(e.sproutId);
      if (!visual) return;
      endRide(e.sproutId);
      setState(visual, 'idle');
    }),
  ];

  const setDragPosition = (id: string, worldX: number, worldZ: number): void => {
    const visual = visuals.get(id);
    if (!visual || !visual.held) return;
    visual.mesh.position.x = worldX;
    visual.mesh.position.z = worldZ;
    visual.mesh.position.y = SPROUT_FLOAT_HEIGHT;
  };

  /**
   * Tints the dragged Sprout itself so the "ghost" being carried reads as
   * valid (bright/normal) vs invalid (dim/red-tinge) drop target, alongside
   * the habitat-level highlight in habitats.ts. `null` clears the tint.
   */
  const setDragValidity = (id: string, valid: boolean | null): void => {
    const visual = visuals.get(id);
    if (!visual) return;
    const base = parseHexColor(SPROUT_TYPES[visual.sproutType]?.primaryColor, TYPE_FALLBACK_COLOR[visual.sproutType]);
    if (valid === false) {
      visual.material.emissiveColor = new Color3(0.35, 0.08, 0.08);
      visual.mesh.visibility = 0.6;
    } else if (valid === true) {
      visual.material.emissiveColor = base.scale(1.1);
      visual.mesh.visibility = 1;
    } else {
      visual.material.emissiveColor = base.scale(0.9);
      visual.mesh.visibility = 1;
    }
  };

  const update = (motion: MotionConfig, nowMs: number): void => {
    lastMotion = motion;
    for (const visual of visuals.values()) {
      // A Sprout mid-ride owns its own y (arc + travel); the idle bob must not
      // fight it for the same field.
      if (visual.held || visual.state === 'reveal' || visual.state === 'settled' || rides.has(visual.id)) continue;
      if (motion.ambientIntensity <= 0) {
        visual.mesh.position.y = SPROUT_FLOAT_HEIGHT;
        continue;
      }
      const bob = Math.sin(nowMs / 500 + visual.wanderSeed) * SPROUT_BOB_AMPLITUDE * motion.ambientIntensity;
      visual.mesh.position.y = SPROUT_FLOAT_HEIGHT + bob;
    }
  };

  const dispose = (): void => {
    for (const unsub of unsubscribers) unsub();
    for (const id of Array.from(visuals.keys())) remove(id);
  };

  return {
    get: (id) => visuals.get(id),
    all: () => Array.from(visuals.values()),
    meshes: () => Array.from(visuals.values()).map((v) => v.mesh),
    setDragPosition,
    setDragValidity,
    update,
    dispose,
  };
}
