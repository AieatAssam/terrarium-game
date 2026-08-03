import { expect, test, type Page } from '@playwright/test';

import {
  collectConsoleErrors,
  debugSpawnAndGetId,
  getRecordedEvents,
  getUiState,
  installBusRecorder,
  buyUpgradeViaUI,
  placeTransitViaBuildMenu,
  projectToScreen,
  readSaveEnvelope,
  waitForDevHooks,
} from './helpers';
import { findConveyorRoute, GARDEN_SLIDE_TILE, HABITAT_TILES } from '../../src/sim/layout';

async function unlockTransit(page: Page): Promise<void> {
  await page.evaluate(async () => {
    for (let i = 0; i < 40; i += 1) {
      (document.querySelector('[data-testid="debug-grant-dewdrops"]') as HTMLButtonElement).click();
    }
    const drops = [
      ...Array.from({ length: 7 }, () => ['ember', 'emberNook'] as const),
      ...Array.from({ length: 7 }, () => ['dew', 'dewPond'] as const),
      ...Array.from({ length: 6 }, () => ['sun', 'sunflowerMeadow'] as const),
    ];
  for (const [sproutType, habitat] of drops) {
      (document.querySelector(`[data-testid="debug-spawn-${sproutType}"]`) as HTMLButtonElement).click();
      await Promise.resolve();
      const spawned = window.__ttSpawnedIds ?? [];
      const index = spawned.findIndex((entry) => entry.podId === 'debug');
      const id = index >= 0 ? spawned.splice(index, 1)[0]?.id : undefined;
      if (!id) throw new Error('debug spawn did not record');
      window.__terrariumUIF!.bus.emit({
        type: 'sprout:dropped',
        sproutId: id,
        overHabitat: habitat,
        overHabitatInstance: `${habitat}-1`,
      });
  }
  });
  await buyUpgradeViaUI(page, 'Habitat Capacity');
  await expect.poll(async () => (await getUiState(page)).unlockedAutomations, { timeout: 20_000 }).toContain('gardenSlide');
}

async function waitForSavedConveyorCount(page: Page, count: number): Promise<void> {
  await expect.poll(async () => (await readSaveEnvelope(page)).sim.conveyors.length, { timeout: 15_000 }).toBe(count);
}

async function selectAndRemoveConveyor(page: Page, tile: { x: number; z: number }): Promise<void> {
  const point = await projectToScreen(page, { x: tile.x, y: 0, z: tile.z });
  await page.mouse.click(point.x, point.y);
  await page.keyboard.press('Delete');
}

async function frameRoute(page: Page): Promise<void> {
  await page.evaluate((target) => {
    const debug = window.__debug as unknown as {
      qaCamera: (alpha: number, beta: number, radius: number, targetX: number, targetY: number, targetZ: number) => void;
    };
    debug.qaCamera(-Math.PI * 0.75, Math.PI / 2.9, 7.5, target.x, 0.25, target.z);
  }, { x: 6, z: 5 });
  await page.waitForTimeout(250);
}

test('composes, breaks, and repairs a saved Conveyor route', async ({ page }) => {
  test.setTimeout(180_000);
  const console_ = collectConsoleErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await waitForDevHooks(page);
  await installBusRecorder(page, ['transit:conveyorBuilt', 'transit:artifactRemoved', 'sprout:transportStarted', 'sprout:transportCompleted']);
  await unlockTransit(page);

  await placeTransitViaBuildMenu(page, 'gardenSlide', GARDEN_SLIDE_TILE, {
    acceptedKind: 'ember',
    destination: 'emberNook',
  });
  const routeTiles = [
    { x: 8, z: 6 },
    { x: 7, z: 6 },
    { x: 6, z: 6 },
    { x: 5, z: 6 },
    { x: 5, z: 5 },
    { x: 5, z: 4 },
  ];
  for (const tile of routeTiles) await placeTransitViaBuildMenu(page, 'sproutConveyor', tile);
  await waitForSavedConveyorCount(page, routeTiles.length);
  const passengerId = await debugSpawnAndGetId(page, 'ember');

  const complete = await readSaveEnvelope(page);
  const completeRoute = findConveyorRoute(GARDEN_SLIDE_TILE, HABITAT_TILES.emberNook, complete.sim.conveyors);
  expect(completeRoute?.segmentIds).toEqual(routeTiles.map((tile) => `conveyor-${tile.x}-${tile.z}`));
  await frameRoute(page);
  await page.locator('.tt-debug-panel').evaluate((element) => element.remove());
  await page.locator('.tt-toast-region').evaluate((element) => element.remove());
  await page.locator('.tt-nursery-note').evaluate((element) => element.remove());
  await page.screenshot({ path: 'docs/visual-qa/transit/conveyor-route-complete.png' });

  await selectAndRemoveConveyor(page, routeTiles[2]);
  await expect.poll(async () => (await getUiState(page)).transitCounts.sproutConveyor, { timeout: 15_000 }).toBe(5);
  await waitForSavedConveyorCount(page, 5);
  const broken = await readSaveEnvelope(page);
  expect(findConveyorRoute(GARDEN_SLIDE_TILE, HABITAT_TILES.emberNook, broken.sim.conveyors)).toBeNull();
  await page.screenshot({ path: 'docs/visual-qa/transit/conveyor-route-broken.png' });

  await placeTransitViaBuildMenu(page, 'sproutConveyor', routeTiles[2]);
  await waitForSavedConveyorCount(page, routeTiles.length);
  const repaired = await readSaveEnvelope(page);
  expect(findConveyorRoute(GARDEN_SLIDE_TILE, HABITAT_TILES.emberNook, repaired.sim.conveyors)?.length).toBe(7);
  await page.screenshot({ path: 'docs/visual-qa/transit/conveyor-route-repaired.png' });

  await expect.poll(async () => (await getRecordedEvents(page)).some((event) => event.type === 'sprout:transportStarted' && event.sproutId === passengerId), { timeout: 15_000 }).toBe(true);
  const started = (await getRecordedEvents(page)).find((event) => event.type === 'sprout:transportStarted' && event.sproutId === passengerId);
  expect(started).toMatchObject({ automationId: 'gardenSlide', toTile: HABITAT_TILES.emberNook, durationMs: 2900 });
  await expect.poll(async () => (await getRecordedEvents(page)).some((event) => event.type === 'sprout:transportCompleted' && event.sproutId === passengerId), { timeout: 15_000 }).toBe(true);
  console_.assertNone();
});
