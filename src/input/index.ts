// Pointer/touch input: single owner of every raw pointer/wheel event on the
// canvas, so there's exactly one place deciding "is this gesture a camera
// pan/pinch, or a Sprout drag" (src/render/camera.ts intentionally exposes
// only an imperative pan/zoom API, no listeners of its own — see its
// top-of-file comment). Also drives the automation build-menu ghost preview
// on behalf of Subagent F's UI (which owns the menu chrome itself).
//
// Outbound intent: per docs/CONTRACTS.md, `sprout:dropped { sproutId,
// overHabitat }` IS the "player attempted to place X here" event — there's
// no separate contract member for it, so this module emits that (plus
// `sprout:pickedUp` on drag start) directly onto the shared bus. See this
// session's report for why nothing currently adjudicates it into
// placed:correct/incorrect without src/render/gameplayStopgap.ts's DEV-only
// stand-in.

import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Plane } from '@babylonjs/core/Maths/math.plane';
// Side-effect import: without this, Scene.prototype.createPickingRay is a
// stub that throws — deep-imported Babylon modules don't auto-register this
// extension (see the equivalent gotcha documented in src/render/particles.ts
// for createDynamicTexture).
import '@babylonjs/core/Culling/ray';

import type { AutomationId, HabitatId } from '../core/ids';
import { HABITATS } from '../data/habitats';
import type { EventBus } from '../events/bus';
import type { RendererHandle } from '../render/index';
import { worldToTile, type TileCoord } from '../render/coords';
import { SPROUT_FLOAT_HEIGHT, SPROUT_SPRITE_SIZE } from '../render/sprouts';
// Render (and input) may import from sim — only sim may never import
// render/ui/audio/input. isValidAutomationSite is pure tile-graph logic
// (2026-08-01, manual placement — GameRules §9.8), reused here so the
// build-mode ghost preview and the actual placement commit ask the exact
// same question, rather than a second, potentially-diverging guess.
import { isValidAutomationSite } from '../sim/layout';

const GROUND_PLANE = new Plane(0, 1, 0, 0); // y = 0
// The horizontal plane a dragged Sprout is moved on. This has to be EXACTLY
// the height the renderer draws a held Sprout at, or the sprite renders offset
// from the cursor — so it is imported rather than mirrored as a literal (it
// was previously hard-coded as -0.8, which silently became wrong the moment
// SPROUT_FLOAT_HEIGHT was corrected to clear the Nursery mound).
const DRAG_HEIGHT_PLANE = new Plane(0, 1, 0, -SPROUT_FLOAT_HEIGHT);
// Forgiveness ADDED beyond a habitat's own visual footprint (see
// habitats.ts's nearestWithin) — GameRules §10 asks for "generous snapping
// ... no pixel-perfect placement". This used to be the WHOLE hit radius,
// checked by rounding the drop point to a tile and comparing Manhattan
// distance to the habitat's tile; that made the two larger habitats (visual
// radius ~1.37-1.39) miss drops well inside their own drawn edge, and
// overcounted diagonal offsets on top of that. Small now because the
// footprint itself already accounts for the drum's real size.
const HOVER_MARGIN_TILES = 0.35;
const PAN_SPEED = 0.0026;
const WHEEL_ZOOM_SENSITIVITY = 0.01;
const PINCH_ZOOM_SENSITIVITY = 1;

export interface InputHooks {
  /**
   * Player committed a placement in build mode on a tile that passed
   * `isValidAutomationSite` (2026-08-01, GameRules §9.8). No CONTRACTS.md
   * event exists for player intent (docs/CONTRACTS.md's GameEvent union is
   * sim-originated announcements only) — same "plain function the runtime
   * exposes" pattern as onPurchaseUpgrade/onSetColourGateLane in main.ts.
   */
  onPlaceAutomation?: (automationId: AutomationId, tile: TileCoord) => void;
}

