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
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { Scene } from '@babylonjs/core/scene';

import { createManifestMaterial } from './assets';
import { GARDEN_CAMERA_ALPHA } from './camera';
import { tileToWorld, type TileCoord } from './coords';
import { createHabitatOccupancySigns, occupancySignState } from './habitats';
import { findPathRoute, HABITAT_TILES, NURSERY_TILE } from './layout';
import { easingFn, getMotionConfig, prefersReducedMotion, type MotionConfig } from './motion';
import { createMoodBadgeMaterial } from './pbrMaterials';
import { createSparkleBurst } from './particles';
import { automationSiteTopY, habitatTopY, nurseryTopY } from './propDims';
import type { EventBus } from '../events/bus';
import type { HabitatId, MoodId, SproutTypeId } from '../core/ids';
import { getEffectiveHabitatCapacity } from '../data/habitats';
import { MOODS } from '../data/moods';
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

/**
 * Edge length of the Sprout billboard plane.
 *
 * Raised from 0.70 to 0.95 (2026-08-01, first-session settle-loop pass).
 * MEASURED, not a taste call: at the default camera a 0.70 Sprout rendered
 * roughly 20x22 CSS pixels — see
 * docs/qa-screenshots/settle-loop/before/02-sprout-waiting.png, where the
 * Ember Sprout is a fuzzy speck beside the Nursery mound with no readable
 * face. docs/REFERENCE_BOARD.md's non-negotiable list fails a build whose
 * Sprouts read as flat icons, and the promoted creature references
 * (docs/references/slime-rancher-2/creature-readability/,
 * docs/references/ooblets/creature-personality/) both put the creature at a
 * size where silhouette AND expression are legible without zooming.
 *
 * Why 0.95 and not larger: the settled-crowd slot table below (and the
 * invariant pinned by tests/unit/render.settleSlots.test.ts) fits six
 * standing Sprouts inside the smallest habitat's 1.0-unit flat top face.
 * Cards wider than about one unit start hiding the interleaved back row,
 * which is the exact failure the SETTLE_ROW_STAGGER note describes. The rest
 * of the readability gain is taken by the camera's default framing instead
 * (see DEFAULT_RADIUS in src/render/camera.ts) — moving both a moderate
 * amount beats pushing either one past what its own constraints allow.
 */
export const SPROUT_SPRITE_SIZE = 0.95;
/**
 * Edge of a Sprout's mood-badge child quad (Mood Bell feature, 2026-08-01).
 *
 * Larger than the 0.12 solid primitive it replaces, but the ICON is smaller:
 * the glyph occupies roughly the middle third of an otherwise transparent
 * quad, and the surrounding space is its soft halo. Sizing the quad to the
 * glyph would crop the halo and put a hard edge back on the badge.
 */
const MOOD_BADGE_SIZE = 0.24;
/** Offset from the sprite's centre (what `position` sets) to its bottom edge. */
const SPROUT_HALF_HEIGHT = SPROUT_SPRITE_SIZE / 2;
/** Air gap left between a surface and the sprite's bottom edge. */
const SPROUT_SURFACE_CLEARANCE = 0.03;
/**
 * Vertical squash applied to a Sprout's contact-shadow disc so it reads as an
 * ellipse on the ground under this camera's fixed ~62deg beta rather than as a
 * perfect circle painted on the floor.
 */
const SHADOW_FORESHORTEN = 0.62;
/** How far above its surface a contact shadow floats, purely to avoid
 * z-fighting with the ground/habitat top face it lies on. */
const SHADOW_SURFACE_LIFT = 0.012;
/** Opacity of a contact shadow when the Sprout is resting on its surface, and
 * when it is at the top of a drag/bob. The shadow softens and shrinks as the
 * Sprout rises — that CHANGE is what sells the contact; a constant blob under
 * a hovering creature reads as a painted decal. */
const SHADOW_ALPHA_CONTACT = 0.34;
const SHADOW_ALPHA_LIFTED = 0.12;
/** Height above the surface at which a shadow reaches SHADOW_ALPHA_LIFTED. */
const SHADOW_LIFT_RANGE = 1.1;

/** Peak amplitude of the idle bob in `update` below. The floating height has
 * to budget for it: without this term the bob's DOWNWARD half would dip the
 * card's bottom edge back under the Nursery's top face. */
const SPROUT_BOB_AMPLITUDE = 0.05;

/**
 * Resting/drag height for a Sprout that is NOT settled and NOT mid-ride —
 * clears the Nursery mound (the tallest thing an idle or dragged Sprout
 * hovers over) by its own half-height plus the bob amplitude plus the
 * clearance. Exported because src/input/index.ts's pointer-to-world drag
 * plane has to sit at exactly this height, and tests/e2e/helpers.ts projects
 * it to find the pickup point.
 */
export const SPROUT_FLOAT_HEIGHT = nurseryTopY() + SPROUT_BOB_AMPLITUDE + SPROUT_SURFACE_CLEARANCE + SPROUT_HALF_HEIGHT;

/**
 * Ride height for a Sprout mid-transport — NOT the same figure as
 * SPROUT_FLOAT_HEIGHT. That constant clears the Nursery mound (0.70), which
 * made every ride cruise at ~1.13 for its whole journey: fine for clearing
 * the mound at the start, but the Garden Slide/Colour Gate's own belt sits at
 * a plinth top of 0.5 (see automationSiteTopY), so a carried Sprout floated
 * roughly twice the structure's own height above it while passing beside a
 * built one — measured/reported as "floating unrelated nearby" rather than
 * "riding the conveyor" (GameRules §9.3: "carries Sprouts with a fun movement
 * animation"). Derived from the plinth's own top face the same way every
 * other "resting ON a surface" height in this file is (see
 * sproutSettleHeight below), so it reads as riding the structure rather than
 * hovering an arbitrary distance above it.
 */
export const SPROUT_RIDE_HEIGHT = automationSiteTopY() + SPROUT_SURFACE_CLEARANCE + SPROUT_HALF_HEIGHT;

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

/**
 * How many settled Sprouts a habitat draws as individual creatures — and
 * therefore the threshold past which the population is carried by the
 * occupancy sign instead (see createHabitatOccupancySigns in habitats.ts).
 *
 * SIX is not a taste call, it is exactly how many distinct standing positions
 * the slot table above describes. The old code took `index % SETTLE_ROWS`, so
 * the seventh settled Sprout was placed at the *identical* world position as
 * the first, the eighth on the second, and so on: past six the crowd was not
 * merely dense but literally coincident z-fighting billboards, unreadable,
 * unselectable and covering the habitat's own art. Habitats hold 8 with no
 * upgrades and 17 with Habitat Capacity maxed, so this is a state every player
 * reaches — and six sits comfortably below even the base capacity, which is
 * what makes the transition a normal part of play rather than an edge case.
 * (GameRules §7.4: Sprouts "must never create visual chaos or selection
 * frustration".)
 */
