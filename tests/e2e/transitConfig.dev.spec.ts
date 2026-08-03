import { expect, test, type Page } from '@playwright/test';

import {
  collectConsoleErrors,
  getUiState,
  installBusRecorder,
  placeTransitViaBuildMenu,
  projectToScreen,
  readSaveEnvelope,
  waitForDevHooks,
} from './helpers';
import { GARDEN_SLIDE_TILE } from '../../src/render/layout';

async function unlockSlide(page: Page): Promise<void> {
  await page.evaluate(async () => {
    for (let i = 0; i < 40; i += 1) {
      (document.querySelector('[data-testid="debug-grant-dewdrops"]') as HTMLButtonElement).click();
    }
    const drops = [
      ...Array.from({ length: 7 }, () => ['ember', 'emberNook'] as const),
      ...Array.from({ length: 7 }, () => ['dew', 'dewPond'] as const),
      ...Array.from({ length: 6 }, () => ['sun', 'sunflowerMeadow'] as const),
    ];
    for (const [sproutType, habitat] of drops) {
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
  });
  await expect.poll(async () => (await getUiState(page)).unlockedAutomations, { timeout: 20_000 }).toContain('gardenSlide');
}

test('configures a Slide by keyboard with live preview, status copy, contrast, and mobile evidence', async ({ page }) => {
  test.setTimeout(120_000);
  const console_ = collectConsoleErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await waitForDevHooks(page);
  await installBusRecorder(page, ['transit:slideBuilt', 'transit:slideConfigured', 'save:written']);
  await unlockSlide(page);
  await placeTransitViaBuildMenu(page, 'gardenSlide', GARDEN_SLIDE_TILE);
  const slidePoint = await projectToScreen(page, { x: GARDEN_SLIDE_TILE.x, y: 0, z: GARDEN_SLIDE_TILE.z });
  await page.mouse.click(slidePoint.x, slidePoint.y);

  const rules = page.getByRole('region', { name: 'Transit rules' });
  await expect(rules.getByRole('button', { name: 'Move Garden Slide 1' })).toBeVisible();
  await expect(rules.getByRole('button', { name: 'Pause Garden Slide 1' })).toBeVisible();
  await expect(rules.getByRole('button', { name: 'Delete Garden Slide 1' })).toBeVisible();
  await rules.getByRole('button', { name: /Transit rules/ }).click();
  await rules.getByLabel('Garden Slide 1 destination').selectOption('emberNook');
  await rules.getByRole('button', { name: 'Apply changes' }).click();
  await expect.poll(async () => (await readSaveEnvelope(page)).sim.slides[0]?.destination).toBe('emberNook');

  await rules.getByRole('button', { name: 'Move Garden Slide 1' }).click();
  for (let i = 0; i < 5; i += 1) await page.locator('body').press('ArrowDown');
  await page.locator('body').press('Enter');
  await expect.poll(async () => (await readSaveEnvelope(page)).sim.slides[0]?.tile).toEqual({ x: 8, z: 12 });
  const rotatedSlide = await page.evaluate(() => (window.__debug as unknown as { meshInfo: (name: string) => { rotationY: number } | null }).meshInfo('terrarium.transit.gardenSlide.slide-1'));
  expect(rotatedSlide?.rotationY).toBe(3.1416);

  const movedSlidePoint = await projectToScreen(page, { x: 8, y: 0, z: 12 });
  await page.mouse.click(movedSlidePoint.x, movedSlidePoint.y);

  await expect(rules.getByRole('button', { name: /Transit rules/ })).toBeVisible();
  await rules.getByRole('button', { name: /Transit rules/ }).press('Enter');
  const destination = rules.getByLabel('Garden Slide 1 destination');
  await destination.focus();
  await destination.selectOption('dewPond');
  await expect(rules.getByRole('status')).toContainText('Preview → Dew Pond');
  await page.screenshot({ path: 'docs/visual-qa/transit/config-keyboard-focus.png' });

  const previewMeshes = await page.evaluate(() => (window.__debug as unknown as { meshNames: (filter: string) => string[] }).meshNames('slide-1.preview'));
  expect(previewMeshes.length).toBeGreaterThan(0);
  const apply = rules.getByRole('button', { name: 'Apply changes' });
  await apply.focus();
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await readSaveEnvelope(page)).sim.slides[0]?.destination, { timeout: 10_000 }).toBe('dewPond');
  await expect(page.getByText('Ready for Any Sprout · route points toward Dew Pond')).toBeVisible();
  await page.screenshot({ path: 'docs/visual-qa/transit/config-panel.png' });

  await rules.getByRole('button', { name: /Transit rules/ }).click();
  await page.screenshot({ path: 'docs/visual-qa/transit/config-in-world.png' });
  await page.evaluate(() => { document.documentElement.style.filter = 'grayscale(1)'; });
  await page.screenshot({ path: 'docs/visual-qa/transit/config-desaturated.png' });
  await page.evaluate(() => { document.documentElement.style.filter = ''; document.documentElement.dataset.contrast = 'high'; });
  await page.screenshot({ path: 'docs/visual-qa/transit/config-high-contrast.png' });

  await page.locator('.tt-debug-panel').evaluate((element) => element.remove());
  await page.locator('.tt-toast-region').evaluate((element) => element.remove());
  await page.locator('.tt-nursery-note').evaluate((element) => element.remove());
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => { document.documentElement.style.filter = ''; document.documentElement.dataset.contrast = 'normal'; });
  const mobileNavIcons = await page.locator('.tt-nav-btn:not([hidden]) .tt-nav-icon svg').evaluateAll((icons) => icons.map((icon) => {
    const rect = icon.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  }));
  expect(mobileNavIcons.length).toBeGreaterThan(0);
  expect(mobileNavIcons.every(({ width, height }) => width > 0 && height > 0)).toBe(true);
  await rules.getByRole('button', { name: /Transit rules/ }).click();
  await expect(rules.getByLabel('Garden Slide 1 destination')).toBeVisible();
  await page.screenshot({ path: 'docs/visual-qa/transit/config-390.png' });
  console_.assertNone();
});
