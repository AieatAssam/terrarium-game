import { expect, test } from '@playwright/test';
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

// Both automations auto-build the instant their conditions are met — there is
// no manual "place it in the world" step in this build (see this session's
// brief: buildMenu's onEnterBuildMode/onExitBuildMode are wired but not
// consequential, a documented Phase-1 scope decision). These specs exercise
// the real unlock/build conditions in src/sim/systems.ts against the live
// sim via the bus fast path, not mocks.

test.describe('Garden Slide: unlock + auto-build at 20 correct placements', () => {
  test('unlocks and auto-builds once correctPlacementCount reaches 20, targeting the most-fed habitat', async ({ page }) => {
    test.slow(); // 20 spawn+drop round-trips plus a real Upgrades-panel purchase
    const console_ = collectConsoleErrors(page);
    await page.goto('/');
    await waitForDevHooks(page);
    await installBusRecorder(page, ['automation:unlocked', 'automation:built', 'achievement:unlocked']);

    // 3 habitats x base capacity 6 = 18 total settled slots — strictly less
    // than the 20-placement unlock threshold (see docs/GAME_DESIGN.md
    // "Capacity pressure -> habitatCapacity upgrade": hitting capacity and
    // needing this upgrade to keep going is intentional). Buy one level of
    // Habitat Capacity first (100 Dewdrops -> +3 capacity/habitat = 9 each,
    // 27 total) so 20 correct placements are actually reachable, exactly
    // like a real player would need to.
    await grantDewdrops(page, 3); // +150
    await buyUpgradeViaUI(page, 'Habitat Capacity');
    await expect
      .poll(async () => (await getUiState(page)).upgradeLevels.habitatCapacity)
      .toBe(1);

    // Distribute 20 correct placements across the 3 habitats, respecting the
    // new 9-per-habitat capacity, with emberNook fed the most (8) so
    // unlockSystem's "most-fed habitat" target selection is unambiguous.
    for (let i = 0; i < 8; i += 1) await spawnAndDrop(page, 'ember', 'emberNook');
    for (let i = 0; i < 6; i += 1) await spawnAndDrop(page, 'dew', 'dewPond');
    for (let i = 0; i < 6; i += 1) await spawnAndDrop(page, 'sun', 'sunflowerMeadow');

    await expect.poll(async () => (await getUiState(page)).unlockedAutomations, { timeout: 20_000 }).toContain('gardenSlide');

    const state = await getUiState(page);
    expect(state.unlockedAutomations).toContain('gardenSlide');
    expect(state.lastBuiltAutomation).toBe('gardenSlide');
    expect(state.unlockedAchievements).toContain('firstAutomation');

    const events = await getRecordedEvents(page);
    const unlockedIndex = events.findIndex((e) => e.type === 'automation:unlocked' && e.automationId === 'gardenSlide');
    const builtIndex = events.findIndex((e) => e.type === 'automation:built' && e.automationId === 'gardenSlide');
    expect(unlockedIndex).toBeGreaterThanOrEqual(0);
    expect(builtIndex).toBeGreaterThanOrEqual(0);
    // "unlocks and auto-builds" (docs/GAME_DESIGN.md) — both fire back-to-back
    // in the same batch, so unlocked must not come after built.
    expect(unlockedIndex).toBeLessThanOrEqual(builtIndex);

    console_.assertNone();
  });
});

