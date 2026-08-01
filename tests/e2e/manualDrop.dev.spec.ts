import { expect, test, type Page } from '@playwright/test';
import {
  buyUpgradeViaUI,
  collectConsoleErrors,
  emitDropped,
  getRecordedEvents,
  getUiState,
  grantDewdrops,
  HABITAT_TILES,
  installBusRecorder,
  projectToScreen,
  waitForDevHooks,
} from './helpers';
// Safe to import: src/render/layout.ts pulls in only src/sim/grid + src/sim/layout,
// no Babylon deep specifiers (see the header of ./helpers.ts).
import { GARDEN_SLIDE_TILE, NURSERY_TILE } from '../../src/render/layout';
import { UPGRADES } from '../../src/data/upgrades';
import type { GameEvent } from '../../src/events';
import type { SproutTypeId } from '../../src/core/ids';

// Manual drag-and-drop onto a BUILT automation structure (GameRules §9.1) via
// REAL pointer events — the one path the a98b552 work left verified only at
// bus level (see work_progress.yaml: manual-drag-onto-slide-not-pointer-tested).
// The adjudication logic itself is pinned by 10 unit tests; what these specs
// add is the pointer path: canvas pointerdown picking the right Sprout,
// groundPointAt resolving the drop point, automation.nearestBuiltWithin's
// footprint hitbox recognising the Slide, and sprout:dropped leaving endDrag
// with overAutomation set.
//
// TWO SOURCES OF INTERFERENCE these specs are written around:
//
//   1. The Nursery pod spawns Sprouts on its own the whole time the setup is
//      running. Idle Ember Sprouts at the Nursery are exactly what the built
//      Slide's tick dispatcher (planRide in src/sim/systems.ts) takes every
//      100ms tick, so the Slide is busy for ~3.4s after each natural ember —
//      and a manual drop during that window declines 'busy', not whatever the
//      drop was meant to prove. The happy-path spec DRAINS natural spawns
//      into their habitats (bus fast path) before every attempt; both specs
//      retry through any residual 'busy' window.
//
//   2. A freshly spawned matching Sprout sitting idle at the Nursery is
//      itself dispatch fodder: the Slide can legitimately board the test
//      Sprout mid-drag. That is the game working as designed, not a pointer
//      bug, so the happy-path spec discriminates by TIMING and retries rather
//      than asserting on the transportStarted payload alone: bus.emit is
//      synchronous and runtime.ts adjudicates sprout:dropped in the same
//      task, so a MANUAL drop's transportStarted fires inside the pointerup
//      dispatch itself, while a dispatcher boarding fires on a
//      requestAnimationFrame tick — a different task. A capture-phase
//      pointerup listener on `window` (runs before the canvas's at-target
//      handlers) stamps each pointerup; an event recorded with the flag
//      already set AND within a few ms of that stamp can only have come from
//      the drop. Anything else is a lost race: wait for the Slide to finish
//      the ride it stole and try again with a fresh Sprout.
//
// Both specs also pick the Sprout by its LIVE mesh position rather than the
// Nursery centre: waiting Sprouts stand on deterministic slots AROUND the
// mound, so projecting the mound's centre grabs whichever Sprout happens to
// be nearest, not necessarily the one just spawned.

// Serial on purpose: the decline spec proves pointer picking works at all,
// which is what licenses reading "no event at pointerup" in the boarding spec
// as a lost dispatcher race rather than a broken pick — and it keeps two
// Babylon scenes from contending for one CPU (a parallel run once starved a
// page badly enough for page.evaluate to outlast the whole test timeout).
test.describe.configure({ mode: 'serial' });

declare global {
  interface Window {
    /** Set by installTimedRecorder(): performance.now() of the most recent pointerup, and whether one has fired since the last reset. */
    __ttUpAt?: number;
    __ttUpFired?: boolean;
    /** Timestamped event log installed by installTimedRecorder(). */
    __ttTimed?: Array<GameEvent & { at: number; upFired: boolean }>;
    /** Every sprout:spawned (id + type), installed by installSpawnLog(). Unlike __ttSpawnedIds nothing pops this, and it records natural pod spawns too. */
    __ttSpawnLog?: Array<{ id: string; type: SproutTypeId }>;
  }
}

