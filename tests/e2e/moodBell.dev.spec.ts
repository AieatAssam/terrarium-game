// The Mood Bell — a third automation, GameRules §9.5/§7.3/§9.6 stage 4.
// Mirrors automation.dev.spec.ts's style but scoped around grantDewdrops +
// debug shortcuts rather than the full organic unlock chain (this session's
// own work_progress.yaml documents the Playwright sandbox degrading to 90s
// timeouts on tests that took 34s earlier the same session — a spec that
// re-derives Slide-unlock + Gate's 30s behavioral feed + both purchases
// organically would be slow and flaky here).

import { expect, test, type Page } from '@playwright/test';
import {
  buyUpgradeViaUI,
  collectConsoleErrors,
  getRecordedEvents,
  getUiState,
  grantDewdrops,
  installBusRecorder,
  spawnAndDrop,
  waitForDevHooks,
} from './helpers';
import { HABITAT_TILES, NURSERY_TILE } from '../../src/render/layout';
import { UPGRADES } from '../../src/data/upgrades';
import type { MoodId, SproutTypeId } from '../../src/core/ids';
import type { GameEvent } from '../../src/events/types';

/** Mirrors automation.dev.spec.ts's own helper — derives the click count from the live price rather than hardcoding one. */
async function grantUntilAffordable(page: Page, target: number): Promise<void> {
  for (let i = 0; i < 60; i += 1) {
    if ((await getUiState(page)).dewdropTotal >= target) return;
    await grantDewdrops(page, 1);
  }
  throw new Error(`could not reach ${target} Dewdrops via the debug grant button`);
}

/** Drives the real unlock path to a built Garden Slide (always targets sunflowerMeadow). Mirrors automation.dev.spec.ts's own helper. */
async function buildGardenSlide(page: Page): Promise<void> {
  await grantUntilAffordable(page, UPGRADES.habitatCapacity.costForLevel(1));
  await buyUpgradeViaUI(page, 'Habitat Capacity');
  await expect.poll(async () => (await getUiState(page)).upgradeLevels.habitatCapacity).toBe(1);
  for (let i = 0; i < 10; i += 1) await spawnAndDrop(page, 'ember', 'emberNook');
  for (let i = 0; i < 10; i += 1) await spawnAndDrop(page, 'sun', 'sunflowerMeadow');
  await expect.poll(async () => (await getUiState(page)).unlockedAutomations, { timeout: 20_000 }).toContain('gardenSlide');
}

/**
 * Builds Garden Slide, then Colour Gate, then Mood Bell — the full prior-
 * automation chain Mood Bell's own unlock requires. Fast-forwards the Gate's
 * 30-real-second behavioral feed via the debug speed control (progression
 * logic, not pointer input, so the fast-path is appropriate per the brief —
 * same justification automation.dev.spec.ts's own Gate-purchase test uses).
 */
async function buildMoodBell(page: Page): Promise<void> {
  await buildGardenSlide(page);

  await page.click('[data-testid="debug-speed-20x"]');
  await page.waitForTimeout(3_000); // >=300 ticks at 20x, well within 3s of real time

  // Unsorted pile for the Gate's own unlock condition: 4 idle (NOT dropped)
  // Sprouts of a type the Slide isn't feeding (it targets sunflowerMeadow/sun).
  for (let i = 0; i < 4; i += 1) await page.click('[data-testid="debug-spawn-dew"]');

  await grantUntilAffordable(page, UPGRADES.colourGateUnlock.costForLevel(1));
  await buyUpgradeViaUI(page, 'Colour Gate');
  await expect.poll(async () => (await getUiState(page)).unlockedAutomations, { timeout: 10_000 }).toContain('colourGate');

  await grantUntilAffordable(page, UPGRADES.moodBellUnlock.costForLevel(1));
  await buyUpgradeViaUI(page, 'Mood Bell');
  await expect.poll(async () => (await getUiState(page)).unlockedAutomations, { timeout: 10_000 }).toContain('moodBell');
}

