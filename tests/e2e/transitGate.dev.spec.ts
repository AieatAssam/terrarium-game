import { devices, expect, test, type Page } from '@playwright/test';

import {
  collectConsoleErrors,
  debugSpawnAndGetId,
  getRecordedEvents,
  getUiState,
  installBusRecorder,
  placeTransitViaBuildMenu,
  projectToScreen,
  readSaveEnvelope,
  waitForDevHooks,
  waitForSaveWritten,
  writeSaveEnvelope,
} from './helpers';
import { getEffectiveHabitatCapacity, HABITATS } from '../../src/data/habitats';
import { GARDEN_SLIDE_TILE, HABITAT_TILES } from '../../src/render/layout';

const CAPTURE_DIR = 'docs/visual-qa/transit';
const HABITAT_TARGETS = [
  { habitat: 'emberNook', sproutType: 'ember' },
  { habitat: 'dewPond', sproutType: 'dew' },
  { habitat: 'sunflowerMeadow', sproutType: 'sun' },
] as const;
const TARGET_ROOM_TILES = {
  emberNook: { x: 4, z: 5 },
  dewPond: { x: 12, z: 5 },
  sunflowerMeadow: { x: 8, z: 12 },
} as const;

async function unlockTransit(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const debug = window as unknown as {
      __terrariumDebug: { grantDewdrops: (amount: number) => Promise<void> };
    };
    await debug.__terrariumDebug.grantDewdrops(5_000);
  });
  const drops = [
    ...Array.from({ length: 7 }, () => ['ember', 'emberNook'] as const),
    ...Array.from({ length: 7 }, () => ['dew', 'dewPond'] as const),
    ...Array.from({ length: 6 }, () => ['sun', 'sunflowerMeadow'] as const),
  ];
  await page.evaluate(async (items) => {
    for (const [sproutType, habitat] of items) {
      const before = window.__ttSpawnedIds?.length ?? 0;
      (document.querySelector(`[data-testid="debug-spawn-${sproutType}"]`) as HTMLButtonElement).click();
      await Promise.resolve();
      const list = window.__ttSpawnedIds ?? [];
      const index = list.findIndex((entry, candidate) => candidate >= before && entry.podId === 'debug');
      if (index < 0) throw new Error('debug spawn did not record');
      const id = list.splice(index, 1)[0].id;
      window.__terrariumUIF!.bus.emit({
        type: 'sprout:dropped',
        sproutId: id,
        overHabitat: habitat,
        overHabitatInstance: `${habitat}-1`,
      });
    }
  }, drops);
  await expect.poll(async () => (await getUiState(page)).unlockedAutomations, { timeout: 20_000 }).toContain('gardenSlide');
}

async function frame(page: Page, target: { x: number; z: number }, radius: number): Promise<void> {
  await page.evaluate(({ target: point, radius: cameraRadius }) => {
    const debug = window.__debug as unknown as {
      qaCamera: (alpha: number, beta: number, radius: number, targetX: number, targetY: number, targetZ: number) => void;
    };
    debug.qaCamera(-Math.PI * 0.75, Math.PI / 2.9, cameraRadius, point.x, 0.2, point.z);
  }, { target, radius });
  await page.waitForTimeout(250);
}

async function hideDebugChrome(page: Page): Promise<void> {
  await page.evaluate(() => {
    for (const selector of ['.tt-debug-panel', '.tt-toast-region', '.tt-nursery-note']) {
      document.querySelector(selector)?.remove();
    }
  });
}

