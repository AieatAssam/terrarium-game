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

import { expect, type Page } from '@playwright/test';
import type { EventBus, GameEvent, GameEventType } from '../../src/events';
import type { UiState } from '../../src/ui/uiState';
import type { SaveEnvelope } from '../../src/persistence/save';
// Safe to import: src/render/layout.ts pulls in only src/sim/grid + src/sim/layout,
// no Babylon deep specifiers (same rationale as the top-of-file header).
import { AUTOMATION_SITE_TILES } from '../../src/render/layout';
import type { AutomationId } from '../../src/core/ids';

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
    /** Every sprout:spawned since installBusRecorder(), id + podId + sproutType (see popLastSpawnedId). */
    __ttSpawnedIds?: Array<{ id: string; podId: string; sproutType: SproutTypeKey }>;
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

/**
 * Finds whichever waiting Sprout's mesh currently sits nearest the Nursery
 * tile centre and returns its live world position, or null if none exists.
 * NOT the tile centre itself: the waiting-slot fan (src/render/sprouts.ts's
 * nurseryWaitOffset) has always put a Sprout's real mesh some distance from
 * the tile centre, and NURSERY_FRONT_DISTANCE grew from 0.85 to 1.2
 * (mound-standee clipping fix) specifically to clear a mound decoration that
 * has nothing to do with where the app's own pick radius looks — a click at
 * the literal tile centre can miss every waiting Sprout's SPROUT_PICK_RADIUS
 * entirely depending on that constant, which is exactly what broke every
 * caller of this helper when the constant moved.
 */
async function nearestNurserySproutPosition(page: Page): Promise<[number, number, number] | null> {
  return page.evaluate((tile) => {
    const debug = window.__debug as unknown as {
      meshNames: (prefix: string) => string[];
      meshInfo: (n: string) => { pos: number[]; enabled: boolean } | null | undefined;
    };
    let best: { pos: number[]; dd: number } | null = null;
    for (const name of debug.meshNames('terrarium.sprout.')) {
      const info = debug.meshInfo(name);
      if (!info || !info.enabled) continue;
      const dx = info.pos[0] - tile.x;
      const dz = info.pos[2] - tile.z;
      const dd = dx * dx + dz * dz;
      if (!best || dd < best.dd) best = { pos: info.pos, dd };
    }
    return best ? (best.pos as [number, number, number]) : null;
  }, NURSERY_TILE);
}

/**
 * Screen point of whichever waiting Sprout's mesh currently sits nearest the
 * Nursery tile centre (see nearestNurserySproutPosition above for why not
 * the tile centre itself). A freshly spawned Sprout's mesh spends its first
 * ~420ms at the raw tile centre before the reveal pop-in finishes and
 * claimNurserySlot JUMPS it to its real waiting-slot offset in one frame
 * (src/render/sprouts.ts's spawn()) — reading position once and clicking a
 * moment later can straddle that jump and miss by a wide margin (measured:
 * a jump from tile-centre-exact to 1.56 world units away, well outside
 * SPROUT_PICK_RADIUS 0.55). Polling until two reads 80ms apart agree avoids
 * clicking mid-jump without hardcoding the animation's own duration here.
 */
export async function nurseryPickupScreenPoint(page: Page): Promise<{ x: number; y: number }> {
  let pos = await nearestNurserySproutPosition(page);
  for (let i = 0; i < 20 && pos; i += 1) {
    await page.waitForTimeout(80);
    const again = await nearestNurserySproutPosition(page);
    if (again && again[0] === pos[0] && again[2] === pos[2]) break;
    pos = again;
  }
  if (!pos) throw new Error('nurseryPickupScreenPoint: no enabled Sprout mesh found near the Nursery tile');
  return projectToScreen(page, { x: pos[0], y: pos[1], z: pos[2] });
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
  habitatInstanceCounts: Record<string, number>;
  habitatFullKinds: string[];
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
      habitatInstanceCounts: { ...state.habitatInstanceCounts },
      habitatFullKinds: Array.from(state.habitatFullKinds).sort(),
    };
  });
}

/** Sets up a bus subscription (inside the page) that records every `sprout:spawned` id+podId+sproutType into `window.__ttSpawnedIds`, and every event of the given types into `window.__ttEvents`. Call once per page after dev hooks are ready. */
export async function installBusRecorder(page: Page, extraTypes: GameEventType[] = []): Promise<void> {
  await page.evaluate((types) => {
    window.__ttSpawnedIds = [];
    window.__ttEvents = [];
    window.__terrariumUIF!.bus.subscribe('sprout:spawned', (e) =>
      window.__ttSpawnedIds!.push({ id: e.sproutId, podId: e.podId, sproutType: e.sproutType }),
    );
    for (const type of types) {
      window.__terrariumUIF!.bus.subscribe(type, (e) => window.__ttEvents!.push(e));
    }
  }, extraTypes);
}

/** Returns every recorded event so far (installBusRecorder must have been called first, with the relevant types). */
export async function getRecordedEvents(page: Page): Promise<GameEvent[]> {
  return page.evaluate(() => window.__ttEvents ?? []);
}