/**
 * Clicks the debug spawn button for `sproutType` repeatedly (each a real,
 * independent RNG mood draw — see src/data/spawning.ts's pickMood) until one
 * lands with `wantMood`, returning its id. Bounded so a persistent bug (mood
 * always the other value) fails loudly instead of hanging.
 */
async function spawnUntilMood(page: Page, sproutType: SproutTypeId, wantMood: MoodId): Promise<string> {
  for (let i = 0; i < 60; i += 1) {
    const before = await page.evaluate(() => (window.__ttSpawnedIds ?? []).length);
    await page.click(`[data-testid="debug-spawn-${sproutType}"]`);
    await expect.poll(async () => (await page.evaluate(() => (window.__ttSpawnedIds ?? []).length)) > before).toBe(true);
    const events = await getRecordedEvents(page);
    const spawned = events.filter(
      (e): e is Extract<GameEvent, { type: 'sprout:spawned' }> => e.type === 'sprout:spawned' && e.sproutType === sproutType,
    );
    const last = spawned[spawned.length - 1];
    if (last && last.mood === wantMood) return last.sproutId;
  }
  throw new Error(`never got a ${wantMood} ${sproutType} in 60 debug spawns — check pickMood's independence from pickSproutType`);
}

test.describe('Mood Bell: build + safe default', () => {
  test('builds on its own site, with the safe default rule, once both prior automations exist', async ({ page }) => {
    test.slow();
    const console_ = collectConsoleErrors(page);
    await page.goto('/');
    await waitForDevHooks(page);
    await installBusRecorder(page, ['automation:built', 'automation:unlocked', 'automation:moodBellRuleChanged', 'sprout:spawned']);

    await buildMoodBell(page);

    const state = await getUiState(page);
    expect(state.unlockedAutomations).toContain('moodBell');

    const events = await getRecordedEvents(page);
    expect(events).toContainEqual({ type: 'automation:moodBellRuleChanged', mood: 'sunny' });
    expect(events.some((e) => e.type === 'automation:built' && e.automationId === 'moodBell')).toBe(true);

    console_.assertNone();
  });
});

test.describe('Mood Bell: routing (type-agnostic, per-sprout destination)', () => {
  test('carries a matching-mood Sprout of one type straight to its own habitat', async ({ page }) => {
    test.slow();
    const console_ = collectConsoleErrors(page);
    await page.goto('/');
    await waitForDevHooks(page);
    await installBusRecorder(page, ['sprout:transportStarted', 'sprout:settled', 'sprout:spawned']);

    await buildMoodBell(page); // rule defaults to 'sunny'

    const id = await spawnUntilMood(page, 'ember', 'sunny');
    await expect
      .poll(
        async () => (await getRecordedEvents(page)).some((e) => e.type === 'sprout:transportStarted' && e.sproutId === id),
        { timeout: 10_000 },
      )
      .toBe(true);

    const events = await getRecordedEvents(page);
    const leg = events.find((e) => e.type === 'sprout:transportStarted' && e.sproutId === id);
    if (leg?.type !== 'sprout:transportStarted') throw new Error('unreachable');
    expect(leg.automationId).toBe('moodBell');
    expect(leg.toTile).toEqual(HABITAT_TILES.emberNook);
    expect(leg.fromTile).toEqual(NURSERY_TILE); // single leg, not a Gate-style two-leg journey

    await expect
      .poll(async () => (await getRecordedEvents(page)).some((e) => e.type === 'sprout:settled' && e.sproutId === id), {
        timeout: 10_000,
      })
      .toBe(true);

    console_.assertNone();
  });

  test('carries a DIFFERENT type of the same mood to ITS OWN (different) habitat — proves the destination is per-sprout, not fixed at build time', async ({
    page,
  }) => {
    test.slow();
    const console_ = collectConsoleErrors(page);
    await page.goto('/');
    await waitForDevHooks(page);
    await installBusRecorder(page, ['sprout:transportStarted', 'sprout:spawned']);

    await buildMoodBell(page);

    const id = await spawnUntilMood(page, 'dew', 'sunny');
    await expect
      .poll(
        async () => (await getRecordedEvents(page)).some((e) => e.type === 'sprout:transportStarted' && e.sproutId === id),
        { timeout: 10_000 },
      )
      .toBe(true);

    const leg = (await getRecordedEvents(page)).find((e) => e.type === 'sprout:transportStarted' && e.sproutId === id);
    if (leg?.type !== 'sprout:transportStarted') throw new Error('unreachable');
    expect(leg.automationId).toBe('moodBell');
    expect(leg.toTile).toEqual(HABITAT_TILES.dewPond);

    console_.assertNone();
  });

  test('leaves a non-matching-mood Sprout idle — the Bell does not carry it', async ({ page }) => {
    test.slow();
    const console_ = collectConsoleErrors(page);
    await page.goto('/');
    await waitForDevHooks(page);
    await installBusRecorder(page, ['sprout:transportStarted', 'sprout:spawned']);

    await buildMoodBell(page); // rule defaults to 'sunny'

    const id = await spawnUntilMood(page, 'ember', 'sleepy');
    await page.waitForTimeout(1_500); // several ticks — long enough for a wrongful dispatch to have started
    const events = await getRecordedEvents(page);
    expect(events.some((e) => e.type === 'sprout:transportStarted' && e.sproutId === id)).toBe(false);

    console_.assertNone();
  });
});

