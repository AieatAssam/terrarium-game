import { expect, test } from '@playwright/test';
import {
  collectConsoleErrors,
  dragBetween,
  getRecordedEvents,
  installBusRecorder,
  nurseryPickupScreenPoint,
  waitForDevHooks,
} from './helpers';

test.describe('first load', () => {
  test('canvas renders, onboarding is visible, and the first Sprout appears and is draggable', async ({ page }) => {
    const console_ = collectConsoleErrors(page);

    await page.goto('/');

    await expect(page.locator('#game-canvas')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Drag a Sprout to its glowing home.')).toBeVisible({ timeout: 5_000 });

    await waitForDevHooks(page);
    await installBusRecorder(page, ['sprout:pickedUp']);

    // Docs/GAME_DESIGN.md's beat sheet documents the very first pod spawning
    // "close to scene-ready", within a "~0:05-0:12" window, and the base pod
    // spawn interval (src/data/spawning.ts BASE_POD_SPAWN_INTERVAL_MS) is
    // exactly 12_000ms with the spawn accumulator starting at 0 (see
    // src/sim/state.ts createInitialSimState) — so on a brand-new save the
    // very first natural spawn lands right at the far edge of that
    // documented window (~12s), not sooner. Waiting here reflects that
    // observed, documented behavior rather than a stricter "a few seconds"
    // reading the current implementation doesn't actually deliver on a
    // fresh save (see docs/QA_REPORT.md for this observation).
    const spawned = await page.evaluate(() => {
      return new Promise<{ sproutType: string }>((resolve) => {
        const unsub = window.__terrariumUIF!.bus.subscribe('sprout:spawned', (e) => {
          unsub();
          resolve({ sproutType: e.sproutType });
        });
      });
    });
    expect(['ember', 'dew', 'sun', 'star']).toContain(spawned.sproutType);

    // "Draggable" is the actual requirement, not just "spawned" — perform a
    // real pointer pick-up (dragging off to open ground, no habitat drop)
    // and confirm the app recognizes it as a genuine drag start.
    const pickup = await nurseryPickupScreenPoint(page);
    await dragBetween(page, pickup, { x: pickup.x + 40, y: pickup.y + 10 });
    const events = await getRecordedEvents(page);
    expect(events.some((e) => e.type === 'sprout:pickedUp')).toBe(true);

    console_.assertNone();
  });
});
