import { expect, test } from '@playwright/test';
import { collectConsoleErrors, waitForDevHooks } from './helpers';

// Evidence capture for the garden path pass (2026-08-01): the scrolling
// chevrons' loop discontinuity, and the path's lack of verticality.
//
// Player report, verbatim: "shevrons moving along the belt do not loop the
// animation around smoothly - they are not evenly distributed, so when
// animation loops around, there is a visible jerk" and "conveyor belts remain
// flat on the ground, the do not have any verticality to them, they look
// painted on rather than placed on the terrain".
//
// PATH_PHASE writes to docs/qa-screenshots/path/<phase>/ so the identical
// script produces both evidence sets.
const PHASE = process.env.PATH_PHASE ?? 'after';
const SHOT_DIR = `docs/qa-screenshots/path/${PHASE}`;

test.describe('garden path', () => {
  test('the tread has real height, and the chevron march is captured for review', async ({ page }) => {
    const consoleErrors = collectConsoleErrors(page);
    await page.goto('/');
    await waitForDevHooks(page);
    // This sandbox defaults reduced motion ON, which freezes the chevron
    // scroll entirely (world.ts multiplies the speed by backgroundMotion), so
    // without clearing it the march frames below would all be identical.
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.evaluate(() => document.documentElement.removeAttribute('data-reduced-motion'));
    await page.waitForTimeout(600);

    await page.screenshot({ path: `${SHOT_DIR}/01-garden.png` });

    // --- Verticality: the tread must have side faces, not be a decal ---
    // Before this pass the whole path network was `CreateGround` quads at
    // y = 0.01 — zero thickness, no lit side faces, no contact shadow.
    const bed = await page.evaluate(() => {
      const debug = window.__debug as unknown as {
        meshNames: (f: string) => string[];
        extents: (f: string) => Array<{ name: string; minY: number; maxY: number }>;
      };
      const extents = debug.extents('terrarium.path.bed.');
      const heights = extents.map((e) => e.maxY - e.minY);
      return {
        count: debug.meshNames('terrarium.path.bed.').length,
        minHeight: heights.length ? Math.min(...heights) : 0,
        topY: extents.length ? Math.max(...extents.map((e) => e.maxY)) : 0,
      };
    });

    // --- The chevron march, sampled as frames for visual review ---
    // A wrap discontinuity is a motion artifact, so the honest artifact is a
    // frame sequence a human can flip through, not a single number. Six
    // frames across ~2s covers more than one full wrap period at
    // PATH_FLOW_SPEED.
    for (let i = 0; i < 6; i += 1) {
      await page.waitForTimeout(340);
      await page.screenshot({
        path: `${SHOT_DIR}/march-${String(i).padStart(2, '0')}.png`,
        clip: { x: 380, y: 300, width: 520, height: 300 },
      });
    }

    console.log(`[path] phase=${PHASE} bedMeshes=${bed.count} minBedHeight=${bed.minHeight.toFixed(3)} topY=${bed.topY.toFixed(3)}`);

    // A raised bed exists under every half-tile tread segment, with real
    // vertical extent.
    expect(bed.count).toBeGreaterThan(0);
    expect(bed.minHeight).toBeGreaterThan(0.05);

    consoleErrors.assertNone();
  });
});
