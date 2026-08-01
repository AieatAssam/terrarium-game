import { expect, test } from '@playwright/test';
import { collectConsoleErrors, debugSpawnAndGetId, getRecordedEvents, HABITAT_TILES, installBusRecorder, projectToScreen, waitForDevHooks } from './helpers';

// Player report: "look at what happens to sprout when it is hovering over a
// habitat. it turns into a square block."
//
// Drives a REAL drag with synthetic PointerEvents (page.mouse does not pick a
// Sprout in this harness — see work_progress.yaml) and captures the sprite
// while it is held over a habitat, so the drag-tint material can be inspected
// rather than reasoned about.
//
// canvas.setPointerCapture MUST be stubbed before any synthetic pointerdown or
// the app hard-crashes to its error boundary (work_progress.yaml gotcha).
test.describe('drag tint', () => {
  test('a Sprout held over a habitat still reads as a creature, not a lit square', async ({ page }) => {
    const consoleErrors = collectConsoleErrors(page);
    await page.goto('/');
    await waitForDevHooks(page);
    await installBusRecorder(page, ['sprout:spawned', 'sprout:pickedUp']);

    await page.evaluate(() => {
      const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
      canvas.setPointerCapture = () => {};
      canvas.hasPointerCapture = () => false;
    });

    await debugSpawnAndGetId(page, 'sun');
    const sproutId = await (async () => {
      const spawns = (await getRecordedEvents(page)).filter(
        (e): e is Extract<typeof e, { type: 'sprout:spawned' }> => e.type === 'sprout:spawned' && e.sproutType === 'sun',
      );
      const newest = spawns.at(-1);
      if (!newest) throw new Error('no sun Sprout spawned');
      return newest.sproutId;
    })();
    await page.waitForTimeout(900);

    const pos = await page.evaluate((id) => {
      const debug = window.__debug as unknown as { meshInfo: (n: string) => { pos: number[] } | null };
      return debug.meshInfo(`terrarium.sprout.${id}`)!.pos;
    }, sproutId);
    const from = await projectToScreen(page, { x: pos[0], y: pos[1], z: pos[2] });
    // The Sunflower Meadow's real tile, lifted to the drag plane so the
    // pointer lands where the HELD Sprout actually is rather than a parallax
    // offset away. This habitat, not the Dew Pond: the Dew Pond sits under the
    // dev debug panel, which covered the very sprite this spec exists to look
    // at.
    const to = await projectToScreen(page, {
      x: HABITAT_TILES.sunflowerMeadow.x,
      y: pos[1],
      z: HABITAT_TILES.sunflowerMeadow.z,
    });

    const dispatch = async (type: string, x: number, y: number): Promise<void> => {
      await page.evaluate(
        ([t, cx, cy]) => {
          const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
          canvas.dispatchEvent(
            new PointerEvent(t as string, {
              pointerId: 1,
              clientX: cx as number,
              clientY: cy as number,
              bubbles: true,
              buttons: t === 'pointerup' ? 0 : 1,
              pointerType: 'mouse',
            }),
          );
        },
        [type, x, y] as const,
      );
    };

    await dispatch('pointerdown', from.x, from.y);
    for (let i = 1; i <= 6; i += 1) {
      await dispatch('pointermove', from.x + ((to.x - from.x) * i) / 6, from.y + ((to.y - from.y) * i) / 6);
      await page.waitForTimeout(40);
    }

    const picked = (await getRecordedEvents(page)).some((e) => e.type === 'sprout:pickedUp');
    // Crop from where the sprite ACTUALLY is now, not where the pointer went.
    const held = await page.evaluate((id) => {
      const debug = window.__debug as unknown as { meshInfo: (n: string) => { pos: number[] } | null };
      return debug.meshInfo(`terrarium.sprout.${id}`)!.pos;
    }, sproutId);
    const heldScreen = await projectToScreen(page, { x: held[0], y: held[1], z: held[2] });
    await page.screenshot({ path: 'docs/qa-screenshots/drag-tint/hovering-habitat.png' });

    // Crop tight on the held Sprout so the artifact is unmistakable.
    await page.screenshot({
      path: 'docs/qa-screenshots/drag-tint/hovering-habitat-closeup.png',
      clip: { x: Math.max(0, heldScreen.x - 130), y: Math.max(0, heldScreen.y - 130), width: 260, height: 260 },
    });

    console.log(`[drag-tint] picked=${picked} from=${JSON.stringify(from)} to=${JSON.stringify(to)}`);
    expect(picked).toBe(true);

    await dispatch('pointerup', to.x, to.y);
    consoleErrors.assertNone();
  });
});
