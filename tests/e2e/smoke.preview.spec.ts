import { expect, test } from '@playwright/test';

// Trivial smoke test so `npm run test:e2e` (preview project) has something to
// run against the production build. Subagent G (phase 4) owns the real specs,
// including the debug-panel-absent assertions this project is meant for.
test('production preview boots and mounts the game canvas with no console errors', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/');
  await expect(page.locator('#game-canvas')).toBeVisible({ timeout: 15_000 });

  expect(pageErrors).toEqual([]);
});
