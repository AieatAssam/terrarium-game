import { expect, test, type Page } from '@playwright/test';
import {
  collectConsoleErrors,
  getRecordedEvents,
  getUiState,
  installBusRecorder,
  placeTransitViaBuildMenu,
  projectToScreen,
  waitForDevHooks,
} from './helpers';

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
      const id = (window.__ttSpawnedIds ?? []).slice(before).find((entry) => entry.podId === 'debug')?.id;
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

async function selectTile(page: Page, tile: { x: number; z: number }): Promise<void> {
  const point = await projectToScreen(page, { x: tile.x, y: 0, z: tile.z });
  await page.mouse.click(point.x, point.y);
}

async function spawnDebug(page: Page, sproutType: 'ember' | 'dew' | 'sun'): Promise<string> {
  const before = await page.evaluate(() => window.__ttSpawnedIds?.length ?? 0);
  await page.locator(`[data-testid="debug-spawn-${sproutType}"]`).click({ force: true });
  await expect.poll(async () => (await page.evaluate(() => window.__ttSpawnedIds?.length ?? 0))).toBeGreaterThan(before);
  const id = await page.evaluate((start) => {
    const list = window.__ttSpawnedIds ?? [];
    for (let index = list.length - 1; index >= start; index -= 1) {
      if (list[index].podId === 'debug') return list.splice(index, 1)[0].id;
    }
    return undefined;
  }, before);
  if (!id) throw new Error('debug spawn did not record');
  return id;
}

async function ensureSlideRide(page: Page, beforeCount: number, sproutType: 'ember' | 'dew' | 'sun'): Promise<string> {
  const startedCount = (await getRecordedEvents(page)).filter((event) => event.type === 'sprout:transportStarted').length;
  if (startedCount <= beforeCount) await spawnDebug(page, sproutType);
  await expect.poll(async () => (await getRecordedEvents(page)).filter((event) => event.type === 'sprout:transportStarted').length, { timeout: 15_000 }).toBeGreaterThan(beforeCount);
  const started = (await getRecordedEvents(page)).filter((event) => event.type === 'sprout:transportStarted')[beforeCount];
  if (!started || started.type !== 'sprout:transportStarted') throw new Error('Garden Slide ride did not start');
  return started.sproutId;
}

async function startSafetyPage(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await waitForDevHooks(page);
  await installBusRecorder(page, ['sprout:transportStarted', 'sprout:transportReturned', 'save:written']);
  await unlockSlide(page);
}

test('returns a Sprout safely when its Slide is removed mid-ride', async ({ page }) => {
  test.setTimeout(150_000);
  const console_ = collectConsoleErrors(page);
  await startSafetyPage(page);
  const startsBeforeRemoval = (await getRecordedEvents(page)).filter((event) => event.type === 'sprout:transportStarted').length;
  await placeTransitViaBuildMenu(page, 'gardenSlide', { x: 8, z: 7 }, { acceptedKind: 'ember', destination: 'emberNook' });
  const removalPassenger = await ensureSlideRide(page, startsBeforeRemoval, 'ember');
  await selectTile(page, { x: 8, z: 7 });
  await page.keyboard.press('Delete');
  await expect.poll(async () => (await getRecordedEvents(page)).some((event) => event.type === 'sprout:transportReturned' && event.sproutId === removalPassenger && event.reason === 'removed')).toBe(true);
  const rules = page.getByRole('region', { name: 'Transit rules' });
  await rules.getByRole('button', { name: /Transit rules/ }).click();
  await expect(rules).toContainText('safely returned');
  await page.screenshot({ path: 'docs/visual-qa/transit/safety-mid-ride-removal.png' });
  console_.assertNone();
});

test('returns a Sprout safely when its Slide is disabled mid-ride', async ({ page }) => {
  test.setTimeout(150_000);
  const console_ = collectConsoleErrors(page);
  await startSafetyPage(page);
  const startsBefore = (await getRecordedEvents(page)).filter((event) => event.type === 'sprout:transportStarted').length;
  await placeTransitViaBuildMenu(page, 'gardenSlide', { x: 8, z: 7 }, { acceptedKind: 'dew', destination: 'dewPond' });
  const passenger = await ensureSlideRide(page, startsBefore, 'dew');
  await page.evaluate(() => {
    const panel = document.querySelector('.tt-transit-panel');
    (panel?.querySelector('.tt-transit-panel-toggle') as HTMLButtonElement)?.click();
    const enabled = panel?.querySelector('[data-transit-focus="slide-1-enabled"]') as HTMLInputElement | null;
    if (!enabled) throw new Error('Slide enabled control missing');
    enabled.checked = false;
    enabled.dispatchEvent(new Event('change', { bubbles: true }));
    (panel?.querySelector('.tt-transit-apply') as HTMLButtonElement)?.click();
  });
  await expect.poll(async () => (await getRecordedEvents(page)).some((event) => event.type === 'sprout:transportReturned' && event.sproutId === passenger && event.reason === 'disabled')).toBe(true);
  const rules = page.getByRole('region', { name: 'Transit rules' });
  await expect(rules).toContainText('paused');
  await page.screenshot({ path: 'docs/visual-qa/transit/safety-disabled.png' });
  console_.assertNone();
});
