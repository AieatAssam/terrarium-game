import { expect, test, type Page } from '@playwright/test';
import {
  collectConsoleErrors,
  getRecordedEvents,
  getUiState,
  installBusRecorder,
  placeTransitViaBuildMenu,
  projectToScreen,
  readSaveEnvelope,
  waitForDevHooks,
  waitForSaveWritten,
} from './helpers';
import { GARDEN_SLIDE_TILE, NURSERY_TILE } from '../../src/render/layout';

async function unlockTransit(page: Page): Promise<void> {
  await page.evaluate(async () => {
    for (let i = 0; i < 40; i += 1) {
      (document.querySelector('[data-testid="debug-grant-dewdrops"]') as HTMLButtonElement).click();
    }
    await Promise.resolve();
    const drops = [
      ...Array.from({ length: 8 }, () => ['ember', 'emberNook'] as const),
      ...Array.from({ length: 6 }, () => ['dew', 'dewPond'] as const),
      ...Array.from({ length: 6 }, () => ['sun', 'sunflowerMeadow'] as const),
    ];
    for (const [sproutType, habitat] of drops) {
      (document.querySelector(`[data-testid="debug-spawn-${sproutType}"]`) as HTMLButtonElement).click();
      await Promise.resolve();
      const spawned = window.__ttSpawnedIds ?? [];
      const id = spawned[spawned.length - 1]?.id;
      if (!id) throw new Error('debug spawn did not record');
      window.__terrariumUIF!.bus.emit({
        type: 'sprout:dropped',
        sproutId: id,
        overHabitat: habitat,
        overHabitatInstance: `${habitat}-1`,
      });
    }
  });
  await expect.poll(async () => (await getUiState(page)).unlockedAutomations, { timeout: 20_000 }).toContain('gardenSlide');
}

async function movePointerToTile(page: Page, tile: { x: number; z: number }): Promise<void> {
  const point = await projectToScreen(page, { x: tile.x, y: 0, z: tile.z });
  await page.mouse.move(point.x, point.y);
}

async function frameGardenSlide(page: Page, radius: number, target: { x: number; y: number; z: number }, alpha = -Math.PI * 0.75): Promise<void> {
  await page.evaluate(({ alpha: nextAlpha, radius: nextRadius, target: nextTarget }) => {
    const debug = window.__debug as unknown as {
      qaCamera: (alpha: number, beta: number, radius: number, targetX: number, targetY: number, targetZ: number) => void;
    };
    debug.qaCamera(nextAlpha, Math.PI / 2.9, nextRadius, nextTarget.x, nextTarget.y, nextTarget.z);
  }, { alpha, radius, target });
  await page.waitForTimeout(250);
}

