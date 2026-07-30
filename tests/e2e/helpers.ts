// Shared helpers for Subagent G's Playwright specs. NOT itself a test file —
// doesn't match playwright.config.ts's `*.dev.spec.ts` / `*.preview.spec.ts`
// testMatch patterns, so it's safe to import from either project.
//
// A lot of this exists to implement the coordinate-projection drag technique
// documented in this session's brief: world-space input picking means
// hardcoded screen pixels are fragile, so every drag computes fresh
// coordinates via the dev-only `window.__debug.project(x, y, z)` hook against
// the CURRENT camera state, then converts from Babylon's render-target pixel
// space to the page's CSS pixel space (verified equal in manual testing here,
// but computed defensively rather than assumed, since a future viewport or
// devicePixelRatio change could break that assumption silently).

import type { Page } from '@playwright/test';
import type { EventBus, GameEvent, GameEventType } from '../../src/events';
import type { UiState } from '../../src/ui/uiState';
import type { SaveEnvelope } from '../../src/persistence/save';

// Mirrors the dev-only globals src/ui/index.ts (__terrariumUIF) and
// src/render/index.ts (__debug) attach to `window` when `isDev` is true —
// see docs/CONTRACTS.md's "Dev flag / debug panel". Declared here (not in
// src/) since these are test-only conveniences, not part of the app's public
// surface.
declare global {
  interface Window {
    __debug?: {
      project: (x: number, y: number, z: number) => [number, number, number];
    };
    __terrariumUIF?: {
      bus: EventBus;
      audio: unknown;
      store: { getState: () => UiState };
    };
    /** Test-only recording buffers installed by installBusRecorder(). */
    __ttEvents?: GameEvent[];
    __ttSpawnedIds?: string[];
  }
}

export const NURSERY_TILE = { x: 8, z: 8 };
export const HABITAT_TILES = {
  emberNook: { x: 4, z: 4 },
  dewPond: { x: 12, z: 4 },
  sunflowerMeadow: { x: 8, z: 13 },
} as const;

export type HabitatKey = keyof typeof HABITAT_TILES;
export type SproutTypeKey = 'ember' | 'dew' | 'sun' | 'star';

// Mirrors the exported SPROUT_FLOAT_HEIGHT in src/render/sprouts.ts, which is
// itself derived: Nursery mound top (0.70) + idle-bob amplitude (0.05) +
// surface clearance (0.03) + the sprite's own half-height (0.35). Used to
// project the on-screen point where a freshly spawned Sprout can be grabbed.
//
// Deliberately a literal rather than an import, and NOT the same mistake
// src/input/index.ts had: importing it was tried and Playwright's loader cannot
// resolve Babylon's extensionless deep specifiers (`Cannot find module
// '@babylonjs/core/Maths/math.color' ... Did you mean ...math.color.js?`), which
// src/render/sprouts.ts pulls in transitively. So drift is guarded from the
// other side instead: tests/unit/render.sproutHeights.test.ts asserts the real
// exported constant still equals this value, and `npm test` fails if it doesn't.
const SPROUT_FLOAT_HEIGHT = 1.13;

/** Collects console errors + page errors from page load onward. Call `.assertNone()` at the end of a test. */
export function collectConsoleErrors(page: Page): { errors: string[]; assertNone: () => void } {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => {
    errors.push(err.message);
  });
  return {
    errors,
    assertNone: () => {
      if (errors.length > 0) {
        throw new Error(`Expected zero console/page errors, got:\n${errors.join('\n')}`);
      }
    },
  };
}

/** Waits for the dev-only globals (debug hook + UI test hook) to exist. Only ever true on the `dev` project. */
export async function waitForDevHooks(page: Page): Promise<void> {
  await page.waitForFunction(() => Boolean(window.__debug) && Boolean(window.__terrariumUIF), undefined, {
    timeout: 15_000,
  });
}

/**
 * Projects a world-space point to CSS-pixel screen coordinates, scaling from
 * Babylon's render-target pixel space to CSS pixels via the canvas's actual
 * backing-store-size vs. bounding-rect ratio (equal 1:1 in every manual check
 * during this session's exploration, but computed rather than assumed).
 */
export async function projectToScreen(page: Page, world: { x: number; y: number; z: number }): Promise<{ x: number; y: number }> {
  return page.evaluate(([w]) => {
    const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();
    const scaleX = rect.width / canvas.width;
    const scaleY = rect.height / canvas.height;
    const projected = window.__debug!.project(w.x, w.y, w.z);
    return { x: rect.left + projected[0] * scaleX, y: rect.top + projected[1] * scaleY };
  }, [world]);
}