export const SETTLE_VISIBLE_SLOTS = SETTLE_SLOTS_PER_ROW * SETTLE_ROWS;

/** Lateral gap between neighbours in a roomy crowd (occupancy at or below the
 * visible slots) and in a packed one (occupancy at capacity). */
const SETTLE_SLOT_SPACING_LOOSE = 0.44;
const SETTLE_SLOT_SPACING_TIGHT = 0.3;
/** How far in front of the card the first row stands. Kept small enough that
 * even the smallest habitat's FLAT top face (Ember Nook: 1.1 outer radius less
 * its 0.1 rim bevel = 1.0) comfortably contains every slot — the furthest is
 * hypot(0.62, 0.55) = 0.83 from the centre, checked in
 * tests/unit/render.settleSlots.test.ts. */
const SETTLE_FRONT_DISTANCE = 0.62;
const SETTLE_ROW_SPACING_LOOSE = 0.3;
const SETTLE_ROW_SPACING_TIGHT = 0.22;
/**
 * The back row is offset half a step sideways, and the whole crowd shifted a
 * quarter step back the other way to stay centred, so the two rows INTERLEAVE
 * instead of lining up in columns.
 *
 * Measured in-browser, not guessed: a settled Sprout's card is ~87px wide at
 * the default camera while a loose lateral step is ~55px, so neighbours
 * genuinely overlap. With the rows aligned, every back-row Sprout sat exactly
 * behind a front-row one and was completely invisible — the habitat looked
 * like it held three creatures no matter how full it was. Interleaved, each
 * back-row Sprout shows through the gap between two front-row ones, so all six
 * read and the huddle gets visibly denser as the spacing tightens.
 */
const SETTLE_ROW_STAGGER = 0.5;

/**
 * How tightly the visible crowd packs, given the habitat's true population and
 * capacity.
 *
 * This is what keeps occupancy readable FROM THE WORLD once the crowd stops
 * growing. Without it, every habitat from the seventh Sprout to its last one
 * would look identical and the only thing distinguishing "just over the line"
 * from "no room left" would be a number on a sign — precisely the
 * text-dependence GameRules §8.1 rules out. With it, the same six creatures
 * stand progressively shoulder-to-shoulder as the home fills, so a busy
 * habitat plainly looks busy and a full one plainly looks packed before the
 * player reads anything.
 */
export function settleCrowdSpacing(count: number, capacity: number): { lateral: number; row: number } {
  const span = Math.max(1, capacity - SETTLE_VISIBLE_SLOTS);
  const t = Math.min(1, Math.max(0, (count - SETTLE_VISIBLE_SLOTS) / span));
  return {
    lateral: SETTLE_SLOT_SPACING_LOOSE + (SETTLE_SLOT_SPACING_TIGHT - SETTLE_SLOT_SPACING_LOOSE) * t,
    row: SETTLE_ROW_SPACING_LOOSE + (SETTLE_ROW_SPACING_TIGHT - SETTLE_ROW_SPACING_LOOSE) * t,
  };
}

/**
 * Deterministic XZ offset from a habitat's centre for the Nth settled Sprout —
 * a small crowd standing in front of the habitat's sign, never behind it —
 * or `null` when this Sprout is beyond the visible slots and is represented by
 * the occupancy sign instead of by its own sprite.
 *
 * Pure and index-based on purpose: a Sprout keeps the slot it was given, and
 * the same (index, count, capacity) always yields the same position, so a
 * restored save rebuilds the exact arrangement the player left behind.
 */
export function sproutSettleOffset(index: number, count: number, capacity: number): { x: number; z: number } | null {
  if (index < 0 || index >= SETTLE_VISIBLE_SLOTS) return null;
  const spacing = settleCrowdSpacing(count, capacity);
  const row = Math.floor(index / SETTLE_SLOTS_PER_ROW);
  const column = index % SETTLE_SLOTS_PER_ROW;
  const stagger = (row * SETTLE_ROW_STAGGER - ((SETTLE_ROWS - 1) * SETTLE_ROW_STAGGER) / 2) * spacing.lateral;
  const lateral = (column - (SETTLE_SLOTS_PER_ROW - 1) / 2) * spacing.lateral + stagger;
  const forward = SETTLE_FRONT_DISTANCE - row * spacing.row;
  return {
    x: VIEWER_X * forward + LATERAL_X * lateral,
    z: VIEWER_Z * forward + LATERAL_Z * lateral,
  };
}

// ---------------------------------------------------------------------------
// Nursery waiting-area slots
// ---------------------------------------------------------------------------
// Every idle Sprout used to sit at the EXACT SAME world position — the
// Nursery tile's centre, set once at spawn and never touched again unless the
// Sprout was dragged. A quiet garden never noticed; a garden that had
// accumulated hundreds of unclaimed Sprouts (the Nursery "rests" rather than
// deletes any of them, GameRules §7.4) rendered them as one coincident stack
// of billboards fighting each other for the same pixels — visually
// indistinguishable from nothing being there at all, and a real cost driver
// at hundreds of live, enabled, individually-drawn meshes.
//
// Fix mirrors the settled-Sprout crowd above: a small, fixed set of standing
// spots fanned out on the viewer-facing side of the Nursery, claimed and
// released as Sprouts arrive at / leave the waiting pool. Past the visible
// slots, an idle Sprout is simply not drawn (mesh disabled, still fully alive
// in SimState, still counted by the existing HUD note in
// src/ui/components/nurseryNote.ts) until a slot frees up and it is promoted
// into it. Nothing here ever deletes a Sprout or makes one permanently
// unreachable — only which ones currently have a sprite on screen.
const NURSERY_SLOTS_PER_ROW = 4;
const NURSERY_WAIT_ROWS = 3;
/** How many waiting Sprouts stand individually before the rest go uncounted
 * by sprite (still tracked in full by the sim and by the Nursery's HUD note). */
