import { expect, test } from '@playwright/test';
import {
  collectConsoleErrors,
  getUiState,
  installBusRecorder,
  spawnAndDrop,
  waitForDevHooks,
  waitForSaveWritten,
  readSaveEnvelope,
} from './helpers';

test.describe('persistence across reload (IndexedDB)', () => {
  test('settling Sprouts survives a reload: the IndexedDB save is correct, and the reloaded sim resumes from it', async ({
    page,
  }) => {
    test.setTimeout(60_000); // real 15s autosave interval (src/sim/runtime.ts AUTOSAVE_INTERVAL_MS) + two page loads
    const console_ = collectConsoleErrors(page);
    await page.goto('/');
    await waitForDevHooks(page);
    await installBusRecorder(page, ['save:written']);

    // Settle 3 embers (not 1) so dewdropSystem's whole-unit flush
    // (0.02/tick/Sprout * 3 = 0.06/tick) happens roughly every ~1.7s instead
    // of ~5s, keeping this test comfortably inside its timeout.
    await spawnAndDrop(page, 'ember', 'emberNook');
    await spawnAndDrop(page, 'ember', 'emberNook');
    await spawnAndDrop(page, 'ember', 'emberNook');

    await page.waitForFunction(() => window.__terrariumUIF!.store.getState().dewdropTotal > 0, undefined, {
      timeout: 10_000,
    });

    // Wait for a REAL autosave (save:written) rather than trusting
    // beforeunload's fire-and-forget `void saveGame(state)` (src/sim/runtime.ts)
    // to land before the page tears down on reload.
    await waitForSaveWritten(page);

    const beforeReload = await readSaveEnvelope(page);
    expect(beforeReload).toBeTruthy();
    expect(beforeReload.sim.dewdrops).toBeGreaterThan(0);
    expect(beforeReload.sim.correctPlacementCount).toBeGreaterThanOrEqual(3);
    expect(beforeReload.sim.journalDiscovered).toContain('ember');
    expect(beforeReload.sim.habitats.find((h) => h.habitatId === 'emberNook')?.count).toBe(3);

    await page.reload();
    await waitForDevHooks(page);

    const afterReload = await readSaveEnvelope(page);
    expect(afterReload.sim.correctPlacementCount).toBeGreaterThanOrEqual(beforeReload.sim.correctPlacementCount);
    expect(afterReload.sim.journalDiscovered).toContain('ember');
    expect(afterReload.sim.habitats.find((h) => h.habitatId === 'emberNook')?.count).toBeGreaterThanOrEqual(3);
    expect(afterReload.sim.dewdrops).toBeGreaterThanOrEqual(beforeReload.sim.dewdrops);

    // The reloaded sim resumed from the save (not from zero): the live HUD
    // total climbs back up to at least the persisted value as soon as the
    // dewdropSystem's next tick(s) flush — this is the load-bearing proof
    // that the running sim, not just the IndexedDB record, carried the
    // state forward.
    await expect
      .poll(async () => (await getUiState(page)).dewdropTotal, { timeout: 10_000 })
      .toBeGreaterThanOrEqual(beforeReload.sim.dewdrops);

    // NOT asserted here: store.getState().journalDiscovered /
    // unlockedAchievements post-reload. See docs/QA_REPORT.md — the UI
    // state store (src/ui/uiState.ts) only ever mirrors live bus events
    // going forward and has no hydration path from a restored save, so
    // those two fields read back empty in the live UI store immediately
    // after a reload even though (as asserted above) the actual persisted
    // SimState is correct and the sim continues operating on it correctly.
    // The IndexedDB read above is the real persistence proof for this spec.

    console_.assertNone();
  });
});
