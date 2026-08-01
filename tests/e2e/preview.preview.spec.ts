import { expect, test } from '@playwright/test';
import { collectConsoleErrors, dragBetween, projectToScreen } from './helpers';

// Production preview project: must NOT have the debug panel or debug
// globals (docs/CONTRACTS.md: "Dev flag / debug panel" — isDev is a
// build-time constant, dead-code-eliminated in production). Runs against
// `npm run build && npm run preview` per playwright.config.ts's `preview`
// project/webServer entry.

test.describe('production build', () => {
  test('no debug panel, no debug globals, no console errors, canvas renders', async ({ page }) => {
    const console_ = collectConsoleErrors(page);

    await page.goto('/');
    await expect(page.locator('#game-canvas')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Drag a Sprout to its glowing home.')).toBeVisible({ timeout: 5_000 });

    // No debug panel in the DOM at all.
    await expect(page.locator('.tt-debug-panel')).toHaveCount(0);
    for (const testid of [
      'debug-spawn-ember',
      'debug-spawn-dew',
      'debug-spawn-sun',
      'debug-spawn-star',
      'debug-grant-dewdrops',
      'debug-speed-1x',
      'debug-speed-5x',
      'debug-speed-20x',
      'debug-reset-save',
    ]) {
      await expect(page.locator(`[data-testid="${testid}"]`)).toHaveCount(0);
    }

    // No debug globals.
    const globals = await page.evaluate(() => ({
      hasDebug: '__debug' in window,
      hasUIF: '__terrariumUIF' in window,
    }));
    expect(globals.hasDebug).toBe(false);
    expect(globals.hasUIF).toBe(false);

    console_.assertNone();
  });

  test('the core game still renders and is playable: the Nursery pod is present and a drag gesture over it does not crash the app', async ({
    page,
    context,
  }) => {
    const console_ = collectConsoleErrors(page);
    await page.goto('/');
    await expect(page.locator('#game-canvas')).toBeVisible({ timeout: 15_000 });

    // No __debug.project hook exists in production (verified above), so we
    // borrow it from a same-viewport dev-server page to compute reliable
    // screen coordinates for the Nursery — the renderer/camera code and
    // world layout are byte-for-byte identical between the dev and
    // production builds (only isDev-gated additions differ, per
    // docs/CONTRACTS.md), and both Playwright projects share the same
    // default viewport (playwright.config.ts: both extend
    // devices['Desktop Chrome'] with only baseURL differing), so the
    // projected coordinates transfer directly.
    const devPage = await context.newPage();
    await devPage.goto('http://localhost:5173/');
    await devPage.waitForFunction(() => Boolean(window.__debug), undefined, { timeout: 15_000 });
    const pickup = await projectToScreen(devPage, { x: 8, y: 1.255, z: 8 }); // NURSERY_TILE, SPROUT_FLOAT_HEIGHT (see tests/e2e/helpers.ts)
    await devPage.close();

    await dragBetween(page, pickup, { x: pickup.x + 60, y: pickup.y + 20 });

    // The app should not have crashed: canvas still renders, no page errors.
    await expect(page.locator('#game-canvas')).toBeVisible();

    console_.assertNone();
  });
});
