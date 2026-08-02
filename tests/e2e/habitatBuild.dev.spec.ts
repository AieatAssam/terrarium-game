import { expect, test } from '@playwright/test';
import {
  collectConsoleErrors,
  getRecordedEvents,
  getUiState,
  grantDewdrops,
  installBusRecorder,
  projectToScreen,
  spawnAndDrop,
  waitForDevHooks,
} from './helpers';
// Safe to import: src/render/layout.ts pulls in only src/sim/grid + src/sim/layout,
// no Babylon deep specifiers (see the header of ./helpers.ts).
import { GARDEN_PATH_TILES } from '../../src/render/layout';
import { HABITATS } from '../../src/data/habitats';

// Phase 2 buildable habitats (plan.yaml Phase 2.2, GameRules §10.0): the
// full-now gate -> build menu button appears -> click enters habitat build
// mode -> a real canvas click on a valid path tile commits placeHabitat.
// Deliberately exercises the REAL UI (build menu button) and REAL pointer
// input (canvas click-to-commit) rather than the bus fast path, because the
// build-mode plumbing (buildMenu selection -> input hook -> ghost preview ->
// click-to-commit) is exactly the layer these specs exist to prove.

// A painted path tile that is NOT the Nursery, a habitat, an automation site,
// or a future built copy — picked from the network itself so the choice is
// structurally valid (on-path), then checked free below.
function findFreePathTile(exclude: { x: number; z: number }[]): { x: number; z: number } {
  const occupied = new Set(exclude.map((t) => `${t.x},${t.z}`));
  const tile = GARDEN_PATH_TILES.find((t) => !occupied.has(`${t.x},${t.z}`));
  if (!tile) throw new Error('No free path tile found for a new habitat site');
  return tile;
}

const CAP = HABITATS.emberNook.baseCapacity;

test.describe('buildable habitats: full-now gate + build-menu + click-to-commit', () => {
  test('a second Ember Nook becomes buildable once the original is full, and a canvas click commits it', async ({ page }) => {
    test.slow(); // CAP spawn+drop round-trips, then a real build-mode click
    const console_ = collectConsoleErrors(page);
    await page.goto('/');
    await waitForDevHooks(page);
    await installBusRecorder(page, ['habitat:full', 'habitat:built', 'currency:dewdropsChanged']);

    // The gate is "some instance full" — no build button until Ember Nook
    // actually fills. Assert it stays absent early.
    const early = await getUiState(page);
    expect(early.habitatFullKinds).not.toContain('emberNook');

    // Fill Ember Nook via the bus fast path (spawn+drop is progression logic,
    // the pointer side of PLACEMENT is not what this spec is about).
    for (let i = 0; i < CAP; i += 1) await spawnAndDrop(page, 'ember', 'emberNook');

    await expect.poll(async () => (await getUiState(page)).habitatFullKinds, { timeout: 20_000 }).toContain('emberNook');

    // Affordability: the first extension costs habitatBuildCost(1) = 500.
    await grantDewdrops(page, 10); // +500

    // The build menu must now offer the Ember Nook build button.
    const emberButton = page.getByRole('button', { name: /build another home/i });
    await expect(emberButton).toBeVisible();
    await emberButton.click();

    // Selected state sticks on the button (aria-pressed) — build mode is on.
    await expect(emberButton).toHaveAttribute('aria-pressed', 'true');

    // Click a real, free path tile to commit. This goes through the REAL
    // input path: pointerdown -> build-mode branch -> isValidHabitatSite ->
    // onPlaceHabitat -> sim.placeHabitat.
    const site = findFreePathTile(
      [
        { x: 4, z: 4 }, // Ember Nook original
        { x: 12, z: 4 }, // Dew Pond original
        { x: 8, z: 13 }, // Sunflower Meadow original
        { x: 8, z: 8 }, // Nursery
        { x: 8, z: 7 }, // Garden Slide site
        { x: 8, z: 6 }, // Colour Gate site
        { x: 9, z: 8 }, // Mood Bell site
      ],
    );
    const screen = await projectToScreen(page, { x: site.x, y: 0, z: site.z });
    await page.mouse.click(screen.x, screen.y);

    // The commit lands: habitat:built recorded, the build menu deselects, and
    // the UI store now counts two Ember Nook instances.
    await expect.poll(async () => (await getRecordedEvents(page)).some((e) => e.type === 'habitat:built')).toBe(true);
    const events = await getRecordedEvents(page);
    const built = events.find((e) => e.type === 'habitat:built' && e.habitatId === 'emberNook');
    expect(built).toBeDefined();
    expect((built as { habitatInstanceId: string }).habitatInstanceId).toBe('emberNook-2');
    expect((built as { tile: { x: number; z: number } }).tile).toEqual(site);

    const state = await getUiState(page);
    expect(state.habitatInstanceCounts.emberNook).toBe(2);
    // Build mode exited automatically.
    await expect(emberButton).toHaveAttribute('aria-pressed', 'false');

    console_.assertNone();
  });

  test('an unaffordable build button is disabled and cannot enter build mode', async ({ page }) => {
    const console_ = collectConsoleErrors(page);
    await page.goto('/');
    await waitForDevHooks(page);
    await installBusRecorder(page, ['habitat:built']);

    for (let i = 0; i < CAP; i += 1) await spawnAndDrop(page, 'ember', 'emberNook');
    await expect.poll(async () => (await getUiState(page)).habitatFullKinds, { timeout: 20_000 }).toContain('emberNook');

    // No Dewdrops granted — the 500-cost button must render disabled.
    const emberButton = page.getByRole('button', { name: /build another home/i });
    await expect(emberButton).toBeVisible();
    await expect(emberButton).toBeDisabled();

    console_.assertNone();
  });
});