const SLIDE_MESH_PREFIX = 'terrarium.sprout.';

/** Records transportStarted/Completed/Declined/settled with a page-side timestamp and whether a pointerup had already fired at record time. */
async function installTimedRecorder(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.__ttTimed = [];
    window.__ttUpFired = false;
    window.__ttUpAt = 0;
    // Capture phase on window: runs before the canvas's own pointerup handler
    // regardless of registration order, so the flag is already set when the
    // app's endDrag -> bus.emit -> this recorder chain runs in the same task.
    window.addEventListener(
      'pointerup',
      () => {
        window.__ttUpFired = true;
        window.__ttUpAt = performance.now();
      },
      true,
    );
    const bus = window.__terrariumUIF!.bus;
    for (const type of [
      'sprout:transportStarted',
      'sprout:transportCompleted',
      'sprout:automationDeclined',
      'sprout:settled',
    ] as const) {
      bus.subscribe(type, (e) => window.__ttTimed!.push({ at: performance.now(), upFired: Boolean(window.__ttUpFired), ...e }));
    }
  });
}

async function getTimedEvents(page: Page): Promise<Array<GameEvent & { at: number; upFired: boolean }>> {
  return page.evaluate(() => window.__ttTimed ?? []);
}

/** Records every sprout:spawned with its type, so natural pod spawns can be told apart from debug spawns and drained into habitats. */
async function installSpawnLog(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.__ttSpawnLog = [];
    window.__terrariumUIF!.bus.subscribe('sprout:spawned', (e) => window.__ttSpawnLog!.push({ id: e.sproutId, type: e.sproutType }));
  });
}

/**
 * Spawns via the debug panel's DOM button and returns the new Sprout's id.
 * A DOM click (not page.click) keeps the mouse parked wherever the caller put
 * it, and the id is filtered by the debug-sprout- prefix because natural pod
 * spawns land in the same log and would otherwise be mistaken for ours. The
 * spawn runs in a .then microtask that has drained by the time the evaluate
 * resolves, so the returned id's mesh exists immediately after.
 */
async function debugSpawnViaDom(page: Page, sproutType: SproutTypeId): Promise<string> {
  const before = new Set(await page.evaluate(() => (window.__ttSpawnLog ?? []).map((s) => s.id)));
  await page.evaluate((t) => {
    (document.querySelector(`[data-testid="debug-spawn-${t}"]`) as HTMLButtonElement).click();
  }, sproutType);
  const fresh = await page.evaluate(
    ([seen]) => (window.__ttSpawnLog ?? []).filter((s) => s.id.startsWith('debug-sprout-') && !(seen as string[]).includes(s.id)),
    [Array.from(before)],
  );
  expect(fresh.length, 'exactly one debug Sprout should have spawned').toBe(1);
  return fresh[0].id;
}

/** Screen point of a Sprout's live mesh centre — the reliable pickup point, wherever its waiting-slot offset has put it. One evaluate: meshInfo + __debug.project + CSS-pixel scaling. */
async function sproutScreenPoint(page: Page, sproutId: string): Promise<{ x: number; y: number }> {
  const point = await page.evaluate((meshName) => {
    const debug = window.__debug as unknown as {
      meshInfo: (n: string) => { pos: number[]; enabled: boolean } | null | undefined;
      project: (x: number, y: number, z: number) => [number, number, number];
    };
    const info = debug.meshInfo(meshName);
    if (!info) return null;
    const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();
    const projected = debug.project(info.pos[0], info.pos[1], info.pos[2]);
    return { x: rect.left + projected[0] * (rect.width / canvas.width), y: rect.top + projected[1] * (rect.height / canvas.height) };
  }, `${SLIDE_MESH_PREFIX}${sproutId}`);
  expect(point, `mesh for ${sproutId} should exist`).not.toBeNull();
  return point!;
}

/** World XZ of a Sprout's live mesh, or null if the mesh is gone. */
async function sproutWorldXZ(page: Page, sproutId: string): Promise<{ x: number; z: number; enabled: boolean } | null> {
  return page.evaluate((meshName) => {
    const debug = window.__debug as unknown as {
      meshInfo: (n: string) => { pos: number[]; enabled: boolean } | null | undefined;
    };
    const info = debug.meshInfo(meshName);
    return info ? { x: info.pos[0], z: info.pos[2], enabled: info.enabled } : null;
  }, `${SLIDE_MESH_PREFIX}${sproutId}`);
}