/**
 * Pops the most recently recorded DEBUG `sprout:spawned` id (installBusRecorder
 * must have been called first) — specifically `podId === 'debug'`
 * (src/sim/runtime.ts's `debug.spawnSprout`), never a natural pod spawn
 * (`podId: 'nursery'`, src/sim/systems.ts's `spawnSystem`). The naive
 * "just pop the last recorded id" this replaced was a real race (this file's
 * spawnandid-pop-race gotcha): the Nursery's own pod keeps spawning on its
 * normal cadence for the whole real-wall-clock duration a caller spends
 * clicking + awaiting a debug-spawn button, so a natural pod spawn landing in
 * that window could win the pop, silently stranding the just-clicked debug
 * Sprout idle at the Nursery forever (never dropped, never counted) —
 * confirmed live 2026-08-01 as the cause of automation.dev.spec.ts's "an idle
 * Slide runs no belt" flake failing 3/3 runs once the Slide started targeting
 * Sun specifically. Filtering on `podId` fixes it deterministically instead
 * of just making it less likely.
 */
export async function popLastSpawnedId(page: Page): Promise<string> {
  const id = await page.evaluate(() => {
    const list = window.__ttSpawnedIds ?? [];
    for (let i = list.length - 1; i >= 0; i -= 1) {
      if (list[i].podId === 'debug') {
        const [entry] = list.splice(i, 1);
        return entry.id;
      }
    }
    return undefined;
  });
  if (!id) throw new Error('No debug-spawned sprout id recorded — did installBusRecorder run, and did a debug spawn actually happen?');
  return id;
}

/** Emits `sprout:dropped` directly on the bus for a known sprout id — the "fast path" the brief describes for exercising the real sim without a pointer drag (used for progression-heavy specs like the 20-placement Garden Slide unlock, where the point is sim logic, not input fidelity). The drop targets the kind's ORIGINAL instance (`<kind>-1`, always present since Phase 2's instance model seeds it) — enough for specs that only ever drop on an original home. */
export async function emitDropped(page: Page, sproutId: string, overHabitat: HabitatKey | null): Promise<void> {
  await page.evaluate(
    ([id, habitat]) => {
      window.__terrariumUIF!.bus.emit({
        type: 'sprout:dropped',
        sproutId: id as string,
        overHabitat: habitat as HabitatKey | null,
        overHabitatInstance: habitat ? `${habitat}-1` : null,
      });
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
  // Aria-label depends on state (src/ui/components/upgrades.ts render()):
  // unlocked reads "Buy X for N Dewdrops...", locked reads "X, not available
  // yet. ...", maxed reads "X, maximum level reached" — all three start with
  // the upgrade's own display name, optionally preceded by "Buy ". The old
  // `^Buy X for` anchor could never match a locked/maxed button, which made
  // this helper unusable for "attempt a purchase that should be rejected"
  // scenarios (it just timed out finding zero matching elements).
  const buyButton = page.getByRole('button', { name: new RegExp(`^(Buy )?${displayNameSubstring}`) });
  // force: true — a locked/maxed button is genuinely `disabled`, and
  // Playwright's default actionability wait blocks on "becomes enabled" for a
  // button that structurally never will. The click handler itself already
  // no-ops on `buyBtn.disabled`, so a forced click on a disabled button is
  // exactly the "silently rejected" case callers want to exercise.
  await buyButton.click({ force: true });
  await page.getByRole('button', { name: 'Close Upgrades' }).click();
}

/** Spawns `sproutType` and immediately emits a `sprout:dropped` for it over `habitat` via the bus — the fast path for progression-heavy specs (see module doc). Requires installBusRecorder to have run first. */
export async function spawnAndDrop(page: Page, sproutType: SproutTypeKey, habitat: HabitatKey): Promise<void> {
  const id = await debugSpawnAndGetId(page, sproutType);
  await emitDropped(page, id, habitat);
}

const AUTOMATION_MENU_LABEL: Record<AutomationId, string> = {
  gardenSlide: 'Garden Slide',
  colourGate: 'Colour Gate',
  moodBell: 'Mood Bell',
};

/**
 * Places an already-unlocked automation through the REAL build menu + a
 * canvas click at its canonical site tile (2026-08-01 manual placement —
 * GameRules §9.8; the auto-build-on-unlock those older specs asserted was
 * removed in Phase 1.2). Exercises exactly the path a player uses: build-menu
 * button -> enterBuildMode -> ghost preview -> click-to-commit ->
 * sim.placeAutomation. Requires installBusRecorder to have run first.
 */
export async function placeAutomationViaBuildMenu(page: Page, automationId: AutomationId): Promise<void> {
  const label = AUTOMATION_MENU_LABEL[automationId];
  const site = AUTOMATION_SITE_TILES[automationId];
  // Non-exact name match on purpose: once selected, the build menu appends
  // " (selected — click to cancel placement)" to the label, so an exact
  // match would find nothing after the first click. Scoped to the build menu
  // toolbar because the Garden menu's nav bar also carries a same-named
  // button (it opens the build-mode sheet for that automation).
  const toolbar = page.getByRole('toolbar', { name: 'Build menu' });
  const button = toolbar.getByRole('button', { name: new RegExp(`^${label}`) });
  await expect(button, `build menu should offer "${label}" once it is unlocked`).toBeVisible();
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  const screen = await projectToScreen(page, { x: site.x, y: 0, z: site.z });
  await page.mouse.click(screen.x, screen.y);
  await expect.poll(async () => (await getUiState(page)).lastBuiltAutomation, { timeout: 10_000 }).toBe(automationId);
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
