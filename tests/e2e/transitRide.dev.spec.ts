import { expect, test, type Page } from '@playwright/test';

import {
  collectConsoleErrors,
  debugSpawnAndGetId,
  getRecordedEvents,
  getUiState,
  installBusRecorder,
  placeTransitViaBuildMenu,
  waitForDevHooks,
} from './helpers';
import { GARDEN_SLIDE_TILE } from '../../src/render/layout';

async function unlockSlide(page: Page): Promise<void> {
  const drops = [
    ...Array.from({ length: 7 }, () => ['ember', 'emberNook'] as const),
    ...Array.from({ length: 7 }, () => ['dew', 'dewPond'] as const),
    ...Array.from({ length: 6 }, () => ['sun', 'sunflowerMeadow'] as const),
  ] as const;
  await page.evaluate(async (items) => {
    for (let i = 0; i < 12; i += 1) {
      (document.querySelector('[data-testid="debug-spawn-dew"]') as HTMLButtonElement).click();
      await Promise.resolve();
    }
    for (let i = 0; i < 40; i += 1) {
      (document.querySelector('[data-testid="debug-grant-dewdrops"]') as HTMLButtonElement).click();
    }
    for (const [sproutType, habitat] of items) {
      const before = window.__ttSpawnedIds?.length ?? 0;
      (document.querySelector(`[data-testid="debug-spawn-${sproutType}"]`) as HTMLButtonElement).click();
      await Promise.resolve();
      const spawned = window.__ttSpawnedIds ?? [];
      const id = spawned.slice(before).find((entry) => entry.podId === 'debug')?.id;
      if (!id) throw new Error('debug spawn did not record');
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

async function frameRide(page: Page): Promise<void> {
  await page.evaluate((tile) => {
    const debug = window.__debug as unknown as {
      qaCamera: (alpha: number, beta: number, radius: number, targetX: number, targetY: number, targetZ: number) => void;
    };
    debug.qaCamera(-Math.PI * 0.75, Math.PI / 2.9, 3.8, tile.x, 0.25, tile.z);
  }, GARDEN_SLIDE_TILE);
  await page.waitForTimeout(50);
}

test('shows a Sprout entering, riding, and leaving a Garden Slide, including reduced motion', async ({ page }) => {
  test.setTimeout(120_000);
  const console_ = collectConsoleErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await waitForDevHooks(page);
  await installBusRecorder(page, ['sprout:transportStarted', 'sprout:transportCompleted', 'transit:slideBuilt']);
  await unlockSlide(page);
  await placeTransitViaBuildMenu(page, 'gardenSlide', GARDEN_SLIDE_TILE, { acceptedKind: 'star' });

  const seen = 0;
  const rideMonitor = page.evaluate(async (seenBefore) => {
    const debug = window.__debug as unknown as { meshInfo: (name: string) => { pos: number[] } | null | undefined };
    const deadline = performance.now() + 15_000;
    while (performance.now() < deadline) {
      const started = (window.__ttEvents ?? []).filter((event) => event.type === 'sprout:transportStarted');
      if (started.length > seenBefore) {
        const event = started[seenBefore];
        if (!event || event.type !== 'sprout:transportStarted') throw new Error('ride event missing');
        const positions: Array<[number, number, number]> = [];
        while (performance.now() < deadline) {
          const info = debug.meshInfo(`terrarium.sprout.${event.sproutId}`);
          if (info) positions.push([info.pos[0], info.pos[1], info.pos[2]]);
          if ((window.__ttEvents ?? []).some((candidate) => candidate.type === 'sprout:transportCompleted' && candidate.sproutId === event.sproutId)) {
            return { sproutId: event.sproutId, durationMs: event.durationMs, positions };
          }
          await new Promise((resolve) => setTimeout(resolve, 80));
        }
        return { sproutId: event.sproutId, durationMs: event.durationMs, positions };
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error('ride event timeout');
  }, seen);
  const started = page.waitForFunction(
    (count) => (window.__ttEvents ?? []).filter((event) => event.type === 'sprout:transportStarted').length > count,
    seen,
    { timeout: 15_000 },
  );
  await page.click('[data-testid="debug-speed-1x"]');
  const passengerId = await debugSpawnAndGetId(page, 'star');
  await started;
  await frameRide(page);
  const startedEvent = (await getRecordedEvents(page)).find((event) => event.type === 'sprout:transportStarted');
  if (!startedEvent || startedEvent.type !== 'sprout:transportStarted') throw new Error('ride event missing');
  expect(startedEvent.sproutId).toBe(passengerId);
  await page.locator('.tt-debug-panel').evaluate((element) => element.remove());
  await page.locator('.tt-toast-region').evaluate((element) => element.remove());
  await page.locator('.tt-nursery-note').evaluate((element) => element.remove());
  await page.screenshot({ path: 'docs/visual-qa/transit/ride-entry.png' });
  await page.waitForTimeout(450);
  await page.screenshot({ path: 'docs/visual-qa/transit/ride-mid.png' });
  await page.waitForTimeout(450);
  await page.screenshot({ path: 'docs/visual-qa/transit/ride-exit.png' });
  const monitored = await rideMonitor;
  const positions = monitored.positions;
  expect(positions.length).toBeGreaterThan(3);
  const channel = positions.find(([x, , z]) => Math.abs(x - GARDEN_SLIDE_TILE.x) < 0.1 && z < 7.44 && z > 6.56);
  expect(monitored.sproutId).toBe(passengerId);
  expect(channel, 'the Sprout reaches the authored raised Slide channel').toBeDefined();
  expect(channel![1], 'the channel ride height stays close to the Slide belt').toBeLessThan(1.05);

  const events = await getRecordedEvents(page);
  expect(events.some((event) => event.type === 'sprout:transportStarted' && event.automationId === 'gardenSlide')).toBe(true);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForTimeout(350);
  await page.screenshot({ path: 'docs/visual-qa/transit/ride-reduced-motion.png' });
  await expect.poll(async () => (await getRecordedEvents(page)).filter((event) => event.type === 'sprout:transportCompleted').length, { timeout: 15_000 }).toBeGreaterThanOrEqual(1);
  console_.assertNone();
});