export interface InputHandle {
  /** Screen point -> tile, for Subagent F's build menu to track where a ghost preview should appear. Null if the ray doesn't hit the ground plane (shouldn't normally happen with this camera). */
  screenToTile: (clientX: number, clientY: number) => TileCoord | null;
  previewAutomation: (automationId: AutomationId, tile: TileCoord) => void;
  clearAutomationPreview: () => void;
  /**
   * Enters build mode for `automationId`: subsequent pointer movement shows
   * the ghost preview (valid/invalid per `isValidAutomationSite`) instead of
   * panning, and a tap/click on a valid tile commits the placement via
   * `onPlaceAutomation` and exits build mode. Mutually exclusive with
   * dragging a Sprout — entering build mode cancels any drag in progress.
   */
  enterBuildMode: (automationId: AutomationId) => void;
  /** Exits build mode (if active) and clears the ghost preview. Safe to call when not in build mode. */
  exitBuildMode: () => void;
  dispose: () => void;
}

interface PointerState {
  x: number;
  y: number;
}

export function initInput(renderer: RendererHandle, bus: EventBus, hooks: InputHooks = {}): InputHandle {
  const { scene, canvas, camera, habitats, sprouts, automation } = renderer;

  canvas.style.touchAction = 'none';

  const activePointers = new Map<number, PointerState>();
  let dragSproutId: string | null = null;
  let dragPointerId: number | null = null;
  let panPointerId: number | null = null;
  let pinching = false;
  let pinchStartDistance = 0;
  let pinchStartRadius = 0;
  let buildModeAutomationId: AutomationId | null = null;
  // Every PLACED automation's own site tile, tracked locally so build-mode
  // hit-testing (isValidAutomationSite needs "what's already occupied")
  // doesn't require reaching into SimState — this module only ever talks to
  // sim over the bus/hooks, never by reading it directly.
  const occupiedSiteTiles = new Map<AutomationId, TileCoord>();
  bus.subscribe('automation:built', (e) => occupiedSiteTiles.set(e.automationId, e.siteTile));
  bus.subscribe('save:loaded', (e) => {
    for (const [id, tile] of Object.entries(e.snapshot.automationSites ?? {}) as [AutomationId, TileCoord][]) {
      occupiedSiteTiles.set(id, tile);
    }
  });

  const canvasPoint = (event: PointerEvent): { x: number; y: number } => {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const groundPointAt = (x: number, y: number, plane: Plane): { x: number; z: number } | null => {
    const ray = scene.createPickingRay(x, y, Matrix.Identity(), camera.camera);
    const distance = ray.intersectsPlane(plane);
    console.debug(
      '[terrarium/debug ray] ' +
        JSON.stringify({
          x,
          y,
          rayOrigin: ray.origin.asArray(),
          rayDir: ray.direction.asArray(),
          camPos: camera.camera.position.asArray(),
          camTarget: camera.camera.target.asArray(),
          renderW: scene.getEngine().getRenderWidth(),
          renderH: scene.getEngine().getRenderHeight(),
          canvasClientW: canvas.clientWidth,
          canvasClientH: canvas.clientHeight,
          distance,
        }),
    );
    if (distance === null) return null;
    const point = ray.origin.add(ray.direction.scale(distance));
    return { x: point.x, z: point.z };
  };

  // Sprout sprites are thin BILLBOARDMODE_Y planes — `scene.pick`'s
  // triangle-intersection test against a billboarded mesh's world matrix
  // turned out unreliable in manual QA (the ray consistently sailed past the
  // plane and hit the ground behind it instead, even dead-center on the
  // visible sprite). Instead: cast the ray against the same fixed height
  // plane Sprouts float at (SPROUT_FLOAT_HEIGHT, mirrored here as
  // DRAG_HEIGHT_PLANE) and pick whichever live Sprout's XZ position is
  // closest to that point, within a generous radius — simpler, and more
  // forgiving for touch besides.
  // Kept in step with the sprite's own half-width (SPROUT_SPRITE_SIZE / 2,
  // 0.475 as of the 2026-08-01 size pass) plus a deliberate forgiveness
  // margin, rather than being an independent magic number. It was 0.55
  // against a 0.70 sprite; when the sprite grew, a stale 0.55 would have made
  // the hitbox SMALLER than the visible creature, which is the worst possible
  // mismatch — the player aims at art that is not clickable and the miss
  // falls through to a camera pan (work_progress.yaml
  // `missed-pick-falls-through-to-pan`, reproduced in the before-capture for
  // this pass).
  const SPROUT_PICK_RADIUS = SPROUT_SPRITE_SIZE / 2 + 0.22;

  const pickSproutId = (x: number, y: number): string | null => {
    const ground = groundPointAt(x, y, DRAG_HEIGHT_PLANE);
    if (!ground) return null;
    let closestId: string | null = null;
    let closestDist = SPROUT_PICK_RADIUS;
    const all = sprouts.all().map((v) => ({
      id: v.id,
      pos: { x: v.mesh.position.x, z: v.mesh.position.z },
      dist: Math.hypot(v.mesh.position.x - ground.x, v.mesh.position.z - ground.z),
    }));
    console.debug('[terrarium/debug pick] ' + JSON.stringify({ x, y, ground, all }));
    for (const visual of sprouts.all()) {
      // A crowded Nursery only draws a bounded number of waiting Sprouts at
      // once (src/render/sprouts.ts's NURSERY_VISIBLE_SLOTS) — the rest have
      // a disabled mesh sitting wherever it last was, invisible to the
      // player, and must not be pickable either or a drag could grab a
      // Sprout nobody can see.
      if (visual.held || visual.state === 'settled' || !visual.mesh.isEnabled()) continue;
      const dist = Math.hypot(visual.mesh.position.x - ground.x, visual.mesh.position.z - ground.z);
      if (dist < closestDist) {
        closestDist = dist;
        closestId = visual.id;
      }
    }
    return closestId;
  };

  const habitatMatch = (habitatId: HabitatId | null, sproutId: string | null): boolean | null => {
    if (!habitatId || !sproutId) return null;
    const visual = sprouts.get(sproutId);
    if (!visual) return null;
    return HABITATS[habitatId].matchSproutType === visual.sproutType;
  };

  const endDrag = (x: number, y: number): void => {
    if (!dragSproutId) return;
    const ground = groundPointAt(x, y, GROUND_PLANE);
    const overHabitat = ground ? habitats.nearestWithin(ground, HOVER_MARGIN_TILES) : null;
    // A drop lands on at most one of the two: a habitat is checked first
    // (unchanged behaviour), and only when it isn't one is a built
    // automation site considered — handing a Sprout straight to the Garden
    // Slide or Colour Gate rather than waiting for the helper to notice one
    // on its own (GameRules §9.1). The site tiles and habitat tiles sit far
    // enough apart in the garden's layout that the two regions never
    // actually overlap; the ordering is just belt-and-braces.
    const overAutomation = !overHabitat && ground ? automation.nearestBuiltWithin(ground, HOVER_MARGIN_TILES) : null;
    bus.emit({ type: 'sprout:dropped', sproutId: dragSproutId, overHabitat, overAutomation });
    habitats.setHover(null, null);
    sprouts.setDragValidity(dragSproutId, null);
    dragSproutId = null;
    dragPointerId = null;
  };

  const handlePointerDown = (event: PointerEvent): void => {
    const { x, y } = canvasPoint(event);
    console.debug('[terrarium/debug pointerdown] ' + JSON.stringify({ x, y, activeBefore: activePointers.size }));
    activePointers.set(event.pointerId, { x, y });
    canvas.setPointerCapture(event.pointerId);

    if (buildModeAutomationId) {
      const ground = groundPointAt(x, y, GROUND_PLANE);
      const tile = ground ? worldToTile(ground) : null;
      const automationId = buildModeAutomationId;
      const valid = tile ? isValidAutomationSite(automationId, tile, Array.from(occupiedSiteTiles.values())) : false;
      console.debug(
        '[terrarium/debug buildmode commit] ' +
          JSON.stringify({ automationId, ground, tile, valid, occupied: Array.from(occupiedSiteTiles.entries()) }),
      );
      if (tile && valid) {
        hooks.onPlaceAutomation?.(automationId, tile);
        exitBuildMode();
      }
      // Invalid tile: stay in build mode (the red-tinted ghost preview
      // already told the player why) rather than silently exiting — a tap
      // that missed should be a free retry, not a lost gesture.
      return;
    }

    if (activePointers.size === 2 && dragSproutId === null) {
      const pts = Array.from(activePointers.values());
      pinching = true;
      panPointerId = null;
      pinchStartDistance = distanceBetween(pts[0], pts[1]);
      pinchStartRadius = camera.camera.radius;
      return;
    }

    if (activePointers.size === 1) {
      const sproutId = pickSproutId(x, y);
      if (sproutId) {
        const visual = sprouts.get(sproutId);
        if (visual && !visual.held && visual.state !== 'settled') {
          dragSproutId = sproutId;
          dragPointerId = event.pointerId;
          visual.held = true;
          bus.emit({ type: 'sprout:pickedUp', sproutId });
          const ground = groundPointAt(x, y, DRAG_HEIGHT_PLANE);
          if (ground) sprouts.setDragPosition(sproutId, ground.x, ground.z);
          return;
        }
      }
      panPointerId = event.pointerId;
    }
  };

  const handlePointerMove = (event: PointerEvent): void => {
    if (buildModeAutomationId) {
      // Deliberately NOT gated on activePointers.has(...): unlike a drag,
      // build-mode preview must track a plain hover with no button held —
      // that's how a mouse player sees the ghost before ever clicking.
      const { x, y } = canvasPoint(event);
      const ground = groundPointAt(x, y, GROUND_PLANE);
      const tile = ground ? worldToTile(ground) : null;
      if (tile) previewAutomation(buildModeAutomationId, tile);
      return;
    }

    if (!activePointers.has(event.pointerId)) return;
    const { x, y } = canvasPoint(event);
    activePointers.set(event.pointerId, { x, y });

    if (pinching && activePointers.size >= 2) {
      const pts = Array.from(activePointers.values()).slice(0, 2);
      const distance = distanceBetween(pts[0], pts[1]);
      if (distance > 0 && pinchStartDistance > 0) {
        const scale = distance / pinchStartDistance;
        camera.setRadius(pinchStartRadius / Math.max(0.05, scale) ** PINCH_ZOOM_SENSITIVITY);
      }
      return;
    }

    if (dragSproutId && event.pointerId === dragPointerId) {
      const dragHeightPoint = groundPointAt(x, y, DRAG_HEIGHT_PLANE);
      if (!dragHeightPoint) return;
      sprouts.setDragPosition(dragSproutId, dragHeightPoint.x, dragHeightPoint.z);
      // Hover hit-testing must use the SAME plane endDrag will use on
      // pointerup (GROUND_PLANE), not the drag-height plane the held sprite
      // renders on — those two projections of the same screen pixel are
      // ~2.1 world units apart at the default camera (see
      // drag-height-plane-vs-ground-plane in work_progress.yaml). Feeding
      // the drag-height point to nearestWithin/nearestBuiltWithin made the
      // highlighted habitat disagree with what endDrag actually resolves:
      // a habitat could highlight while the cursor visually sat elsewhere,
      // or fail to highlight with the cursor dead-center on it, and a drop
      // that looked valid during hover would decline and snap back to the
      // Nursery on release.
      const ground = groundPointAt(x, y, GROUND_PLANE);
      if (!ground) return;
      const habitatId = habitats.nearestWithin(ground, HOVER_MARGIN_TILES);
      if (habitatId) {
        const valid = habitatMatch(habitatId, dragSproutId);
        habitats.setHover(habitatId, valid);
        sprouts.setDragValidity(dragSproutId, valid);
        return;
      }
      habitats.setHover(null, null);
      // Not over a habitat — check a built automation site the same way, so
      // the held Sprout tints valid/invalid while hovering the Garden Slide
      // or Colour Gate too, not only while hovering a home.
      const automationId = automation.nearestBuiltWithin(ground, HOVER_MARGIN_TILES);
      const visual = sprouts.get(dragSproutId);
      const automationValid =
        automationId && visual ? automation.matchesSprout(automationId, visual.sproutType, visual.mood) : null;
      sprouts.setDragValidity(dragSproutId, automationId ? automationValid : null);
      return;
    }

    if (panPointerId !== null && event.pointerId === panPointerId) {
      const prev = lastPanPoint;
      if (prev) {
        const dx = x - prev.x;
        const dy = y - prev.y;
        const right = camera.camera.getDirection(Vector3.Right());
        const forward = camera.camera.getDirection(Vector3.Forward());
        const rightGround = normalizeGround(right.x, right.z);
        const forwardGround = normalizeGround(forward.x, forward.z);
        const speed = PAN_SPEED * camera.camera.radius;
        camera.panBy(
          -(rightGround.x * dx + forwardGround.x * dy) * speed,
          -(rightGround.z * dx + forwardGround.z * dy) * speed,
        );
      }
      lastPanPoint = { x, y };
    }
  };

  let lastPanPoint: PointerState | null = null;

  const handlePointerUp = (event: PointerEvent): void => {
    const { x, y } = canvasPoint(event);
    if (dragSproutId && event.pointerId === dragPointerId) {
      endDrag(x, y);
    }
    if (panPointerId === event.pointerId) {
      panPointerId = null;
      lastPanPoint = null;
    }
    activePointers.delete(event.pointerId);
    if (activePointers.size < 2) pinching = false;
    if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture(event.pointerId);

    // If a pointer remains after ending a pinch/drag, let it resume panning.
    if (activePointers.size === 1 && !dragSproutId && !pinching) {
      const [[id, pt]] = Array.from(activePointers.entries());
      panPointerId = id;
      lastPanPoint = pt;
    }
  };

  const handleWheel = (event: WheelEvent): void => {
    event.preventDefault();
    camera.zoomBy(-event.deltaY * WHEEL_ZOOM_SENSITIVITY);
  };

  canvas.addEventListener('pointerdown', handlePointerDown);
  canvas.addEventListener('pointermove', handlePointerMove);
  canvas.addEventListener('pointerup', handlePointerUp);
  canvas.addEventListener('pointercancel', handlePointerUp);
  canvas.addEventListener('wheel', handleWheel, { passive: false });

  const screenToTile = (clientX: number, clientY: number): TileCoord | null => {
    const rect = canvas.getBoundingClientRect();
    const ground = groundPointAt(clientX - rect.left, clientY - rect.top, GROUND_PLANE);
    return ground ? worldToTile(ground) : null;
  };

  const previewAutomation = (automationId: AutomationId, tile: TileCoord): void => {
    automation.previewAt(automationId, tile, isValidAutomationSite(automationId, tile, Array.from(occupiedSiteTiles.values())));
  };

  const enterBuildMode = (automationId: AutomationId): void => {
    // One interaction mode at a time — same discipline pinch/drag/pan
    // already follow in handlePointerDown below.
    if (dragSproutId) {
      sprouts.setDragValidity(dragSproutId, null);
      const visual = sprouts.get(dragSproutId);
      if (visual) visual.held = false;
      dragSproutId = null;
      dragPointerId = null;
    }
    buildModeAutomationId = automationId;
  };

  const exitBuildMode = (): void => {
    buildModeAutomationId = null;
    automation.clearPreview();
  };

  const dispose = (): void => {
    canvas.removeEventListener('pointerdown', handlePointerDown);
    canvas.removeEventListener('pointermove', handlePointerMove);
    canvas.removeEventListener('pointerup', handlePointerUp);
    canvas.removeEventListener('pointercancel', handlePointerUp);
    canvas.removeEventListener('wheel', handleWheel);
  };

  return {
    screenToTile,
    previewAutomation,
    clearAutomationPreview: automation.clearPreview,
    enterBuildMode,
    exitBuildMode,
    dispose,
  };
}

function distanceBetween(a: PointerState, b: PointerState): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function normalizeGround(x: number, z: number): { x: number; z: number } {
  const len = Math.hypot(x, z) || 1;
  return { x: x / len, z: z / len };
}