export async function nurseryPickupScreenPoint(page: Page): Promise<{ x: number; y: number }> {
  return projectToScreen(page, { x: NURSERY_TILE.x, y: SPROUT_FLOAT_HEIGHT, z: NURSERY_TILE.z });
}

export async function habitatDropScreenPoint(page: Page, habitat: HabitatKey): Promise<{ x: number; y: number }> {
  const tile = HABITAT_TILES[habitat];
  return projectToScreen(page, { x: tile.x, y: 0, z: tile.z });
}

/** Drags from one screen point to another via real pointer input (mouse down/move/up), matching how a player actually drags a Sprout. */
export async function dragBetween(page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  // A couple of intermediate move steps so the app's drag-start/hover logic
  // (which reacts to pointermove, not just the final position) actually runs.
  const steps = 5;
  for (let i = 1; i <= steps; i += 1) {
    await page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
  }
  await page.mouse.up();
}

/** Drags the sole idle Sprout currently sitting at the Nursery to a habitat, via real pointer input. */
export async function dragNurseryToHabitat(page: Page, habitat: HabitatKey): Promise<void> {
  const from = await nurseryPickupScreenPoint(page);
  const to = await habitatDropScreenPoint(page, habitat);
  await dragBetween(page, from, to);
}

/** Plain-object snapshot of the UI state store (Sets converted to sorted arrays so it's directly assertable/serializable). */
export interface UiStateSnapshot {
  dewdropTotal: number;
  unlockedAutomations: string[];
  upgradeLevels: Record<string, number>;
  unlockedAchievements: string[];
  journalDiscovered: string[];
  lastBuiltAutomation: string | undefined;
  lastAchievementUnlocked: string | undefined;
}

export async function getUiState(page: Page): Promise<UiStateSnapshot> {
  return page.evaluate(() => {
    const state = window.__terrariumUIF!.store.getState();
    return {
      dewdropTotal: state.dewdropTotal,
      unlockedAutomations: Array.from(state.unlockedAutomations).sort(),
      upgradeLevels: { ...state.upgradeLevels },
      unlockedAchievements: Array.from(state.unlockedAchievements).sort(),
      journalDiscovered: Array.from(state.journalDiscovered).sort(),
      lastBuiltAutomation: state.lastBuiltAutomation,
      lastAchievementUnlocked: state.lastAchievementUnlocked,
    };
  });
}

/** Sets up a bus subscription (inside the page) that records every `sprout:spawned` id into `window.__ttSpawnedIds`, and every event of the given types into `window.__ttEvents`. Call once per page after dev hooks are ready. */
export async function installBusRecorder(page: Page, extraTypes: GameEventType[] = []): Promise<void> {
  await page.evaluate((types) => {
    window.__ttSpawnedIds = [];
    window.__ttEvents = [];
    window.__terrariumUIF!.bus.subscribe('sprout:spawned', (e) => window.__ttSpawnedIds!.push(e.sproutId));
    for (const type of types) {
      window.__terrariumUIF!.bus.subscribe(type, (e) => window.__ttEvents!.push(e));
    }
  }, extraTypes);
}

/** Returns every recorded event so far (installBusRecorder must have been called first, with the relevant types). */
export async function getRecordedEvents(page: Page): Promise<GameEvent[]> {
  return page.evaluate(() => window.__ttEvents ?? []);
}

/** Pops the most recently recorded `sprout:spawned` id (installBusRecorder must have been called first). */
export async function popLastSpawnedId(page: Page): Promise<string> {
  const id = await page.evaluate(() => window.__ttSpawnedIds?.pop());
  if (!id) throw new Error('No spawned sprout id recorded — did installBusRecorder run, and did a spawn actually happen?');
  return id;
}

/** Emits `sprout:dropped` directly on the bus for a known sprout id — the "fast path" the brief describes for exercising the real sim without a pointer drag (used for progression-heavy specs like the 20-placement Garden Slide unlock, where the point is sim logic, not input fidelity). */
export async function emitDropped(page: Page, sproutId: string, overHabitat: HabitatKey | null): Promise<void> {
  await page.evaluate(
    ([id, habitat]) => {
      window.__terrariumUIF!.bus.emit({ type: 'sprout:dropped', sproutId: id as string, overHabitat: habitat as HabitatKey | null });
    },
    [sproutId, overHabitat] as const,
  );
}