async function spawnAndDropFast(
  page: Page,
  sproutType: 'ember' | 'dew' | 'sun' | 'star',
  habitat: 'emberNook' | 'dewPond' | 'sunflowerMeadow',
  instanceId: string,
  count: number,
): Promise<void> {
  await page.evaluate(async ({ sproutType: type, habitat: target, instanceId: destination, count: total }) => {
    for (let i = 0; i < total; i += 1) {
      const before = window.__ttSpawnedIds?.length ?? 0;
      (document.querySelector(`[data-testid="debug-spawn-${type}"]`) as HTMLButtonElement).click();
      await Promise.resolve();
      const list = window.__ttSpawnedIds ?? [];
      const index = list.findIndex((entry, candidate) => candidate >= before && entry.podId === 'debug');
      if (index < 0) throw new Error('debug spawn did not record');
      const id = list.splice(index, 1)[0].id;
      window.__terrariumUIF!.bus.emit({
        type: 'sprout:dropped',
        sproutId: id,
        overHabitat: target,
        overHabitatInstance: destination,
      });
    }
  }, { sproutType, habitat, instanceId, count });
}

async function ensureTargetRoom(page: Page, target: (typeof HABITAT_TARGETS)[number]): Promise<{ id: string }> {
  const state = await getUiState(page);
  const capacity = getEffectiveHabitatCapacity(target.habitat, state.upgradeLevels.habitatCapacity ?? 0);
  if (!state.habitatFullKinds.includes(target.habitat)) return { id: `${target.habitat}-1` };
  const instances = state.habitatInstanceCounts[target.habitat] ?? 1;
  await spawnAndDropFast(page, target.sproutType, target.habitat, `${target.habitat}-1`, capacity);
  await expect.poll(async () => (await getUiState(page)).habitatFullKinds).toContain(target.habitat);

  const site = TARGET_ROOM_TILES[target.habitat];

  const toolbar = page.getByRole('toolbar', { name: 'Build menu' });
  const button = toolbar.getByRole('button', { name: new RegExp(`^${HABITATS[target.habitat].displayName} — build another home`) });
  await expect(button).toBeVisible();
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  const point = await projectToScreen(page, { x: site.x, y: 0, z: site.z });
  await page.mouse.click(point.x, point.y);
  await expect.poll(async () => (await getUiState(page)).habitatInstanceCounts[target.habitat]).toBe(instances + 1);
  return { id: `${target.habitat}-${instances + 1}` };
}

async function waitForTransport(page: Page, sproutId: string, type: 'sprout:transportStarted' | 'sprout:transportReturned', reason?: string): Promise<void> {
  await expect.poll(async () => {
    const events = await getRecordedEvents(page);
    return events.some((event) => {
      if (event.type !== type || event.sproutId !== sproutId) return false;
      return reason === undefined || ('reason' in event && event.reason === reason);
    });
  }, { timeout: 20_000 }).toBe(true);
}