export const NURSERY_VISIBLE_SLOTS = NURSERY_SLOTS_PER_ROW * NURSERY_WAIT_ROWS;
const NURSERY_SLOT_LATERAL = 0.5;
const NURSERY_SLOT_ROW_SPACING = 0.42;
/** How far toward the viewer the front row stands from the Nursery's centre —
 * clear of the mound itself, of the pod standee card billboarded on top of it
 * (world.ts's `terrarium.nursery.cap`, ~1 unit tall, Y-billboarded to always
 * face the fixed garden camera — see GARDEN_CAMERA_ALPHA), and of the trunk
 * path leaving north toward the Garden Slide. 0.85 cleared the mound's own
 * body (halfWidth 0.8) but not the taller standee sitting on top of it: at
 * the production camera angle (same alpha/beta as GARDEN_CAMERA_ALPHA/
 * ISO_BETA, just zoomed in), the standee was the nearest hit on a ray through
 * the front-centre waiting Sprout's own crown — genuine 3D occlusion, not a
 * draw-order bug (confirmed with src/render/index.ts's dev-only pickRay
 * hook). Screenshot-verified before/after at 12 waiting Sprouts (the
 * standing-room cap): the front row's crown tips visibly touched the mound's
 * silhouette at 0.85 and fully cleared it at 1.2. */
const NURSERY_FRONT_DISTANCE = 1.2;
const NURSERY_ROW_STAGGER = 0.5;

/**
 * Deterministic XZ offset from the Nursery's centre for the Nth waiting-slot
 * Sprout, or null past the visible slot count. Pure and index-based for the
 * same reason `sproutSettleOffset` is: a restored save must rebuild the exact
 * arrangement it left behind, and a Sprout must not visibly hop between spots
 * while it is simply standing there waiting.
 */
