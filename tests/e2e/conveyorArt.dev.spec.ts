import { expect, test, type Page } from '@playwright/test';

import {
  collectConsoleErrors,
  debugSpawnAndGetId,
  emitDropped,
  getUiState,
  grantDewdrops,
  installBusRecorder,
  placeTransitViaBuildMenu,
  readSaveEnvelope,
  waitForDevHooks,
} from './helpers';
import { GARDEN_SLIDE_TILE } from '../../src/sim/layout';

async function unlockTransit(page: Page): Promise<void> {
  await grantDewdrops(page, 40);
  const drops = [
    ...Array.from({ length: 7 }, () => ['ember', 'emberNook'] as const),
    ...Array.from({ length: 7 }, () => ['dew', 'dewPond'] as const),
    ...Array.from({ length: 6 }, () => ['sun', 'sunflowerMeadow'] as const),
  ];
  for (const [sproutType, habitat] of drops) {
    const id = await debugSpawnAndGetId(page, sproutType);
    await emitDropped(page, id, habitat);
  }
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

test('renders a ten-segment grown Conveyor route with readable joins', async ({ page }) => {
  test.setTimeout(180_000);
  const console_ = collectConsoleErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await waitForDevHooks(page);
  await installBusRecorder(page);
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
    { x: 6, z: 4 },
    { x: 6, z: 3 },
    { x: 7, z: 3 },
    { x: 7, z: 4 },
  ];
  for (const tile of routeTiles) await placeTransitViaBuildMenu(page, 'sproutConveyor', tile);
  await expect.poll(async () => (await readSaveEnvelope(page)).sim.conveyors.length, { timeout: 15_000 }).toBe(10);
  await hideDebugChrome(page);

  await frame(page, { x: 6, z: 5 }, 8);
  await page.screenshot({ path: 'docs/visual-qa/transit/conveyor-ten-segment.png' });

  await frame(page, { x: 5, z: 5 }, 4.2);
  await page.screenshot({ path: 'docs/visual-qa/transit/conveyor-corner.png' });

  await frame(page, { x: 8, z: 6 }, 3.2);
  await page.screenshot({ path: 'docs/visual-qa/transit/conveyor-straight.png' });
  await page.screenshot({ path: 'docs/visual-qa/transit/conveyor-joint-closeup.png', clip: { x: 400, y: 170, width: 640, height: 520 } });

  await page.evaluate(() => { document.documentElement.style.filter = 'grayscale(1)'; });
  await page.screenshot({ path: 'docs/visual-qa/transit/conveyor-desaturated.png' });
  await page.evaluate(() => { document.documentElement.style.filter = ''; });

  await page.setViewportSize({ width: 390, height: 844 });
  await frame(page, { x: 6, z: 5 }, 7.2);
  await expect(page.locator('canvas')).toBeVisible();
  await page.screenshot({ path: 'docs/visual-qa/transit/conveyor-mobile.png' });
  console_.assertNone();
});