test.describe('Garden Transit placement', () => {
  test('places four Slides and multiple Conveyors, explains refusals, moves, removes, and saves', async ({ page }) => {
    test.setTimeout(180_000);
    const console_ = collectConsoleErrors(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await waitForDevHooks(page);
    await installBusRecorder(page, [
      'transit:slideBuilt',
      'transit:conveyorBuilt',
      'transit:artifactMoved',
      'transit:artifactRemoved',
      'currency:dewdropsChanged',
      'save:written',
    ]);
    await unlockTransit(page);

    await placeTransitViaBuildMenu(page, 'gardenSlide', GARDEN_SLIDE_TILE);
    await placeTransitViaBuildMenu(page, 'gardenSlide', { x: 8, z: 6 });
    await placeTransitViaBuildMenu(page, 'gardenSlide', { x: 9, z: 6 });
    await placeTransitViaBuildMenu(page, 'gardenSlide', { x: 7, z: 6 });
    for (const tile of [{ x: 7, z: 10 }, { x: 6, z: 10 }, { x: 7, z: 11 }]) {
      await placeTransitViaBuildMenu(page, 'sproutConveyor', tile);
    }

    const toolbar = page.getByRole('toolbar', { name: 'Build menu' });
    const status = toolbar.getByRole('status');
    expect(await status.count()).toBe(1);

    const conveyorButton = toolbar.getByRole('button', { name: /^Sprout Conveyor/ });
    await conveyorButton.click();
    await movePointerToTile(page, { x: 5, z: 10 });
    await expect(status).toContainText('Ready');
    await page.screenshot({ path: 'docs/visual-qa/transit/placement-valid.png' });
    await movePointerToTile(page, NURSERY_TILE);
    await expect(status).toContainText('Nursery');
    await page.screenshot({ path: 'docs/visual-qa/transit/placement-blocked.png' });
    const beforeInvalidEvents = (await getRecordedEvents(page)).length;
    const nurseryPoint = await projectToScreen(page, { x: NURSERY_TILE.x, y: 0, z: NURSERY_TILE.z });
    await page.mouse.click(nurseryPoint.x, nurseryPoint.y);
    await page.waitForTimeout(100);
    const invalidEvents = (await getRecordedEvents(page)).slice(beforeInvalidEvents);
    expect(invalidEvents.some((event) => event.type === 'currency:dewdropsChanged' && event.delta < 0)).toBe(false);
    await page.keyboard.press('Escape');

    // Escape cancels the canvas mode; the menu selection is still available
    // for a deliberate retry, so toggle it off and back on.
    await conveyorButton.click();
    await conveyorButton.click();
    await movePointerToTile(page, GARDEN_SLIDE_TILE);
    await expect(status).toContainText('already holding');
    const occupiedPoint = await projectToScreen(page, { x: GARDEN_SLIDE_TILE.x, y: 0, z: GARDEN_SLIDE_TILE.z });
    await page.mouse.click(occupiedPoint.x, occupiedPoint.y);
    await page.keyboard.press('Escape');

    const conveyorTile = { x: 7, z: 10 };
    const movedConveyorTile = { x: 5, z: 10 };
    const conveyorPoint = await projectToScreen(page, { x: conveyorTile.x, y: 0, z: conveyorTile.z });
    await page.mouse.click(conveyorPoint.x, conveyorPoint.y);
    await page.keyboard.press('m');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await getRecordedEvents(page)).filter((event) => event.type === 'transit:artifactMoved').length).toBe(1);

    const movedPoint = await projectToScreen(page, { x: movedConveyorTile.x, y: 0, z: movedConveyorTile.z });
    await page.mouse.click(movedPoint.x, movedPoint.y);
    await page.keyboard.press('Delete');
    await expect.poll(async () => (await getUiState(page)).transitCounts.sproutConveyor).toBe(2);
    await waitForSaveWritten(page);

    const saved = await readSaveEnvelope(page);
    expect(saved.sim.slides).toHaveLength(4);
    expect(saved.sim.conveyors).toHaveLength(2);
    expect((await getRecordedEvents(page)).some((event) => event.type === 'transit:artifactRemoved')).toBe(true);
    console_.assertNone();
  });

  test('keeps build controls and keyboard targets usable at 390px', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await waitForDevHooks(page);
    await installBusRecorder(page, ['transit:slideBuilt']);
    await unlockTransit(page);
    const toolbar = page.getByRole('toolbar', { name: 'Build menu' });
    const button = toolbar.getByRole('button', { name: /^Garden Slide/ });
    const rect = await button.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return { width: bounds.width, height: bounds.height };
    });
    expect(rect.width).toBeGreaterThanOrEqual(44);
    expect(rect.height).toBeGreaterThanOrEqual(44);
    await placeTransitViaBuildMenu(page, 'gardenSlide', GARDEN_SLIDE_TILE);
    await expect.poll(async () => (await getUiState(page)).transitCounts.gardenSlide).toBe(1);
    await page.screenshot({ path: 'docs/visual-qa/transit/placement-390.png' });
    const slideButton = page.getByRole('toolbar', { name: 'Build menu' }).getByRole('button', { name: /^Garden Slide/ });
    await slideButton.click();
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByRole('toolbar', { name: 'Build menu' }).getByRole('status')).toContainText('path tile');
    await page.screenshot({ path: 'docs/visual-qa/transit/placement-invalid.png' });
  });

  test('shows the Garden Slide silhouette at gameplay and close camera distances', async ({ page }) => {
    test.setTimeout(120_000);
    const console_ = collectConsoleErrors(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await waitForDevHooks(page);
    await installBusRecorder(page);
    await unlockTransit(page);
    await placeTransitViaBuildMenu(page, 'gardenSlide', GARDEN_SLIDE_TILE);
    await page.locator('.tt-debug-panel').evaluate((element) => element.remove());

    await frameGardenSlide(page, 8.5, { x: GARDEN_SLIDE_TILE.x, y: 0, z: GARDEN_SLIDE_TILE.z });
    await page.screenshot({ path: 'docs/visual-qa/transit/slide-after.png' });
    await frameGardenSlide(page, 6.5, { x: GARDEN_SLIDE_TILE.x, y: 0, z: GARDEN_SLIDE_TILE.z });
    await page.screenshot({ path: 'docs/visual-qa/transit/slide-adjacent-pod.png' });
    await frameGardenSlide(page, 7.5, { x: GARDEN_SLIDE_TILE.x, y: 0, z: GARDEN_SLIDE_TILE.z }, -Math.PI / 4);
    await page.screenshot({ path: 'docs/visual-qa/transit/slide-angle.png' });

    await page.evaluate(() => { document.documentElement.style.filter = 'grayscale(1)'; });
    await page.screenshot({ path: 'docs/visual-qa/transit/slide-desaturated.png' });
    await page.evaluate(() => { document.documentElement.style.filter = ''; });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(250);
    await page.screenshot({ path: 'docs/visual-qa/transit/slide-390.png' });
    console_.assertNone();
  });
});