export function nurseryWaitOffset(index: number): { x: number; z: number } | null {
  if (index < 0 || index >= NURSERY_VISIBLE_SLOTS) return null;
  const row = Math.floor(index / NURSERY_SLOTS_PER_ROW);
  const column = index % NURSERY_SLOTS_PER_ROW;
  const stagger = (row * NURSERY_ROW_STAGGER - ((NURSERY_WAIT_ROWS - 1) * NURSERY_ROW_STAGGER) / 2) * NURSERY_SLOT_LATERAL;
  const lateral = (column - (NURSERY_SLOTS_PER_ROW - 1) / 2) * NURSERY_SLOT_LATERAL + stagger;
  // Rows recede AWAY from the viewer (the queue extends outward from the
  // pod), the opposite sense from the settled crowd's rows, which come
  // forward from the habitat card.
  const forward = NURSERY_FRONT_DISTANCE + row * NURSERY_SLOT_ROW_SPACING;
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
// The route is found by breadth-first search over GARDEN_PATH_TILES, via
// src/sim/layout.ts's findPathRoute (moved there 2026-08-01 so sim can use
// the same search to compute a manually-placed automation's destination —
// this module keeps only the render-specific polyline/fillet building
// below). BFS rather than re-deriving the Manhattan run: the union is the
// authoritative network, and searching it means this can never disagree
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

/** How far from a corner the fillet starts, in world units (tiles are 1 unit). */
const ROUTE_CORNER_RADIUS = 0.45;
/** Bézier samples per rounded corner — enough to read as a curve, few enough to stay cheap. */
const ROUTE_CORNER_SAMPLES = 7;

function routeTileKey(tile: TileCoord): string {
  return `${tile.x},${tile.z}`;
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
  const tiles = findPathRoute(from, to);
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
  mood: MoodId;
  mesh: Mesh;
  /**
   * Ground-plane contact shadow, kept UNDER the billboard rather than parented
   * to it (a child of a billboarding, bobbing card would tilt and rise with
   * it, which is the opposite of what a contact shadow does).
   *
   * Why a hand-placed decal and not the real shadow generator: the Sprout is a
   * camera-facing alpha-tested plane, so a projected shadow map of it is a
   * shifting, ragged smear that reads as dirt rather than contact. Every
   * promoted creature reference (docs/references/ooblets/creature-personality/,
   * docs/references/slime-rancher-2/creature-readability/) grounds its
   * creatures with a soft, tight, elliptical contact darkening directly
   * beneath them — that is the measurable quality being reproduced here, in an
   * original form, and it is what stops a billboard from reading as a sticker
   * floating in front of the world.
   */
  shadow: Mesh;
  material: PBRMetallicRoughnessMaterial;
  state: SproutVisualState;
  tile: TileCoord;
  held: boolean;
  settledHabitat: HabitatId | null;
  /** Which standing slot this Sprout claimed when it settled, or null if it
   * hasn't settled. Stored rather than recomputed because the crowd is laid
   * out again every time the population or capacity changes (see
   * `settleCrowdSpacing`), and a Sprout must not hop between slots when that
   * happens. Indexes at or above SETTLE_VISIBLE_SLOTS have no sprite. */
  settleIndex: number | null;
  /** Which Nursery waiting-slot this Sprout currently occupies, or null while
   * it is not idle-at-the-Nursery at all, or idle there but past the visible
   * slot count (an "overflow" Sprout — see NURSERY_VISIBLE_SLOTS). */
  waitSlot: number | null;
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

/** How long an overflow arrival takes to shrink out of sight after reaching
 * its habitat. Short, but never zero even under reduced motion — the player
 * must SEE the Sprout arrive and be taken in, otherwise the seventh creature
 * they carefully carried across the garden simply blinks out of existence.
 * (motion.ts's rule: core feedback gets calmer, never absent.) */
const SETTLE_TUCK_DURATION_MS = 280;

export function createSproutManager(scene: Scene, bus: EventBus): SproutManager {
  const visuals = new Map<string, SproutVisual>();
  const signs = createHabitatOccupancySigns(scene);

  // Effective capacity is a render-side derivation of two authoritative sim
  // facts: the Habitat Capacity upgrade level (from `upgrade:purchased`, and
  // from the restored snapshot on load) fed through the very same
  // `getEffectiveHabitatCapacity` the simulation uses. Deriving it this way
  // rather than tracking `habitat:full` means the two can never disagree —
  // and, unlike the sticky "is full" set, it corrects itself the instant the
  // player buys another capacity level and a full habitat stops being full.
  let habitatCapacityLevel = 0;
  const capacityOf = (habitatId: HabitatId): number =>
    getEffectiveHabitatCapacity(habitatId, habitatCapacityLevel);

  const textureKey = (type: SproutTypeId, state: 'idle' | 'walk' | 'happy' | 'reveal'): string =>
    `sprout.${type}.${state}`;

  // -------------------------------------------------------------------------
  // Nursery waiting-slot bookkeeping (see nurseryWaitOffset above)
  // -------------------------------------------------------------------------
  /** `nurserySlotOwner[i]` is the Sprout id currently standing in slot i, or
   * null. Tiny fixed-size array (NURSERY_VISIBLE_SLOTS), scanned rather than
   * indexed by a separate map because it's small and only touched on discrete
   * arrival/departure events, never per frame. */
  const nurserySlotOwner: Array<string | null> = new Array(NURSERY_VISIBLE_SLOTS).fill(null);
  /** Sprout ids that are idle-at-the-Nursery but currently have no slot —
   * their mesh is disabled. Iteration order (insertion order, for a Set) is
   * used only to pick SOME candidate to promote when a slot frees up; there
   * is no fairness requirement, every idle Sprout is interchangeable until a
   * player or automation picks it. */
  const nurseryOverflow = new Set<string>();

  const isWaitingAtNursery = (visual: SproutVisual): boolean =>
    visual.state === 'idle' && !visual.held && visual.tile.x === NURSERY_TILE.x && visual.tile.z === NURSERY_TILE.z;

  /** Gives `visual` a standing slot near the Nursery if one is free, or marks
   * it as overflow (mesh disabled, still fully alive in SimState) otherwise.
   * No-ops if `visual` already holds a slot, or is not actually idle at the
   * Nursery right now — safe to call speculatively after any state change. */
  const claimNurserySlot = (visual: SproutVisual): void => {
    if (visual.waitSlot !== null || !isWaitingAtNursery(visual)) return;
    const free = nurserySlotOwner.indexOf(null);
    if (free === -1) {
      nurseryOverflow.add(visual.id);
      visual.mesh.setEnabled(false);
      return;
    }
    nurserySlotOwner[free] = visual.id;
    visual.waitSlot = free;
    nurseryOverflow.delete(visual.id);
    const offset = nurseryWaitOffset(free);
    const world = tileToWorld(NURSERY_TILE);
    if (offset) visual.mesh.position.set(world.x + offset.x, visual.mesh.position.y, world.z + offset.z);
    visual.mesh.setEnabled(true);
  };

  /** Releases whatever Nursery slot (or overflow membership) `visual` holds —
   * called on every transition AWAY from idle-at-the-Nursery, whether that's
   * a player picking it up, an automation boarding it, or it settling. If a
   * real slot frees up, promotes one waiting overflow Sprout into it, so the
   * visible waiting area never sits short while a queue remains. Harmless
   * no-op if `visual` held no slot and was not in the overflow set. */
  const releaseNurserySlot = (visual: SproutVisual): void => {
    nurseryOverflow.delete(visual.id);
    if (visual.waitSlot === null) return;
    nurserySlotOwner[visual.waitSlot] = null;
    visual.waitSlot = null;
    const promotedId = nurseryOverflow.values().next().value;
    if (promotedId === undefined) return;
    const promoted = visuals.get(promotedId);
    if (promoted) claimNurserySlot(promoted); // finds the slot just freed above
  };

  // -------------------------------------------------------------------------
  // Shared per-(type, visual-state) materials
  // -------------------------------------------------------------------------
  // Every live Sprout used to own its own PBRMetallicRoughnessMaterial,
  // created via createManifestMaterial in `spawn` and then privately mutated
  // in place by `setState` (swapManifestMaterialTexture) and `setDragValidity`
  // (emissiveColor). That is fine at a few dozen Sprouts but not at the ~850 a
  // long session can accumulate (GameRules §7.4 forbids ever deleting one for
  // player inaction) — Babylon has to track hundreds of otherwise-identical
  // materials, each with its own texture binding, purely because they happen
  // to belong to different Sprout instances of the SAME species in the SAME
  // animation pose. Sprouts of the same species and the same visual state are
  // pixel-identical, so one material is shared by every Sprout currently in
  // that (type, state) combination; a state change swaps `mesh.material` to a
  // different cached entry rather than mutating the material any Sprout is
  // currently pointed at (which would repaint every OTHER Sprout sharing it).
  // A session with 850 Sprouts across 4 types x 4 texture states now needs at
  // most 16 "normal" materials, plus up to 4 more for the drag-tint variants
  // below — not 850.
  const sharedSproutMaterials = new Map<string, PBRMetallicRoughnessMaterial>();

  /**
   * Mood badges (Mood Bell feature, 2026-08-01): a small ADDITIVE child mesh
   * per Sprout showing its mood, deliberately NOT folded into
   * `sharedSproutMaterials`'/`sharedMaterialFor`'s existing (sproutType,
   * cacheKey) texture cache — mood is orthogonal to type/state, and widening
   * that cache's key to a 3-dimensional (type x mood x state) matrix would
   * multiply the material/texture count for no reason, since a badge's
   * colour depends on mood ALONE. Two shared materials total (one per mood),
   * same "shared, never mutated in place" discipline as `sharedSproutMaterials`.
   * Shape (not just colour) distinguishes the two — GameRules §7.1 colour+
   * shape encoding — via two different primitive meshes, not two textures.
   */
  const sharedMoodBadgeMaterials = new Map<MoodId, PBRMetallicRoughnessMaterial>();
  const moodBadgeMaterialFor = (mood: MoodId): PBRMetallicRoughnessMaterial => {
    const existing = sharedMoodBadgeMaterials.get(mood);
    if (existing) return existing;
    const fallback = parseHexColor(MOODS[mood]?.primaryColor, new Color3(0.8, 0.8, 0.8));
    const material = createMoodBadgeMaterial(scene, mood, fallback);
    sharedMoodBadgeMaterials.set(mood, material);
    return material;
  };

  /** One StandardMaterial shared by every Sprout's contact shadow. Alpha is
   * per-shadow (mesh.visibility), so a single material serves all of them —
   * a material per Sprout would be pure waste at a few hundred creatures. */
  let shadowMaterial: StandardMaterial | undefined;
  const sharedShadowMaterial = (): StandardMaterial => {
    if (shadowMaterial) return shadowMaterial;
    const created = new StandardMaterial('terrarium.sprout.shadow.mat', scene);
    created.diffuseColor = Color3.Black();
    created.specularColor = Color3.Black();
    created.emissiveColor = Color3.Black();
    created.disableLighting = true; // a shadow must not itself be lit
    // Left fully opaque on the MATERIAL: per-shadow opacity is driven by each
    // mesh's `visibility`, which Babylon multiplies into the material alpha
    // (and which by itself forces the mesh into the alpha-blend pass). Setting
    // both would multiply the two and give a shadow a third of its intended
    // strength.
    created.alpha = 1;
    created.backFaceCulling = false;
    shadowMaterial = created;
    return created;
  };

  /** Builds (or returns the cached) material for one (type, cacheKey)
   * combination. Never mutated after creation; a Sprout that needs to look
   * different gets pointed at a DIFFERENT cached material instead. */
  const sharedMaterialFor = (
    sproutType: SproutTypeId,
    cacheKey: string,
    manifestState: 'idle' | 'walk' | 'happy' | 'reveal',
    emissiveColor: Color3,
  ): PBRMetallicRoughnessMaterial => {
    const mapKey = `${sproutType}:${cacheKey}`;
    const existing = sharedSproutMaterials.get(mapKey);
    if (existing) return existing;
    const fallback = parseHexColor(SPROUT_TYPES[sproutType]?.primaryColor, TYPE_FALLBACK_COLOR[sproutType]);
    const material = createManifestMaterial(scene, `terrarium.sprout.shared.${mapKey}`, textureKey(sproutType, manifestState), fallback);
    material.roughness = 0.55;
    material.metallic = 0;
    material.emissiveColor = emissiveColor;

    // Adopt an already-resolved sibling's texture synchronously.
    //
    // createManifestMaterial starts a material at `baseColor = fallbackColor`
    // with NO baseTexture and fills the texture in from an ASYNC callback. A
    // material with no baseTexture has nothing for `_useAlphaFromAlbedoTexture`
    // to read, so its alpha is a solid 1 and the mesh draws as an opaque,
    // fully saturated, fallback-coloured rectangle — the "square block" the
    // player reported. (assets.ts:320 documents the same failure mode for the
    // material-swap path.)
    //
    // Every variant for a given (type, manifestState) paints the SAME manifest
    // texture and differs only in emissive tint, so if a sibling has already
    // resolved, take its texture here and the new material is correct on its
    // very first frame. The async load still runs underneath and re-assigns
    // the identical texture.
    //
    // Defence in depth rather than the primary fix: the drag path no longer
    // creates a material mid-gesture at all (see setDragValidity), which is
    // what actually closed that bug. This keeps any FUTURE variant from
    // reintroducing it.
    const resolvedSibling = sharedSproutMaterials.get(`${sproutType}:${manifestState}`);
    if (resolvedSibling?.baseTexture) {
      material.baseTexture = resolvedSibling.baseTexture;
      material.baseColor = Color3.White(); // must mirror createManifestMaterial: baseColor multiplies the texture
    }

    sharedSproutMaterials.set(mapKey, material);
    return material;
  };

  /** The normal (non-drag) shared material for a Sprout's current visual
   * state — every Sprout of this type in this state points at the same one. */
  const normalMaterialFor = (sproutType: SproutTypeId, state: 'idle' | 'walk' | 'happy' | 'reveal'): PBRMetallicRoughnessMaterial => {
    const fallback = parseHexColor(SPROUT_TYPES[sproutType]?.primaryColor, TYPE_FALLBACK_COLOR[sproutType]);
    return sharedMaterialFor(sproutType, state, state, fallback.scale(0.35));
  };

  /** Points `visual.mesh.material` at the correct shared, non-drag material
   * for whatever visual state it is CURRENTLY in — factored out so
   * `setDragValidity`'s "clear the tint" case can restore the right material
   * without having to know or guess what state the drop just resolved to. */
  const applyNormalMaterial = (visual: SproutVisual): void => {
    const key = visual.state === 'settled' ? 'happy' : visual.state;
    if (key !== 'idle' && key !== 'walk' && key !== 'happy' && key !== 'reveal') return;
    visual.material = normalMaterialFor(visual.sproutType, key);
    visual.mesh.material = visual.material;
  };

  const setState = (visual: SproutVisual, state: SproutVisualState): void => {
    visual.state = state;
    applyNormalMaterial(visual);
  };

  const spawn = (id: string, sproutType: SproutTypeId, mood: MoodId, podId: string): void => {
    void podId;
    if (visuals.has(id)) return;
    const nurseryWorld = tileToWorld(NURSERY_TILE);
    const mesh = MeshBuilder.CreatePlane(`terrarium.sprout.${id}`, { size: SPROUT_SPRITE_SIZE }, scene);
    mesh.billboardMode = Mesh.BILLBOARDMODE_Y;
    mesh.position.set(nurseryWorld.x, SPROUT_FLOAT_HEIGHT, nurseryWorld.z);
    mesh.scaling.set(0.01, 0.01, 0.01); // pop-in from nothing during reveal
    mesh.isPickable = true;

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
    //
    // The material is one of the small shared cache below (per species x
    // visual state), NOT created fresh per Sprout — see `sharedMaterialFor`.
    const material = normalMaterialFor(sproutType, 'reveal');
    mesh.material = material;

    // Pre-warm every OTHER material this species will ever need, now, while
    // the Sprout is still popping out of its pod — several seconds before the
    // player can possibly pick it up. Each of these kicks off its manifest
    // texture load on creation (see the note in sharedMaterialFor), and a
    // material created at the moment it is first SHOWN draws one or more
    // frames as a flat fallback-coloured square. Creating them here moves
    // that unavoidable async window somewhere the player never sees it,
    // instead of into the first frame of a drag gesture. Cheap and bounded:
    // the cache is keyed per (type, variant), so this is a handful of
    // materials per species for the whole session, not per Sprout.
    normalMaterialFor(sproutType, 'idle');
    normalMaterialFor(sproutType, 'walk');
    normalMaterialFor(sproutType, 'happy');

    const shadow = MeshBuilder.CreateDisc(
      `terrarium.sprout.${id}.shadow`,
      { radius: SPROUT_SPRITE_SIZE * 0.34, tessellation: 16 },
      scene,
    );
    shadow.rotation.x = Math.PI / 2; // lie flat on the ground plane
    shadow.scaling.set(1, SHADOW_FORESHORTEN, 1); // ellipse, matching the iso camera's ground foreshortening
    shadow.isPickable = false;
    shadow.material = sharedShadowMaterial();
    shadow.position.set(nurseryWorld.x, nurseryTopY() + SHADOW_SURFACE_LIFT, nurseryWorld.z);

    const visual: SproutVisual = {
      id,
      sproutType,
      mood,
      mesh,
      shadow,
      material,
      state: 'reveal',
      tile: NURSERY_TILE,
      held: false,
      settledHabitat: null,
      settleIndex: null,
      waitSlot: null,
      wanderSeed: Math.random() * 1000,
    };
    mesh.metadata = { kind: 'sprout', sproutId: id };
    visuals.set(id, visual);

    // Mood badge: a small alpha-cut icon parented to the sprite, child of
    // `mesh` so it billboards and moves with it for free — disposed
    // automatically when `mesh` is (Babylon disposes children recursively).
    //
    // A QUAD, not a solid. It used to be a literal CreateSphere for sunny and
    // a literal CreateBox for sleepy, both untextured: at the camera distance
    // this game is actually played at, that box read as a pale cube floating
    // beside the creature — the player reported the Sprout "turning into a
    // square block". Because the icon's quad is mostly transparent there is
    // now no block to see, only the glyph (see createMoodBadgeMaterial).
    //
    // Shape still carries the distinction, not colour (GameRules §11): sunny
    // is a sparkle, sleepy a crescent.
    const badgeMaterial = moodBadgeMaterialFor(mood);
    const badge = MeshBuilder.CreatePlane(`terrarium.sprout.${id}.moodBadge`, { size: MOOD_BADGE_SIZE }, scene);
    badge.parent = mesh;
    badge.isPickable = false;
    badge.material = badgeMaterial;
    // Tucked closer to the creature than the old primitive sat, and slightly
    // in FRONT of the sprite plane (-z in the sprite's local space) so it is
    // never half-swallowed by the artwork it annotates.
    badge.position.set(SPROUT_SPRITE_SIZE * 0.28, SPROUT_SPRITE_SIZE * 0.3, -0.01);

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
        claimNurserySlot(visual);
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

  /** The motion config to animate a bus-driven (non-per-frame) reaction with.
   * `update` normally has already supplied one; the fallback covers a reaction
   * that fires before the first render frame, e.g. a restored save. */
  const motionNow = (): MotionConfig => lastMotion ?? getMotionConfig(prefersReducedMotion());

  /** Overflow arrivals currently playing their shrink-away tween. They must
   * survive a relayout that would otherwise disable them mid-animation. */
  const tucking = new Set<string>();

  /**
   * Re-lays out one habitat's visible crowd and updates its occupancy sign.
   *
   * Called on every event that can change either the population or the
   * capacity — a Sprout settling, a save being restored, a Habitat Capacity
   * upgrade being bought. Capacity matters even though it changes no Sprout's
   * slot: the crowd's packing and the sign's meter are both fractions of it,
   * so buying a level must visibly loosen every habitat and un-fill any that
   * was full.
   *
   * O(live Sprouts) and only ever runs on those discrete events — never per
   * frame, and it allocates only the small offset object the pure slot helper
   * returns.
   */
  const refreshHabitat = (habitatId: HabitatId, animate: boolean): void => {
    const capacity = capacityOf(habitatId);
    let count = 0;
    for (const visual of visuals.values()) {
      if (visual.settledHabitat === habitatId) count += 1;
    }
    const world = tileToWorld(HABITAT_TILES[habitatId]);
    const y = sproutSettleHeight(habitatId);
    for (const visual of visuals.values()) {
      if (visual.settledHabitat !== habitatId || visual.settleIndex === null) continue;
      const offset = sproutSettleOffset(visual.settleIndex, count, capacity);
      if (!offset) {
        // Beyond the visible slots: this Sprout is represented by the sign's
        // count. Disabling rather than stacking it is the whole point — the
        // old behaviour parked it on top of an earlier Sprout's sprite.
        if (!tucking.has(visual.id)) visual.mesh.setEnabled(false);
        continue;
      }
      visual.mesh.position.set(world.x + offset.x, y, world.z + offset.z);
    }
    signs.set(habitatId, occupancySignState(count, capacity, SETTLE_VISIBLE_SLOTS), motionNow(), animate);
  };

  const refreshAllHabitats = (animate: boolean): void => {
    for (const habitatId of Object.keys(HABITAT_TILES) as HabitatId[]) refreshHabitat(habitatId, animate);
  };

  /** Plays the "and this one squeezes inside" shrink for an arrival that has no
   * standing slot left, then hides its sprite. */
  const tuckAway = (visual: SproutVisual, habitatId: HabitatId, count: number, capacity: number): void => {
    const motion = motionNow();
    const world = tileToWorld(HABITAT_TILES[habitatId]);
    // Slot 1 is the front row's middle position — the crowd's "doorway".
    const doorway = sproutSettleOffset(1, count, capacity);
    if (doorway) visual.mesh.position.set(world.x + doorway.x, sproutSettleHeight(habitatId), world.z + doorway.z);
    const durationMs = motion.ambientIntensity > 0 ? SETTLE_TUCK_DURATION_MS : motion.revealDurationMs;
    const start = performance.now();
    tucking.add(visual.id);
    const observer = scene.onBeforeRenderObservable.add(() => {
      const t = Math.min(1, (performance.now() - start) / durationMs);
      const scale = 1 - easingFn('easeOut')(t) * 0.98;
      visual.mesh.scaling.set(scale, scale, scale);
      if (t >= 1) {
        scene.onBeforeRenderObservable.remove(observer);
        tucking.delete(visual.id);
        visual.mesh.scaling.set(1, 1, 1);
        visual.mesh.setEnabled(false);
      }
    });
  };

  const remove = (id: string): void => {
    const visual = visuals.get(id);
    if (!visual) return;
    endRide(id);
    releaseNurserySlot(visual);
    visual.mesh.dispose();
    // The shadow is a SIBLING of the mesh, not a child (see SproutVisual.shadow
    // for why), so Babylon's recursive child disposal does not reach it and it
    // has to be disposed by hand or it stays on the ground forever.
    visual.shadow.dispose();
    // NOT visual.material.dispose(): the material is one of the small shared
    // per-(type, state) cache (see sharedMaterialFor), still in use by every
    // OTHER live Sprout of the same species and pose. It is disposed exactly
    // once, in this manager's own `dispose()`, when the whole cache goes away.
    visuals.delete(id);
  };

  const unsubscribers = [
    bus.subscribe('sprout:spawned', (e) => spawn(e.sproutId, e.sproutType, e.mood, e.podId)),
    bus.subscribe('sprout:pickedUp', (e) => {
      const visual = visuals.get(e.sproutId);
      if (!visual) return;
      releaseNurserySlot(visual); // leaving the waiting pool to be dragged
      visual.held = true;
      setState(visual, 'walk');
    }),
    bus.subscribe('sprout:dropped', (e) => {
      const visual = visuals.get(e.sproutId);
      if (!visual) return;
      visual.held = false;
      // A drop over a habitat is handled by placed:correct/incorrect below,
      // and a drop over a built automation site by transportStarted (boarded)
      // or automationDeclined (refused) — both fire synchronously out of the
      // SAME `sprout:dropped` emit, but subscriber registration order between
      // this module and src/sim/runtime.ts is not guaranteed (sim registers
      // its own listener after an `await loadGame()`). Excluding
      // `overAutomation` here too, not just `overHabitat`, keeps this handler
      // a no-op for that case regardless of which side's listener runs first
      // — it never fights transportStarted's ride setup or
      // automationDeclined's reset for the same Sprout.
      if (!e.overHabitat && !e.overAutomation) {
        setState(visual, 'idle');
        claimNurserySlot(visual); // no-ops unless this is where it was picked up from
      }
    }),
    bus.subscribe('sprout:automationDeclined', (e) => {
      const visual = visuals.get(e.sproutId);
      if (!visual) return;
      // Friendly, non-punitive: the Sprout simply stays available, exactly
      // where it was — same spirit as sprout:placed:incorrect, but without a
      // walk-back, since there is no "wrong home" to walk back from here.
      setState(visual, 'idle');
      claimNurserySlot(visual);
    }),
    bus.subscribe('sprout:placed:correct', (e) => {
      const visual = visuals.get(e.sproutId);
      if (!visual) return;
      setState(visual, 'happy');
      createSparkleBurst(scene, { x: visual.mesh.position.x, y: visual.mesh.position.y, z: visual.mesh.position.z }, { count: 20 });
      playSettleCheer(visual);
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
          claimNurserySlot(visual);
        }
      });
    }),
    bus.subscribe('sprout:settled', (e) => {
      const visual = visuals.get(e.sproutId);
      if (!visual) return;
      releaseNurserySlot(visual); // defensive: automation dispatch releases at transportStarted already
      endRide(e.sproutId); // whatever the ride animation still had planned, the sim says it's home
      // Deterministic slot on the habitat's viewer-facing side so multiple
      // settled Sprouts neither overlap each other nor hide behind the
      // habitat's standee card — see sproutSettleOffset. The slot is claimed
      // once, here, and kept for the rest of the session.
      const alreadySettled = Array.from(visuals.values()).filter(
        (v) => v.settledHabitat === e.habitatId && v.id !== e.sproutId,
      ).length;
      visual.settledHabitat = e.habitatId;
      visual.settleIndex = alreadySettled;
      visual.mesh.isPickable = false;
      setState(visual, 'settled');
      if (alreadySettled >= SETTLE_VISIBLE_SLOTS) {
        // No standing room left: this arrival is counted on the habitat's
        // occupancy sign instead of being stacked on an earlier Sprout.
        tuckAway(visual, e.habitatId, alreadySettled + 1, capacityOf(e.habitatId));
      }
      refreshHabitat(e.habitatId, true);
    }),
    // Restored save: Sprouts alive when the game was saved never re-emit
    // `sprout:spawned`, so without this the garden comes back visually empty
    // (measured: 15 Sprout meshes before a reload, 1 after) even though the
    // simulation restored them correctly. Deliberately NOT done by replaying
    // `sprout:spawned` per Sprout, which would fire the pod-open SFX and
    // reveal animation for creatures the player met long ago; these are
    // placed already-arrived, in their final pose.
    bus.subscribe('save:loaded', (e) => {
      // Capacity FIRST, before any Sprout is placed: the crowd's packing and
      // every sign's meter are fractions of it, so restoring a save with
      // Habitat Capacity levels while still assuming the base 8 would lay the
      // garden out wrong and paint the signs against the wrong denominator.
      habitatCapacityLevel = e.snapshot.upgradeLevels?.habitatCapacity ?? 0;
      for (const restored of e.snapshot.sprouts ?? []) {
        if (visuals.get(restored.id)) continue;
        spawn(restored.id, restored.sproutType, restored.mood, 'restored');
        const visual = visuals.get(restored.id);
        if (!visual) continue;
        visual.mesh.scaling.set(1, 1, 1); // skip the reveal pop-in
        if (restored.settled && restored.habitatId) {
          visual.settledHabitat = restored.habitatId;
          visual.settleIndex = Array.from(visuals.values()).filter(
            (v) => v.settledHabitat === restored.habitatId && v.id !== restored.id,
          ).length;
          visual.mesh.isPickable = false;
          setState(visual, 'settled');
        } else {
          // `visual.tile` defaults to NURSERY_TILE at spawn — must be
          // corrected to the sim's real tile (e.g. a Sprout the sim restored
          // mid-ride, standing at the Colour Gate) BEFORE claimNurserySlot's
          // tile check below, or a Gate-parked Sprout would wrongly compete
          // for a Nursery waiting slot.
          visual.tile = restored.tile;
          setState(visual, 'idle');
          if (restored.tile.x === NURSERY_TILE.x && restored.tile.z === NURSERY_TILE.z) {
            claimNurserySlot(visual);
          } else {
            const world = tileToWorld(restored.tile);
            visual.mesh.position.set(world.x, SPROUT_FLOAT_HEIGHT, world.z);
          }
        }
      }
      // Positions and signs are resolved ONCE, after the whole batch: doing it
      // per restored Sprout would repaint each sign's canvas up to seventeen
      // times on load and lay the earlier arrivals out against a population
      // that had not finished restoring. `animate: false` so a reload hydrates
      // silently instead of replaying a celebration per habitat.
      refreshAllHabitats(false);
    }),
    // A capacity upgrade changes no Sprout's slot but does change how packed
    // every habitat looks and how full each meter reads — including clearing
    // the "full" cues on a habitat that just gained room.
    bus.subscribe('upgrade:purchased', (e) => {
      if (e.upgradeId !== 'habitatCapacity') return;
      habitatCapacityLevel = e.level;
      refreshAllHabitats(true);
    }),
    bus.subscribe('sprout:transportStarted', (e) => {
      const visual = visuals.get(e.sproutId);
      if (!visual) return;
      releaseNurserySlot(visual); // boarding — leaving the waiting pool
      // The sim picks whoever is idle & eligible regardless of whether the
      // renderer happened to have this one drawn — an "overflow" Sprout
      // (disabled mesh, past NURSERY_VISIBLE_SLOTS) can absolutely be the one
      // an automation boards next, and must become visible for its ride.
      visual.mesh.setEnabled(true);
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
        // SPROUT_RIDE_HEIGHT, not SPROUT_FLOAT_HEIGHT: a carried Sprout rides
        // low, close to the Slide/Gate's own belt, not at the taller height
        // reserved for standing/dragging near the Nursery mound.
        visual.mesh.position.y = SPROUT_RIDE_HEIGHT + Math.sin(t * Math.PI) * hop;
        if (t >= 1) endRide(e.sproutId);
      });
      rides.set(e.sproutId, { observer, toTile: e.toTile });
    }),
    bus.subscribe('sprout:transportCompleted', (e) => {
      const visual = visuals.get(e.sproutId);
      if (!visual) return;
      endRide(e.sproutId);
      setState(visual, 'idle');
      // No-ops for a habitat arrival (tile is already the habitat's, and
      // `sprout:settled` follows immediately in the same event batch) — only
      // takes effect for the Colour Gate's first leg, where the Sprout is
      // genuinely idle at a non-habitat tile. Never true for the Nursery
      // tile itself, since nothing rides FROM the Nursery TO the Nursery.
      claimNurserySlot(visual);
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
    // ALWAYS the normal, already-resolved material for the Sprout's current
    // state — the drag no longer swaps in a material of its own.
    //
    // WHY THAT CHANGED. Validity used to point the mesh at one of three
    // per-type "drag tint" materials built by createManifestMaterial, which
    // starts a material at a FLAT fallback colour with no texture and fills
    // the texture in from an async callback. A material with no baseTexture
    // has nothing for `_useAlphaFromAlbedoTexture` to read, so its alpha is a
    // solid 1 — and the Sprout became an opaque, fully saturated,
    // fallback-coloured RECTANGLE covering its own artwork. Reported by the
    // player twice: first as a "momentary square block when selecting
    // sprouts", then, once these materials were pre-warmed at spawn, as a
    // persistent cyan square while dragging over a habitat.
    //
    // Pre-warming was the wrong shape of fix — it only moved when the async
    // window opened. Reusing the state material removes the window entirely:
    // by the time a Sprout can be picked up it has been on screen for
    // seconds, so its material is textured and cannot flash anything.
    //
    // No information is lost. Drop validity was never carried by this tint
    // alone: habitats.ts's setHover already lights the target habitat and
    // scales it up for a valid drop and dims/shrinks it for an invalid one,
    // which is the larger, clearer signal and is where the player is looking.
    // What is kept here is a light touch on the Sprout itself so the held
    // creature still answers, via scale and opacity rather than colour — and
    // scale/opacity cannot depend on an unloaded texture.
    applyNormalMaterial(visual);
    if (valid === null) {
      visual.mesh.visibility = 1;
      visual.mesh.scaling.set(1, 1, 1);
      return;
    }
    visual.mesh.visibility = valid === false ? 0.72 : 1;
    const lift = valid === true ? 1.08 : 0.94;
    visual.mesh.scaling.set(lift, lift, 1);
  };

  /**
   * The Sprout's own half of the settle payoff: a squash-then-overshoot cheer.
   *
   * GameRules §5.3 lists a "Sprout happy animation" first among the things a
   * correct match must produce. Before this, `sprout:placed:correct` called
   * setState(visual, 'happy') and nothing else — and setState only points the
   * mesh at a different cached material. Worse, 'happy' is superseded by
   * 'settled' in the very same event batch, and applyNormalMaterial maps
   * 'settled' back to the SAME 'happy' texture. So the entire "happy
   * animation" was one still image replacing another still image, with no
   * motion whatsoever.
   *
   * The shape here is deliberately anticipation-then-overshoot rather than a
   * plain scale-up: a brief squash, a rebound past full size, then a settle
   * back. That is the readable "it's pleased" beat the promoted
   * creature-personality references land through pose and timing (see
   * docs/references/ooblets/creature-personality/) — expressed here as
   * original motion on this game's own billboard, not as any borrowed pose.
   *
   * Reduced motion (ambientIntensity 0) gets a much smaller, shorter version
   * rather than none: GameRules §11 asks for less movement, not for the
   * player to lose the confirmation that their action worked.
   */
  const playSettleCheer = (visual: SproutVisual): void => {
    const motion = lastMotion ?? getMotionConfig(prefersReducedMotion(), 'high');
    const reduced = motion.ambientIntensity <= 0;
    const amplitude = reduced ? 0.06 : 0.22;
    const durationMs = reduced ? 220 : 460;
    const start = performance.now();
    const observer = scene.onBeforeRenderObservable.add(() => {
      const t = Math.min(1, (performance.now() - start) / durationMs);
      // Squash under 20% of the beat, overshoot through the middle, ease home.
      const curve = t < 0.2 ? -(t / 0.2) : Math.sin(((t - 0.2) / 0.8) * Math.PI) * (1 - t * 0.35);
      const scale = 1 + amplitude * curve;
      // Squash and stretch are opposed on the two axes so the card keeps its
      // apparent volume instead of just getting bigger.
      visual.mesh.scaling.set(1 + amplitude * curve * 0.6, scale, 1);
      if (t >= 1) {
        scene.onBeforeRenderObservable.remove(observer);
        visual.mesh.scaling.set(1, 1, 1);
      }
    });
  };

  /**
   * Which surface this Sprout's shadow currently falls on. Derived from the
   * Sprout's own situation rather than tracked in a field, so it cannot drift
   * out of sync with the position logic: a settled Sprout stands on its
   * habitat's top face, a riding one on the automation plinth, a held one is
   * over open ground, and anything else is at the Nursery mound.
   */
  const shadowSurfaceY = (visual: SproutVisual): number => {
    if (visual.settledHabitat !== null && visual.state === 'settled') return habitatTopY(visual.settledHabitat);
    if (rides.has(visual.id)) return automationSiteTopY();
    if (visual.held) return 0;
    return nurseryTopY();
  };

  /**
   * Puts the contact shadow under the Sprout and scales/fades it by how far
   * the Sprout is above its surface. Called every frame for every visible
   * Sprout — cheap (a few arithmetic ops and two writes) and it has to be
   * per-frame, because the bob, the drag and the transport arc all move the
   * card without going through any single choke point that could update it.
   */
  const updateContactShadow = (visual: SproutVisual): void => {
    const surfaceY = shadowSurfaceY(visual);
    const lift = Math.max(0, visual.mesh.position.y - SPROUT_HALF_HEIGHT - surfaceY);
    const t = Math.min(1, lift / SHADOW_LIFT_RANGE);
    visual.shadow.setEnabled(true);
    visual.shadow.position.set(visual.mesh.position.x, surfaceY + SHADOW_SURFACE_LIFT, visual.mesh.position.z);
    // Wider and fainter the higher the Sprout is, tight and dark on contact.
    const spread = (1 + t * 0.55) * Math.max(0.01, visual.mesh.scaling.x);
    visual.shadow.scaling.set(spread, SHADOW_FORESHORTEN * spread, 1);
    visual.shadow.visibility = SHADOW_ALPHA_CONTACT + (SHADOW_ALPHA_LIFTED - SHADOW_ALPHA_CONTACT) * t;
  };

  const update = (motion: MotionConfig, nowMs: number): void => {
    lastMotion = motion;
    for (const visual of visuals.values()) {
      // Overflow Sprouts (past NURSERY_VISIBLE_SLOTS, mesh disabled) and
      // tucked-away habitat overflow arrivals are not on screen at all —
      // skip the bob math for them too, not just the draw. Cheap on its own,
      // but at a few hundred idle Sprouts in a crowded garden it is the
      // difference between this loop doing real work for the visible dozen
      // and doing it for the whole population every frame.
      if (!visual.mesh.isEnabled()) {
        visual.shadow.setEnabled(false);
        continue;
      }
      updateContactShadow(visual);
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
    for (const material of sharedSproutMaterials.values()) material.dispose();
    sharedSproutMaterials.clear();
    for (const material of sharedMoodBadgeMaterials.values()) material.dispose();
    sharedMoodBadgeMaterials.clear();
    shadowMaterial?.dispose();
    shadowMaterial = undefined;
    signs.dispose();
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