/** Clicks a debug panel button by its data-testid and returns the just-recorded sprout id (for the spawn-* buttons). Requires installBusRecorder to have run first. */
export async function debugSpawnAndGetId(page: Page, sproutType: SproutTypeKey): Promise<string> {
  await page.click(`[data-testid="debug-spawn-${sproutType}"]`);
  return popLastSpawnedId(page);
}

/** Clicks "+50 Dewdrops" `times` times (debug panel). */
export async function grantDewdrops(page: Page, times: number): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await page.click('[data-testid="debug-grant-dewdrops"]');
  }
}

/**
 * Opens the Upgrades panel via the real nav button, clicks the Buy button for
 * the upgrade whose displayName is `displayNameSubstring` (matched via the
 * button's aria-label, e.g. "Buy Habitat Capacity for 100 Dewdrops..."), then
 * closes the panel via its explicit close button. This is the real UI path
 * (nav -> panel -> buy button -> onPurchaseUpgrade hook ->
 * sim.purchaseUpgrade), not a bus shortcut, since purchasing has no
 * dedicated GameEvent to fast-path through.
 *
 * Deliberately closes via the "Close Upgrades" button, NOT Escape:
 * src/ui/components/upgrades.ts's `render()` runs on every store change and
 * calls `body.replaceChildren(...)`, which tears down and rebuilds every row
 * (including the button just clicked) once `upgrade:purchased` lands — and
 * since main.ts's `onPurchaseUpgrade` hook goes through a `.then()`
 * microtask, that rebuild can land after the click handler returns, moving
 * focus to `document.body`. src/ui/panel.ts's Escape handler is bound to the
 * dialog's `overlay`, so once focus has drifted outside it, Escape no longer
 * closes the panel. The close button in the panel header
 * (`panel.dialog.append(header, body)`) survives the body-only re-render, so
 * it's the reliable way to close here. See this session's QA_REPORT.md for
 * the focus-loss-after-purchase finding this sidesteps.
 */
export async function buyUpgradeViaUI(page: Page, displayNameSubstring: string): Promise<void> {
  await page.getByRole('button', { name: 'Upgrades' }).click();
  const buyButton = page.getByRole('button', { name: new RegExp(`^Buy ${displayNameSubstring} for`) });
  await buyButton.click();
  await page.getByRole('button', { name: 'Close Upgrades' }).click();
}

/** Spawns `sproutType` and immediately emits a `sprout:dropped` for it over `habitat` via the bus — the fast path for progression-heavy specs (see module doc). Requires installBusRecorder to have run first. */
export async function spawnAndDrop(page: Page, sproutType: SproutTypeKey, habitat: HabitatKey): Promise<void> {
  const id = await debugSpawnAndGetId(page, sproutType);
  await emitDropped(page, id, habitat);
}

/**
 * Reads the persisted save envelope straight out of IndexedDB (src/persistence/db.ts:
 * db 'tiny-terrarium-works', store 'saves', key 'default') — bypassing the UI/sim
 * entirely. Used by the persistence spec to verify what actually survived a
 * reload independent of the UI-state-store hydration gap documented in
 * docs/QA_REPORT.md (finding: src/ui/uiState.ts never re-syncs from a
 * restored save, only from live bus events going forward).
 */
export async function readSaveEnvelope(page: Page): Promise<SaveEnvelope> {
  return page.evaluate(async () => {
    const dbReq = indexedDB.open('tiny-terrarium-works');
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      dbReq.onsuccess = () => resolve(dbReq.result);
      dbReq.onerror = () => reject(dbReq.error);
    });
    try {
      const tx = db.transaction('saves', 'readonly');
      const value = await new Promise<SaveEnvelope>((resolve, reject) => {
        const req = tx.objectStore('saves').get('default');
        req.onsuccess = () => resolve(req.result as SaveEnvelope);
        req.onerror = () => reject(req.error);
      });
      return value;
    } finally {
      db.close();
    }
  });
}

/** Waits for a `save:written` event to fire (i.e. an actual autosave completed), up to `timeoutMs`. Requires installBusRecorder(page, ['save:written']) to have run first. */
export async function waitForSaveWritten(page: Page, timeoutMs = 20_000): Promise<void> {
  await page.waitForFunction(() => window.__ttEvents?.some((e) => e.type === 'save:written') ?? false, undefined, {
    timeout: timeoutMs,
  });
}
