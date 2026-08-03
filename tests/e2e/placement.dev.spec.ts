import { expect, test } from '@playwright/test';
import {
  collectConsoleErrors,
  debugSpawnAndGetId,
  dragSproutToHabitat,
  getRecordedEvents,
  getUiState,
  installBusRecorder,
  waitForDevHooks,
} from './helpers';

test.describe('manual placement via real pointer drag', () => {
  test('dragging a Sprout to its matching habitat settles it and earns Dewdrops', async ({ page }) => {
    const console_ = collectConsoleErrors(page);
    await page.goto('/');
    await waitForDevHooks(page);
    await installBusRecorder(page, ['sprout:placed:correct', 'sprout:placed:incorrect', 'sprout:settled']);

    const before = await getUiState(page);
    expect(before.dewdropTotal).toBe(0);
    expect(before.journalDiscovered).toEqual([]);

    const sproutId = await debugSpawnAndGetId(page, 'ember');
    await dragSproutToHabitat(page, sproutId, 'emberNook');

    // Correct settle -> journal discovery fires immediately; Dewdrop income
    // accrues on the next tick (dewdropSystem), so poll rather than assert
    // synchronously.
    await page.waitForFunction(() => window.__terrariumUIF!.store.getState().journalDiscovered.has('ember'), undefined, {
      timeout: 5_000,
    });
    // 1 settled base-rate Sprout needs ~12.5s to cross a whole Dewdrop
    // (BASE_DEWDROP_RATE 0.008/tick x 10 ticks/sec = 0.08/sec, 1/0.08 = 12.5s
    // — src/data/habitats.ts). This used to be 5s, sized against a stale
    // 0.02 rate (see work_progress.yaml's e2e-not-rerun entry); fixed
    // 2026-08-01 rather than granting a rate-boosting upgrade first, since
    // this test is specifically about the base, unupgraded path.
    await page.waitForFunction(() => window.__terrariumUIF!.store.getState().dewdropTotal > 0, undefined, {
      timeout: 15_000,
    });

    const events = await getRecordedEvents(page);
    expect(events).toContainEqual(expect.objectContaining({ type: 'sprout:placed:correct', habitatId: 'emberNook' }));
    expect(events).toContainEqual(expect.objectContaining({ type: 'sprout:settled', habitatId: 'emberNook' }));

    const after = await getUiState(page);
    expect(after.journalDiscovered).toEqual(['ember']);
    expect(after.dewdropTotal).toBeGreaterThan(0);

    console_.assertNone();
  });

  test('dragging a Sprout to a non-matching habitat is a friendly retry: no crash, no fail-state UI, Sprout stays sortable', async ({
    page,
  }) => {
    const console_ = collectConsoleErrors(page);
    await page.goto('/');
    await waitForDevHooks(page);
    await installBusRecorder(page, ['sprout:placed:correct', 'sprout:placed:incorrect']);

    const sproutId = await debugSpawnAndGetId(page, 'ember');
    // Ember's correct home is emberNook; dropping on dewPond is a deliberate mismatch.
    await dragSproutToHabitat(page, sproutId, 'dewPond');

    await page.waitForFunction(() => (window.__ttEvents?.length ?? 0) > 0, undefined, { timeout: 5_000 });
    const events = await getRecordedEvents(page);
    expect(events).toContainEqual(expect.objectContaining({ type: 'sprout:placed:incorrect', habitatId: 'dewPond' }));
    expect(events.some((e) => e.type === 'sprout:placed:correct')).toBe(false);

    // No fail-state UI: no dialog/alert should have appeared, the game
    // canvas is still there, and Dewdrops/journal are untouched by the miss.
    await expect(page.locator('#game-canvas')).toBeVisible();
    const state = await getUiState(page);
    expect(state.dewdropTotal).toBe(0);
    expect(state.journalDiscovered).toEqual([]);

    // Recovery: the same Sprout should still be idle at the Nursery and
    // placeable correctly afterwards — dragging from the Nursery again picks
    // it up (it's the only idle Sprout in this fresh save) and this time we
    // drop it on its real home.
    await dragSproutToHabitat(page, sproutId, 'emberNook');
    await page.waitForFunction(
      () => window.__ttEvents?.some((e) => e.type === 'sprout:placed:correct') ?? false,
      undefined,
      { timeout: 5_000 },
    );
    const finalState = await getUiState(page);
    expect(finalState.journalDiscovered).toEqual(['ember']);

    console_.assertNone();
  });
});
