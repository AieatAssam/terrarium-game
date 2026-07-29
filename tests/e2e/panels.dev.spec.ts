import { expect, test } from '@playwright/test';
import { collectConsoleErrors, waitForDevHooks } from './helpers';

test.describe('nav panels: Journal, Settings, Credits', () => {
  test('Journal opens with 12 total slots (4 discoverable) and closes via Escape', async ({ page }) => {
    const console_ = collectConsoleErrors(page);
    await page.goto('/');
    await waitForDevHooks(page);

    await page.getByRole('button', { name: 'Journal' }).click();
    const dialog = page.getByRole('dialog', { name: 'Garden Journal' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/of 12 discovered/)).toBeVisible();
    await expect(dialog.getByText('Not yet discovered').first()).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    console_.assertNone();
  });

  test('Settings opens with music/sfx/mute/reduced-motion/high-contrast controls and closes via Escape', async ({ page }) => {
    const console_ = collectConsoleErrors(page);
    await page.goto('/');
    await waitForDevHooks(page);

    await page.getByRole('button', { name: 'Settings' }).click();
    const dialog = page.getByRole('dialog', { name: 'Settings' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('Music volume')).toBeVisible();
    await expect(dialog.getByLabel('Sound effects volume')).toBeVisible();
    await expect(dialog.getByRole('switch', { name: 'Mute all audio' })).toBeVisible();
    await expect(dialog.getByRole('switch', { name: 'Reduced motion' })).toBeVisible();
    await expect(dialog.getByRole('switch', { name: 'High contrast' })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    console_.assertNone();
  });

  test('Credits opens and lists the truthful "original, synthesized in-repo" audio credit, and closes via Escape', async ({ page }) => {
    const console_ = collectConsoleErrors(page);
    await page.goto('/');
    await waitForDevHooks(page);

    await page.getByRole('button', { name: 'Credits' }).click();
    const dialog = page.getByRole('dialog', { name: 'Credits' });
    await expect(dialog).toBeVisible();
    // Both the art and audio credit lines legitimately contain "original" —
    // assert the specific audio-credit line rather than an ambiguous match.
    await expect(dialog.getByText(/music and sound effects are original, synthes/i)).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    console_.assertNone();
  });
});

test.describe('keyboard-only flow', () => {
  test('Tab reaches a nav button with a visible focus state; Enter opens its panel; Escape closes it and restores focus', async ({
    page,
  }) => {
    const console_ = collectConsoleErrors(page);
    await page.goto('/');
    await waitForDevHooks(page);

    const upgradesButton = page.getByRole('button', { name: 'Upgrades' });

    // Tab from the top of the document until the Upgrades nav button has
    // focus (the onboarding dismiss button precedes it in DOM order, so more
    // than one Tab press may be needed).
    let focused = false;
    for (let i = 0; i < 10 && !focused; i += 1) {
      await page.keyboard.press('Tab');
      focused = await upgradesButton.evaluate((el) => el === document.activeElement);
    }
    expect(focused).toBe(true);
    await expect(upgradesButton).toBeFocused();

    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Upgrades' });
    await expect(dialog).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    // Focus is restored to the trigger button on close (src/ui/panel.ts).
    await expect(upgradesButton).toBeFocused();

    console_.assertNone();
  });
});