test.describe('Colour Gate: behavioral purchase gate', () => {
  test('purchase attempt before the behavioral condition is met does NOT charge Dewdrops or build it', async ({ page }) => {
    const console_ = collectConsoleErrors(page);
    await page.goto('/');
    await waitForDevHooks(page);
    await installBusRecorder(page, ['automation:built', 'upgrade:purchased']);

    // Affordable (450+) but Garden Slide doesn't exist yet, so the
    // behavioral gate in purchaseUpgrade (src/sim/systems.ts) must reject
    // this silently: no charge, no level change, no automation:built.
    await grantDewdrops(page, 10); // +500
    const before = await getUiState(page);
    expect(before.dewdropTotal).toBe(500);

    await buyUpgradeViaUI(page, 'Colour Gate');
    // Give the (non-)purchase a moment to have taken effect if it were going to.
    await page.waitForTimeout(300);

    const after = await getUiState(page);
    expect(after.dewdropTotal).toBe(500); // unchanged — no silent charge
    expect(after.upgradeLevels.colourGateUnlock ?? 0).toBe(0);
    expect(after.unlockedAutomations).not.toContain('colourGate');
    const events = await getRecordedEvents(page);
    expect(events.some((e) => e.type === 'automation:built' && e.automationId === 'colourGate')).toBe(false);
    expect(events.some((e) => e.type === 'upgrade:purchased' && e.upgradeId === 'colourGateUnlock')).toBe(false);

    console_.assertNone();
  });

  test('purchase succeeds and auto-builds once Garden Slide is built, has fed for 300+ ticks, and 3+ Sprouts of another type are piled up', async ({
    page,
  }) => {
    test.slow(); // multiple UI round-trips + a real (if short) wait for tick-based ticks to accrue
    const console_ = collectConsoleErrors(page);
    await page.goto('/');
    await waitForDevHooks(page);
    await installBusRecorder(page, ['automation:built', 'automation:unlocked', 'currency:dewdropsChanged']);

    // 1) Get Garden Slide built (same approach as the unlock spec above).
    await grantDewdrops(page, 3);
    await buyUpgradeViaUI(page, 'Habitat Capacity');
    await expect.poll(async () => (await getUiState(page)).upgradeLevels.habitatCapacity).toBe(1);
    for (let i = 0; i < 8; i += 1) await spawnAndDrop(page, 'ember', 'emberNook');
    for (let i = 0; i < 6; i += 1) await spawnAndDrop(page, 'dew', 'dewPond');
    for (let i = 0; i < 6; i += 1) await spawnAndDrop(page, 'sun', 'sunflowerMeadow');
    await expect.poll(async () => (await getUiState(page)).unlockedAutomations, { timeout: 20_000 }).toContain('gardenSlide');

    // 2) Fast-forward past the 300-tick (30 real-second) continuous-feed
    // requirement using the debug speed control — this is progression logic,
    // not pointer input, so the fast-path is appropriate per the brief.
    await page.click('[data-testid="debug-speed-20x"]');
    await page.waitForTimeout(3_000); // >=300 ticks at 20x well within 3s of real time

    // 3) Pile up 4 idle Sprouts of a type Garden Slide isn't feeding (it's
    // targeting emberNook, so `dew` and `sun` both qualify as "another
    // type" for the unsorted-pile condition — use `sun` fresh so it can't be
    // confused with the 6 `dew` already settled from step 1).
    for (let i = 0; i < 4; i += 1) {
      await page.click('[data-testid="debug-spawn-sun"]');
    }

    // 4) Afford Colour Gate (450) and buy it via the real Upgrades panel.
    await grantDewdrops(page, 10); // +500, on top of whatever's left from step 1's spend
    const before = await getUiState(page);
    expect(before.dewdropTotal).toBeGreaterThanOrEqual(450);

    await buyUpgradeViaUI(page, 'Colour Gate');

    await expect.poll(async () => (await getUiState(page)).unlockedAutomations, { timeout: 5_000 }).toContain('colourGate');

    const after = await getUiState(page);
    expect(after.upgradeLevels.colourGateUnlock).toBe(1);
    expect(after.lastBuiltAutomation).toBe('colourGate');
    // Assert the exact -450 charge via the emitted event rather than a
    // before/after dewdropTotal diff: with 20 Sprouts already settled and
    // dewdropSystem accruing income every tick in the background (including
    // during the real-time waits above), a simple subtraction would be
    // flaky — dewdrops earned between the `before` snapshot and the actual
    // deduction are a real, expected source of drift, not a bug.
    const events = await getRecordedEvents(page);
    expect(events.some((e) => e.type === 'currency:dewdropsChanged' && e.delta === -450)).toBe(true);
    expect(events.some((e) => e.type === 'automation:built' && e.automationId === 'colourGate')).toBe(true);

    console_.assertNone();
  });
});