test.describe('Garden Transit acceptance gate', () => {
  test('covers single and multi-Slide composition, Conveyor routing, and placement states', async ({ page }) => {
    test.setTimeout(180_000);
    const console_ = collectConsoleErrors(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await waitForDevHooks(page);
    await installBusRecorder(page, ['transit:slideBuilt', 'transit:conveyorBuilt']);
    await unlockTransit(page);
    await hideDebugChrome(page);

    await placeTransitViaBuildMenu(page, 'gardenSlide', GARDEN_SLIDE_TILE, {
      acceptedKind: 'ember',
      destination: 'emberNook',
    });
    await page.screenshot({ path: `${CAPTURE_DIR}/gate-single.png` });

    const routeTiles = [
      { x: 8, z: 6 },
      { x: 7, z: 6 },
      { x: 6, z: 6 },
      { x: 5, z: 6 },
      { x: 5, z: 5 },
      { x: 5, z: 4 },
    ];
    for (const tile of routeTiles) await placeTransitViaBuildMenu(page, 'sproutConveyor', tile);
    await expect.poll(async () => (await getUiState(page)).transitCounts.sproutConveyor).toBe(routeTiles.length);
    await frame(page, { x: 6, z: 5 }, 7.5);
    await page.screenshot({ path: `${CAPTURE_DIR}/gate-conveyor.png` });

    await placeTransitViaBuildMenu(page, 'gardenSlide', { x: 8, z: 9 }, {
      acceptedKind: 'dew',
      destination: 'dewPond',
    });
    await expect.poll(async () => (await getUiState(page)).transitCounts.gardenSlide).toBe(2);
    await frame(page, { x: 8, z: 8 }, 8.2);
    await page.screenshot({ path: `${CAPTURE_DIR}/gate-multi.png` });

    const conveyorButton = page.getByRole('toolbar', { name: 'Build menu' }).getByRole('button', { name: /^Sprout Conveyor/ });
    await conveyorButton.click();
    const habitatPoint = await projectToScreen(page, { x: HABITAT_TILES.emberNook.x, y: 0, z: HABITAT_TILES.emberNook.z });
    await page.mouse.move(habitatPoint.x, habitatPoint.y);
    await expect(page.getByRole('toolbar', { name: 'Build menu' }).getByRole('status')).toContainText('already holding');
    await page.screenshot({ path: `${CAPTURE_DIR}/gate-invalid.png` });

    const nurseryPoint = await projectToScreen(page, { x: 8, y: 0, z: 8 });
    await page.mouse.move(nurseryPoint.x, nurseryPoint.y);
    await expect(page.getByRole('toolbar', { name: 'Build menu' }).getByRole('status')).toContainText('Nursery');
    await page.screenshot({ path: `${CAPTURE_DIR}/gate-blocked.png` });
    await page.keyboard.press('Escape');
    console_.assertNone();
  });

  test('recovers a full destination, a disabled ride, and a removed Slide with a full refund', async ({ page }) => {
    test.setTimeout(180_000);
    const console_ = collectConsoleErrors(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await waitForDevHooks(page);
    await installBusRecorder(page, ['sprout:transportStarted', 'sprout:transportReturned', 'transit:artifactRemoved']);
    await unlockTransit(page);

    const target = HABITAT_TARGETS[2];
    const targetRoom = await ensureTargetRoom(page, target);
    await placeTransitViaBuildMenu(page, 'gardenSlide', GARDEN_SLIDE_TILE, {
      acceptedKind: 'star',
      destination: target.habitat,
    });
    const passenger = await debugSpawnAndGetId(page, 'star');
    await waitForTransport(page, passenger, 'sprout:transportStarted');

    const state = await getUiState(page);
    const capacity = getEffectiveHabitatCapacity(target.habitat, state.upgradeLevels.habitatCapacity ?? 0);
    await spawnAndDropFast(page, target.sproutType, target.habitat, targetRoom.id, capacity + 2);
    await waitForTransport(page, passenger, 'sprout:transportReturned', 'destinationFull');

    const rules = page.getByRole('region', { name: 'Transit rules' });
    await rules.getByRole('button', { name: /Transit rules/ }).click();
    await expect(rules).toContainText('destination was full');
    await frame(page, GARDEN_SLIDE_TILE, 5.8);
    await page.screenshot({ path: `${CAPTURE_DIR}/gate-full.png` });
    await rules.getByRole('button', { name: /Transit rules/ }).click();

    const beforeRemoval = (await getUiState(page)).dewdropTotal;
    const slidePoint = await projectToScreen(page, { x: GARDEN_SLIDE_TILE.x, y: 0, z: GARDEN_SLIDE_TILE.z });
    await page.mouse.click(slidePoint.x, slidePoint.y);
    await page.keyboard.press('Delete');
    await expect.poll(async () => (await getUiState(page)).transitCounts.gardenSlide).toBe(0);
    await expect.poll(async () => (await getUiState(page)).dewdropTotal).toBeGreaterThan(beforeRemoval);

    const disabledTarget = HABITAT_TARGETS[0];
    await ensureTargetRoom(page, disabledTarget);
    await placeTransitViaBuildMenu(page, 'gardenSlide', GARDEN_SLIDE_TILE, {
      acceptedKind: 'star',
      destination: disabledTarget.habitat,
    });
    const disabledPassenger = await debugSpawnAndGetId(page, 'star');
    await waitForTransport(page, disabledPassenger, 'sprout:transportStarted');
    const reopenedRules = page.getByRole('region', { name: 'Transit rules' });
    await page.evaluate(() => {
      const panel = document.querySelector('.tt-transit-panel');
      (panel?.querySelector('.tt-transit-panel-toggle') as HTMLButtonElement | null)?.click();
      const enabled = panel?.querySelector('[data-transit-focus="slide-1-enabled"]') as HTMLInputElement | null;
      if (!enabled) throw new Error('Slide enabled control missing');
      enabled.checked = false;
      enabled.dispatchEvent(new Event('change', { bubbles: true }));
      (panel?.querySelector('.tt-transit-apply') as HTMLButtonElement | null)?.click();
    });
    await waitForTransport(page, disabledPassenger, 'sprout:transportReturned', 'disabled');
    await expect(reopenedRules).toContainText('paused');
    await hideDebugChrome(page);
    console_.assertNone();
  });

  test('repairs a saved mid-transit ride and keeps settings accessible', async ({ page }) => {
    test.setTimeout(90_000);
    const console_ = collectConsoleErrors(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await waitForDevHooks(page);
    await installBusRecorder(page, ['sprout:transportStarted', 'save:written']);
    await unlockTransit(page);
    const target = HABITAT_TARGETS[2];
    await ensureTargetRoom(page, target);
    await placeTransitViaBuildMenu(page, 'gardenSlide', GARDEN_SLIDE_TILE, {
      acceptedKind: 'star',
      destination: target.habitat,
    });
    const passenger = await debugSpawnAndGetId(page, 'star');
    await waitForTransport(page, passenger, 'sprout:transportStarted');
    await page.evaluate(() => { window.__ttEvents = []; });
    await page.evaluate(() => window.dispatchEvent(new Event('beforeunload')));
    await expect.poll(async () => (await readSaveEnvelope(page)).sim.slides[0]?.carryingSproutId, { timeout: 5_000 }).toBe(passenger);
    const saved = await readSaveEnvelope(page);
    expect(saved.sim.slides[0]?.carryingSproutId).toBe(passenger);
    expect(saved.sim.sprouts.find((sprout) => sprout.id === passenger)?.state).toBe('transporting');

    saved.sim.slides[0]!.completesAtTick = null;
    await page.goto('/@vite/client');
    await page.waitForTimeout(100);
    await writeSaveEnvelope(page, saved);
    await expect.poll(async () => (await readSaveEnvelope(page)).sim.slides[0]?.completesAtTick).toBeNull();

    await page.goto('/');
    await waitForDevHooks(page);
    await installBusRecorder(page, ['save:written']);
    await expect.poll(async () => (await getUiState(page)).transitCounts.gardenSlide).toBe(1);
    const rules = page.getByRole('region', { name: 'Transit rules' });
    await rules.getByRole('button', { name: /Transit rules/ }).click();
    await expect(rules).toContainText('while the garden save was repaired');
    await waitForSaveWritten(page, 20_000);
    const repaired = await readSaveEnvelope(page);
    expect(repaired.sim.slides[0]?.carryingSproutId).toBeNull();
    expect(repaired.sim.sprouts.find((sprout) => sprout.id === passenger)?.state).not.toBe('transporting');

    await hideDebugChrome(page);
    await frame(page, GARDEN_SLIDE_TILE, 6.8);
    await page.screenshot({ path: `${CAPTURE_DIR}/gate-reload.png` });

    const settings = page.getByRole('dialog', { name: 'Settings' });
    await page.getByRole('button', { name: 'Settings' }).click();
    await expect(settings).toBeVisible();
    await settings.getByRole('switch', { name: 'Mute all audio' }).click();
    await expect(settings.getByRole('switch', { name: 'Mute all audio' })).toHaveAttribute('aria-checked', 'true');
    await settings.getByRole('switch', { name: 'High contrast' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-contrast', 'high');
    await settings.getByRole('button', { name: 'Close Settings' }).click();
    await page.screenshot({ path: `${CAPTURE_DIR}/gate-high-contrast.png` });

    await page.getByRole('button', { name: 'Settings' }).click();
    await settings.getByRole('switch', { name: 'Reduced motion' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-reduced-motion', 'true');
    await settings.getByRole('button', { name: 'Close Settings' }).click();
    await page.screenshot({ path: `${CAPTURE_DIR}/gate-reduced-motion.png` });
    console_.assertNone();
  });

  test('loads a pre-phase v7 save and rewrites it in the current format', async ({ page }) => {
    test.setTimeout(90_000);
    const console_ = collectConsoleErrors(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await waitForDevHooks(page);
    await installBusRecorder(page);
    await unlockTransit(page);
    await placeTransitViaBuildMenu(page, 'gardenSlide', GARDEN_SLIDE_TILE, {
      acceptedKind: 'star',
      destination: 'sunflowerMeadow',
    });
    await page.evaluate(() => window.dispatchEvent(new Event('beforeunload')));
    const current = await readSaveEnvelope(page);
    expect(current.version).toBe(8);
    current.version = 7;
    current.sim.shapeVersion = 7;
    for (const slide of current.sim.slides) {
      delete slide.carryingSproutId;
      delete slide.fromTile;
      delete slide.toTile;
      delete slide.completesAtTick;
    }

    await page.goto('/@vite/client');
    await page.waitForTimeout(100);
    await writeSaveEnvelope(page, current);
    await expect.poll(async () => (await readSaveEnvelope(page)).version).toBe(7);
    await page.goto('/');
    await waitForDevHooks(page);
    await installBusRecorder(page, ['save:written']);
    await expect.poll(async () => (await getUiState(page)).transitCounts.gardenSlide).toBe(1);
    await waitForSaveWritten(page, 20_000);
    const migrated = await readSaveEnvelope(page);
    expect(migrated.version).toBe(8);
    expect(migrated.sim.shapeVersion).toBe(8);
    expect(migrated.sim.slides[0]?.carryingSproutId).toBeNull();
    expect(migrated.sim.slides[0]?.completesAtTick).toBeNull();
    console_.assertNone();
  });
});

test.describe('Garden Transit touch and keyboard gate', () => {
  const iphone = devices['iPhone 13'];
  test.use({
    viewport: iphone.viewport,
    userAgent: iphone.userAgent,
    deviceScaleFactor: iphone.deviceScaleFactor,
    isMobile: iphone.isMobile,
    hasTouch: iphone.hasTouch,
  });

  test('places a Slide by touch and opens its rules by keyboard at 390px', async ({ page }) => {
    test.setTimeout(120_000);
    const console_ = collectConsoleErrors(page);
    await page.goto('/');
    await waitForDevHooks(page);
    await installBusRecorder(page, ['transit:slideBuilt']);
    await unlockTransit(page);
    await page.waitForFunction(() => Boolean((window.__debug as unknown as { inputReady?: boolean } | undefined)?.inputReady));

    const toolbar = page.getByRole('toolbar', { name: 'Build menu' });
    const slideButton = toolbar.getByRole('button', { name: /^Garden Slide/ });
    await slideButton.click();
    await expect(slideButton).toHaveAttribute('aria-pressed', 'true');
    const point = await projectToScreen(page, { x: GARDEN_SLIDE_TILE.x + 1, y: 0, z: GARDEN_SLIDE_TILE.z });
    await page.touchscreen.tap(point.x, point.y);
    await expect.poll(async () => (await getUiState(page)).transitCounts.gardenSlide).toBe(1);

    const rules = page.getByRole('region', { name: 'Transit rules' });
    const toggle = rules.getByRole('button', { name: /Transit rules/ });
    await toggle.focus();
    await page.keyboard.press('Enter');
    await expect(rules.getByLabel('Garden Slide 1 destination')).toBeVisible();
    await hideDebugChrome(page);
    await page.screenshot({ path: `${CAPTURE_DIR}/gate-390.png` });
    console_.assertNone();
  });
});
