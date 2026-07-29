import { expect, test } from '@playwright/test';
import { collectConsoleErrors, dragNurseryToHabitat, getUiState, installBusRecorder, waitForDevHooks } from './helpers';

test.describe('reduced motion', () => {
  test('prefers-reduced-motion is honored on <html> and the game still fully functions', async ({ page }) => {
    const console_ = collectConsoleErrors(page);

    // Must be set before navigation: src/ui/prefs.ts's defaultReducedMotion()
    // reads matchMedia('(prefers-reduced-motion: reduce)') once, the first
    // time loadPrefs() runs with nothing in localStorage yet (a fresh
    // Playwright context has none) — that happens synchronously during
    // mountUI's settings-panel construction at page load.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await waitForDevHooks(page);
    await installBusRecorder(page, ['sprout:placed:correct', 'sprout:settled']);

    // src/ui/prefs.ts's reflectPrefsToDocument is the hook src/render reads
    // (per its own comment: "other owners can read player preference
    // without importing anything from src/ui").
    await expect
      .poll(async () => page.evaluate(() => document.documentElement.dataset.reducedMotion))
      .toBe('true');

    // Functional check: the core placement loop still works end to end
    // under reduced motion (no dependency on any tween/animation completing).
    await page.click('[data-testid="debug-spawn-ember"]');
    await dragNurseryToHabitat(page, 'emberNook');
    await page.waitForFunction(
      () => window.__ttEvents?.some((e) => e.type === 'sprout:placed:correct') ?? false,
      undefined,
      { timeout: 5_000 },
    );
    const state = await getUiState(page);
    expect(state.journalDiscovered).toEqual(['ember']);

    console_.assertNone();
  });

  test('without the reduced-motion media query, the document defaults to reducedMotion=false', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('/');
    await waitForDevHooks(page);
    await expect
      .poll(async () => page.evaluate(() => document.documentElement.dataset.reducedMotion))
      .toBe('false');
  });
});
