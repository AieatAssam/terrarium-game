import { expect, test } from '@playwright/test';

// Trivial smoke test so `npm run test:e2e` (dev project) has something to run
// against Phase 1's scaffold. Subagent G (phase 4) owns the real specs and
// will add *.dev.spec.ts / *.preview.spec.ts files alongside this one.
test('dev server boots and mounts the game canvas with no console errors', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/');
  await expect(page.locator('#game-canvas')).toBeVisible({ timeout: 15_000 });

  expect(pageErrors).toEqual([]);
});