test.describe('Mood Bell: the traffic partition', () => {
  test('claims a Sprout the Colour Gate would otherwise also carry, once built', async ({ page }) => {
    test.slow();
    const console_ = collectConsoleErrors(page);
    await page.goto('/');
    await waitForDevHooks(page);
    await installBusRecorder(page, ['sprout:transportStarted', 'sprout:spawned']);

    await buildMoodBell(page);
    // Default Gate lanes: west->ember, east->dew (safe default, set on build).
    // Bell's rule defaults 'sunny'. An 'ember' Sprout of mood 'sunny' is
    // eligible for BOTH — must go to the Bell, not the Gate.
    const id = await spawnUntilMood(page, 'ember', 'sunny');
    await expect
      .poll(
        async () => (await getRecordedEvents(page)).some((e) => e.type === 'sprout:transportStarted' && e.sproutId === id),
        { timeout: 10_000 },
      )
      .toBe(true);

    const leg = (await getRecordedEvents(page)).find((e) => e.type === 'sprout:transportStarted' && e.sproutId === id);
    if (leg?.type !== 'sprout:transportStarted') throw new Error('unreachable');
    expect(leg.automationId).toBe('moodBell');

    console_.assertNone();
  });
});

test.describe('Mood Bell: the toggle UI actually changes what gets carried', () => {
  test('switching the panel rule redirects live delivery — proves the UI, not just the sim, is wired correctly', async ({ page }) => {
    test.slow();
    const console_ = collectConsoleErrors(page);
    await page.goto('/');
    await waitForDevHooks(page);
    await installBusRecorder(page, ['sprout:transportStarted', 'sprout:spawned', 'automation:moodBellRuleChanged']);

    await buildMoodBell(page); // rule defaults to 'sunny'

    // A sleepy Sprout should NOT be carried yet.
    const sleepyId = await spawnUntilMood(page, 'ember', 'sleepy');
    await page.waitForTimeout(1_000);
    expect((await getRecordedEvents(page)).some((e) => e.type === 'sprout:transportStarted' && e.sproutId === sleepyId)).toBe(
      false,
    );

    // Toggle the REAL panel UI (not a bus shortcut) to 'sleepy'.
    await page.getByRole('button', { name: 'Mood Bell' }).click();
    await page.getByRole('button', { name: /Carry Sleepy little ones home/ }).click();
    await expect
      .poll(async () => (await getRecordedEvents(page)).some((e) => e.type === 'automation:moodBellRuleChanged' && e.mood === 'sleepy'))
      .toBe(true);
    await page.getByRole('button', { name: 'Close Mood Bell' }).click();

    // The previously-stranded sleepy Sprout should now be picked up.
    await expect
      .poll(
        async () =>
          (await getRecordedEvents(page)).some((e) => e.type === 'sprout:transportStarted' && e.sproutId === sleepyId),
        { timeout: 10_000 },
      )
      .toBe(true);

    console_.assertNone();
  });
});

