import { expect, test, type Page } from '@playwright/test';

import {
  collectConsoleErrors,
  debugSpawnAndGetId,
  emitDropped,
  getUiState,
  installBusRecorder,
  waitForDevHooks,
} from './helpers';

async function unlockTransit(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const debug = window as unknown as { __terrariumDebug: { grantDewdrops: (amount: number) => Promise<void> } };
    await debug.__terrariumDebug.grantDewdrops(5_000);
  });
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

async function sampleFrameP95(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const samples: number[] = [];
    let previous = performance.now();
    for (let i = 0; i < 60; i += 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const now = performance.now();
      if (i > 0) samples.push(now - previous);
      previous = now;
    }
    samples.sort((a, b) => a - b);
    return samples[Math.floor(samples.length * 0.95)] ?? 0;
  });
}

async function placeTransitForVisualCap(
  page: Page,
  slides: Array<{ x: number; z: number; destination?: string; acceptedKind?: string }>,
  conveyors: Array<{ x: number; z: number }>,
): Promise<void> {
  await page.evaluate(async ({ slides: slidePlacements, conveyors: conveyorPlacements }) => {
    const debug = window as unknown as {
      __terrariumDebug: {
        placeSlide: (placement: {
          tile: { x: number; z: number };
          destination: 'emberNook' | 'dewPond' | 'sunflowerMeadow';
          acceptedKind: 'ember' | 'dew' | 'sun' | 'star' | 'any';
        }) => Promise<void>;
        placeConveyor: (tile: { x: number; z: number }) => Promise<void>;
      };
    };
    for (const slide of slidePlacements) {
      await debug.__terrariumDebug.placeSlide({
        tile: { x: slide.x, z: slide.z },
        destination: (slide.destination ?? 'sunflowerMeadow') as 'emberNook' | 'dewPond' | 'sunflowerMeadow',
        acceptedKind: (slide.acceptedKind ?? 'any') as 'ember' | 'dew' | 'sun' | 'star' | 'any',
      });
    }
    for (const conveyor of conveyorPlacements) await debug.__terrariumDebug.placeConveyor(conveyor);
  }, { slides, conveyors });
}

test('captures transit integration at empty, mid, open-ended route, and low-quality states', async ({ page }) => {
  test.setTimeout(240_000);
  const console_ = collectConsoleErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await waitForDevHooks(page);
  await installBusRecorder(page);
  await unlockTransit(page);
  await hideDebugChrome(page);

  expect(await page.evaluate(() => {
    const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
    return { width: canvas.width, height: canvas.height, clientWidth: canvas.clientWidth, clientHeight: canvas.clientHeight };
  })).toEqual({ width: 1440, height: 900, clientWidth: 1440, clientHeight: 900 });
  await page.screenshot({ path: 'docs/visual-qa/transit/integration-empty.png' });

  await placeTransitForVisualCap(page, [{ x: 8, z: 7, acceptedKind: 'ember', destination: 'emberNook' }], []);
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
  await placeTransitForVisualCap(page, [], routeTiles);
  await expect.poll(async () => (await getUiState(page)).transitCounts.sproutConveyor).toBe(10);
  await page.screenshot({ path: 'docs/visual-qa/transit/integration-mid.png' });

  await placeTransitForVisualCap(page, [
    { x: 9, z: 6 },
    { x: 10, z: 6 },
    { x: 11, z: 6 },
  ], []);
  const extraTiles: Array<{ x: number; z: number }> = [];
  for (let x = 10; x <= 14 && extraTiles.length < 20; x += 1) {
    for (let z = 9; z <= 12 && extraTiles.length < 20; z += 1) extraTiles.push({ x, z });
  }
  await placeTransitForVisualCap(page, [], extraTiles);
  await expect.poll(async () => (await getUiState(page)).transitCounts.gardenSlide).toBe(4);
  await expect.poll(async () => (await getUiState(page)).transitCounts.sproutConveyor).toBeGreaterThanOrEqual(30);
  await page.waitForTimeout(2_000);
  expect(await page.evaluate(() => {
    const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
    return { width: canvas.width, height: canvas.height };
  })).toEqual({ width: 1440, height: 900 });
  const highFrameP95 = await sampleFrameP95(page);
  expect(highFrameP95).toBeLessThan(100);
  await frame(page, { x: 7, z: 8 }, 9.2);
  await page.screenshot({ path: 'docs/visual-qa/transit/integration-at-cap.png' });

  const debug = page.locator('canvas');
  expect(await debug.count()).toBe(1);
  await page.evaluate(() => {
    const hooks = window.__debug as unknown as { setQuality: (level: 'high' | 'low') => string };
    hooks.setQuality('low');
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => {
    const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
    return { width: canvas.width, height: canvas.height };
  })).toEqual({ width: 390, height: 844 });
  await frame(page, { x: 7, z: 8 }, 8.8);
  const lowFrameP95 = await sampleFrameP95(page);
  expect(lowFrameP95).toBeLessThan(100);
  await page.screenshot({ path: 'docs/visual-qa/transit/integration-low-tier.png' });
  console.log(`transit cap frame p95: high=${highFrameP95.toFixed(2)}ms low=${lowFrameP95.toFixed(2)}ms`);
  console_.assertNone();
});