/** Grants until `target` Dewdrops are affordable (derived from the price table so a rebalance can't quietly starve it). */
async function grantUntilAffordable(page: Page, target: number): Promise<void> {
  for (let i = 0; i < 40; i += 1) {
    if ((await getUiState(page)).dewdropTotal >= target) return;
    await grantDewdrops(page, 1);
  }
  throw new Error(`could not reach ${target} Dewdrops via the debug grant button`);
}

/** Buys Habitat Capacity up to `level` via the real Upgrades panel, one level at a time. */
async function buyHabitatCapacityTo(page: Page, level: 1 | 2 | 3): Promise<void> {
  for (let next = 1; next <= level; next += 1) {
    await grantUntilAffordable(page, UPGRADES.habitatCapacity.costForLevel(next));
    await buyUpgradeViaUI(page, 'Habitat Capacity');
    await expect.poll(async () => (await getUiState(page)).upgradeLevels.habitatCapacity).toBe(next);
  }
}

/** spawnAndDrop via this file's own prefix-filtered debug spawn (predates helpers.ts's popLastSpawnedId being fixed 2026-08-01 to filter on podId==='debug' instead of blindly popping the last recorded id — either approach is now race-safe against a natural pod spawn landing mid-setup). */
async function debugSpawnAndDrop(page: Page, sproutType: SproutTypeId, habitat: 'emberNook' | 'dewPond' | 'sunflowerMeadow'): Promise<void> {
  const id = await debugSpawnViaDom(page, sproutType);
  await emitDropped(page, id, habitat);
}

/**
 * Drives the real unlock path to a built Garden Slide. The Slide always
 * targets Sunflower Meadow once built (unlockSystem, src/sim/systems.ts —
 * the earlier "whichever habitat has been fed most" heuristic this helper's
 * ember-heavy feed mix was originally written for no longer decides the
 * target, only the total placement count matters for the unlock threshold).
 * `capacityLevel` controls how much headroom Sunflower Meadow keeps: the
 * boarding spec wants several free slots because every race the dispatcher
 * steals ends with one more Sprout settled there.
 */
async function buildGardenSlide(page: Page, capacityLevel: 1 | 2 | 3): Promise<void> {
  await buyHabitatCapacityTo(page, capacityLevel);
  for (let i = 0; i < 8; i += 1) await debugSpawnAndDrop(page, 'ember', 'emberNook');
  for (let i = 0; i < 6; i += 1) await debugSpawnAndDrop(page, 'dew', 'dewPond');
  for (let i = 0; i < 6; i += 1) await debugSpawnAndDrop(page, 'sun', 'sunflowerMeadow');
  await expect.poll(async () => (await getUiState(page)).unlockedAutomations, { timeout: 20_000 }).toContain('gardenSlide');
}

const TYPE_TO_HABITAT = { ember: 'emberNook', dew: 'dewPond', sun: 'sunflowerMeadow', star: 'emberNook' } as const;

/**
 * Settles every naturally pod-spawned Sprout into its matching habitat via the
 * bus fast path, so the Slide's dispatcher has nothing to grab between
 * attempts. Debug-spawned Sprouts are skipped (the test owns those).
 * Adjudication ignores Sprouts that are already riding/settled, so re-dropping
 * an already-placed one is a harmless no-op.
 */
async function drainNaturalSpawns(page: Page): Promise<void> {
  const log = await page.evaluate(() => window.__ttSpawnLog ?? []);
  for (const s of log) {
    if (s.id.startsWith('debug-sprout-')) continue;
    await emitDropped(page, s.id, TYPE_TO_HABITAT[s.type]);
  }
}

/** Waits until the Garden Slide has no ride in flight (every start has its completion). */
async function waitForSlideIdle(page: Page): Promise<void> {
  await expect
    .poll(
      async () => {
        const events = await getTimedEvents(page);
        const started = events.filter((e) => e.type === 'sprout:transportStarted' && e.automationId === 'gardenSlide').length;
        const completed = events.filter((e) => e.type === 'sprout:transportCompleted' && e.automationId === 'gardenSlide').length;
        return started === completed;
      },
      { timeout: 15_000 },
    )
    .toBe(true);
}

