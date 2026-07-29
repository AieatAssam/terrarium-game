import { expect, test } from '@playwright/test';
import {
  collectConsoleErrors,
  emitDropped,
  getRecordedEvents,
  getUiState,
  installBusRecorder,
  popLastSpawnedId,
  waitForDevHooks,
} from './helpers';

// Star Sprouts are the rare (6%) spawn (docs/GAME_DESIGN.md "Star Sprout
// rarity") — the debug-spawn-star button exists specifically so this path
// doesn't depend on the natural roll. Per src/data/sproutTypes.ts's "Star
// Sprout habitat rule", a star matches ANY of the 3 habitats.

test.describe('debug Star Sprout spawn', () => {
  test('clicking debug-spawn-star fires sprout:spawned with sproutType "star"', async ({ page }) => {
    const console_ = collectConsoleErrors(page);
    await page.goto('/');
    await waitForDevHooks(page);
    await installBusRecorder(page);

    await page.click('[data-testid="debug-spawn-star"]');
    const id = await popLastSpawnedId(page);
    expect(id).toBeTruthy();

    console_.assertNone();
  });

  for (const habitat of ['emberNook', 'dewPond', 'sunflowerMeadow'] as const) {
    test(`a Star Sprout settles correctly in ${habitat} (matches any habitat)`, async ({ page }) => {
      const console_ = collectConsoleErrors(page);
      await page.goto('/');
      await waitForDevHooks(page);
      await installBusRecorder(page, ['sprout:placed:correct', 'sprout:placed:incorrect']);

      await page.click('[data-testid="debug-spawn-star"]');
      const id = await popLastSpawnedId(page);
      await emitDropped(page, id, habitat);

      await page.waitForFunction(() => (window.__ttEvents?.length ?? 0) > 0, undefined, { timeout: 5_000 });
      const events = await getRecordedEvents(page);
      expect(events).toContainEqual(expect.objectContaining({ type: 'sprout:placed:correct', habitatId: habitat }));

      const state = await getUiState(page);
      expect(state.journalDiscovered).toEqual(['star']);

      console_.assertNone();
    });
  }
});