test.describe('Manual drop onto automation: real pointer events', () => {
  test('dragging a wrong-kind Sprout onto the Garden Slide declines it and leaves it standing where it was dropped', async ({ page }) => {
    test.setTimeout(180_000); // real purchase + 20 spawn+drop round-trips to build the Slide
    const console_ = collectConsoleErrors(page);
    await page.goto('/');
    await waitForDevHooks(page);
    await installBusRecorder(page);
    await installSpawnLog(page);
    await installTimedRecorder(page);

    await buildGardenSlide(page, 1);

    // The Slide always serves Sunflower Meadow once built, so a Dew Sprout is
    // the wrong kind — and its dispatcher never takes dew, which is what
    // makes the decline itself attributable to the pointer drop alone. The
    // only residual interference is a natural sun spawn making the Slide
    // 'busy' at the moment of the drop, so the drop is retried through any
    // busy window.
    const sproutId = await debugSpawnViaDom(page, 'dew');
    const slidePoint = await projectToScreen(page, { x: GARDEN_SLIDE_TILE.x, y: 0, z: GARDEN_SLIDE_TILE.z });

    let reason: string | null = null;
    for (let attempt = 0; attempt < 6 && reason !== 'wrongKind'; attempt += 1) {
      await waitForSlideIdle(page);
      const from = await sproutScreenPoint(page, sproutId);
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(slidePoint.x, slidePoint.y);
      await page.mouse.up();
      await page.waitForTimeout(150); // let the (synchronous) decline land in the log
      const decline = (await getTimedEvents(page)).find((e) => e.type === 'sprout:automationDeclined' && e.sproutId === sproutId);
      if (decline && decline.type === 'sprout:automationDeclined') reason = decline.reason;
      // 'busy' (or a crowded-nursery mis-pick — waiting slots sit 0.5 apart,
      // inside the 0.55 pick radius): the Sprout stayed idle — wait out the
      // ride and try again.
    }

    expect(reason, 'the drop should have been declined as the wrong kind for this Slide').toBe('wrongKind');

    const events = await getTimedEvents(page);
    // A declined drop changes nothing: no ride started for this Sprout...
    expect(events.some((e) => e.type === 'sprout:transportStarted' && e.sproutId === sproutId)).toBe(false);
    expect(events.some((e) => e.type === 'sprout:settled' && e.sproutId === sproutId)).toBe(false);
    // ...and it stays available exactly where it was dropped (GameRules §5.3's
    // "remains available to move" half — automationDeclined deliberately has
    // no walk-back). "Where it was dropped" is the pointer's DRAG-HEIGHT
    // plane position, which sits noticeably closer to the camera than the
    // Slide's ground point at this camera angle (~2.1 world units at the
    // default framing, measured) — so assert loosely: enabled (visible and
    // pickable), and in the Slide's neighbourhood rather than back at the
    // Nursery or anywhere else.
    const probe = await sproutWorldXZ(page, sproutId);
    expect(probe, 'the declined Sprout should still have a live mesh').not.toBeNull();
    expect(probe?.enabled, 'a declined Sprout stays visible and pickable').toBe(true);
    expect(Math.hypot(probe!.x - GARDEN_SLIDE_TILE.x, probe!.z - GARDEN_SLIDE_TILE.z)).toBeLessThan(3);

    console_.assertNone();
  });

  test('dragging a matching Sprout onto the Garden Slide boards it on the next ride', async ({ page }) => {
    test.setTimeout(300_000); // capacity x3 purchases + 20 spawn+drop round-trips to build the Slide
    const console_ = collectConsoleErrors(page);
    await page.goto('/');
    await waitForDevHooks(page);
    await installBusRecorder(page);
    await installSpawnLog(page);
    await installTimedRecorder(page);

    // Capacity 3 => 15 slots per habitat, so Sunflower Meadow (the Slide's
    // always-on target) has room to deliver into.
    await buildGardenSlide(page, 3);

    // Nothing idle at the Nursery but the Sprout this test is about to spawn.
    await drainNaturalSpawns(page);
    await waitForSlideIdle(page);
    await page.evaluate(() => {
      window.__ttUpFired = false;
      window.__ttUpAt = 0;
    });

    // The whole drag happens inside ONE page.evaluate, i.e. one JS task:
    //   1. DOM-click the spawn button, then `await Promise.resolve()` — the
    //      panel's simRuntimePromise.then(spawn) is a microtask, and rAF
    //      (where the Slide's tick dispatcher lives) cannot fire while the
    //      microtask queue is draining, so the Sprout + its mesh exist by
    //      the continuation and the dispatcher has had no chance to take it.
    //   2. Dispatch pointerdown/move/up as synthetic PointerEvents on the
    //      canvas. They run the app's real handlers (pickSproutId,
    //      groundPointAt, endDrag, nearestBuiltWithin, bus.emit,
    //      adjudication) synchronously — again with no tick able to
    //      interleave. Measured necessity: with real CDP mouse input the
    //      dispatcher won 7 out of 7 races (spawn→pointerup is several CDP
    //      round trips, several 100ms ticks). The CDP-level delivery half of
    //      the pointer path is covered by the decline spec above instead,
    //      which is race-free because the dispatcher never takes dew.
    // setPointerCapture/hasPointerCapture are stubbed: a synthetic pointerId
    // has no active pointer to capture and the real call would throw.
    const sproutId = await page.evaluate(() => {
      const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
      canvas.setPointerCapture = () => {};
      canvas.hasPointerCapture = () => false;

      const toClient = (wx: number, wy: number, wz: number): { x: number; y: number } => {
        const rect = canvas.getBoundingClientRect();
        const projected = window.__debug!.project(wx, wy, wz);
        return { x: rect.left + projected[0] * (rect.width / canvas.width), y: rect.top + projected[1] * (rect.height / canvas.height) };
      };
      const fire = (type: string, at: { x: number; y: number }): void => {
        canvas.dispatchEvent(
          new PointerEvent(type, { pointerId: 7, isPrimary: true, bubbles: true, button: 0, buttons: 1, clientX: at.x, clientY: at.y }),
        );
      };

      const before = new Set((window.__ttSpawnLog ?? []).map((s) => s.id));
      (document.querySelector('[data-testid="debug-spawn-sun"]') as HTMLButtonElement).click();
      return Promise.resolve().then(() => {
        const fresh = (window.__ttSpawnLog ?? []).filter((s) => s.id.startsWith('debug-sprout-') && !before.has(s.id));
        if (fresh.length !== 1) throw new Error(`expected exactly one new debug Sprout, got ${fresh.length}`);
        const id = fresh[0].id;
        // The mesh spawns at the Nursery's centre (its waiting slot is only
        // claimed after the rAF-driven reveal, which has not run yet — same
        // single-task argument as above).
        fire('pointerdown', toClient(8, 1.13, 8));
        fire('pointermove', toClient(8, 0, 7)); // the Slide's ground point
        fire('pointerup', toClient(8, 0, 7));
        return id;
      });
    });

    const events = await getTimedEvents(page);
    const started = events.find((e) => e.type === 'sprout:transportStarted' && e.sproutId === sproutId);
    // bus.emit is synchronous and runtime.ts adjudicates sprout:dropped in the
    // same task, so a manual drop's transportStarted fires inside the
    // pointerup dispatch itself: pointerup flag already set, and no tick could
    // have boarded this Sprout in between anyway.
    expect(started, 'a transportStarted should have fired for the dropped Sprout').toBeTruthy();
    expect(started!.type).toBe('sprout:transportStarted');
    if (started!.type === 'sprout:transportStarted') {
      expect(started!.upFired, 'boarding must come from the pointerup dispatch, not a tick').toBe(true);
      expect(started!.automationId).toBe('gardenSlide');
      expect(started!.fromTile).toEqual(NURSERY_TILE);
      expect(started!.toTile).toEqual(HABITAT_TILES.sunflowerMeadow);
    }
    expect(events.some((e) => e.type === 'sprout:automationDeclined' && e.sproutId === sproutId)).toBe(false);

    // The boarded ride completes normally and settles the Sprout into
    // Sunflower Meadow (the Slide's always-on target).
    await expect
      .poll(
        async () => (await getTimedEvents(page)).some((e) => e.type === 'sprout:settled' && e.sproutId === sproutId),
        { timeout: 10_000 },
      )
      .toBe(true);

    console_.assertNone();
  });

  test('hovering a matching habitat highlights it, and the highlight agrees with what dropping there does', async ({ page }) => {
    // Regression test for a real bug: handlePointerMove fed the DRAG_HEIGHT
    // plane's ground point (where the held sprite renders) into
    // habitats.nearestWithin, while endDrag (on pointerup) always used the
    // GROUND plane. Those two projections of the same screen pixel are
    // ~2.1 world units apart at the default camera (see
    // drag-height-plane-vs-ground-plane in work_progress.yaml) — so the
    // habitat that lit up during hover could disagree with the one endDrag
    // actually resolved, and a drop over a lit-up (or unlit) habitat could
    // decline and bounce back to the Nursery. Fixed by computing a second,
    // GROUND-plane point for hover hit-testing. This test drops dead-centre
    // on a habitat's own ground point and asserts the mesh scaling (the
    // hover-valid visual, src/render/habitats.ts's setHover) already agreed
    // with the outcome BEFORE pointerup fires.
    test.setTimeout(60_000);
    const console_ = collectConsoleErrors(page);
    await page.goto('/');
    await waitForDevHooks(page);
    await installBusRecorder(page, ['sprout:placed:correct', 'sprout:placed:incorrect']);
    await installSpawnLog(page);

    const sproutId = await page.evaluate(() => {
      const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
      canvas.setPointerCapture = () => {};
      canvas.hasPointerCapture = () => false;

      const toClient = (wx: number, wy: number, wz: number): { x: number; y: number } => {
        const rect = canvas.getBoundingClientRect();
        const projected = window.__debug!.project(wx, wy, wz);
        return { x: rect.left + projected[0] * (rect.width / canvas.width), y: rect.top + projected[1] * (rect.height / canvas.height) };
      };
      const fire = (type: string, at: { x: number; y: number }): void => {
        canvas.dispatchEvent(
          new PointerEvent(type, { pointerId: 13, isPrimary: true, bubbles: true, button: 0, buttons: 1, clientX: at.x, clientY: at.y }),
        );
      };

      const before = new Set((window.__ttSpawnLog ?? []).map((s) => s.id));
      (document.querySelector('[data-testid="debug-spawn-ember"]') as HTMLButtonElement).click();
      return Promise.resolve().then(() => {
        const fresh = (window.__ttSpawnLog ?? []).filter((s) => s.id.startsWith('debug-sprout-') && !before.has(s.id));
        if (fresh.length !== 1) throw new Error(`expected exactly one new debug Sprout, got ${fresh.length}`);
        const id = fresh[0].id;
        fire('pointerdown', toClient(8, 1.13, 8)); // Nursery centre, pre-reveal mesh position
        fire('pointermove', toClient(4, 0, 4)); // Ember Nook's own ground-plane centre
        const debug = window.__debug as unknown as { meshInfo: (n: string) => { scaling: number[] } | null | undefined };
        const hoverScaling = debug.meshInfo('terrarium.habitat.emberNook')?.scaling;
        (window as unknown as { __ttHoverScaling: unknown }).__ttHoverScaling = hoverScaling;
        fire('pointerup', toClient(4, 0, 4));
        return id;
      });
    });

    const hoverScaling = await page.evaluate(() => (window as unknown as { __ttHoverScaling: number[] }).__ttHoverScaling);
    // setHover's valid-match branch scales the habitat up to 1.05 (src/render/habitats.ts).
    expect(hoverScaling, 'Ember Nook should have shown the valid-hover scale-up while an Ember Sprout hovered dead-centre').toEqual([
      1.05, 1.05, 1.05,
    ]);

    const events = await getRecordedEvents(page);
    expect(events.some((e) => e.type === 'sprout:placed:correct' && e.sproutId === sproutId)).toBe(true);
    expect(events.some((e) => e.type === 'sprout:placed:incorrect' && e.sproutId === sproutId)).toBe(false);

    console_.assertNone();
  });
});
