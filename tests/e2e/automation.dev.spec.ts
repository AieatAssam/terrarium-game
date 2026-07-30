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
// Safe to import: src/render/layout.ts pulls in only src/sim/grid + src/sim/layout,
// no Babylon deep specifiers (which Playwright's loader cannot resolve — see the
// header of ./helpers.ts).
import { GARDEN_PATH_TILES, HABITAT_TILES, NURSERY_TILE } from '../../src/render/layout';
import { UPGRADES } from '../../src/data/upgrades';

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

    // Base capacity now covers the unlock threshold on its own (3 habitats x
    // BASE_CAPACITY, versus 20 required) — it deliberately did not before, and
    // the Garden Slide was unreachable by play as a result. Buying a level of
    // Habitat Capacity here is therefore no longer strictly required; it is
    // kept because it exercises a real purchase through the Upgrades panel on
    // the way to the unlock, and it leaves headroom so a single refused
    // placement can't strand the run.
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

    // Affordable but Garden Slide doesn't exist yet, so the
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

    // 4) Afford the Colour Gate and buy it via the real Upgrades panel.
    // Derived from the price so a repricing can't quietly make this grant
    // insufficient and the purchase silently fail: each click grants 50, and
    // the +2 is headroom over step 1's spend.
    await grantDewdrops(page, Math.ceil(UPGRADES.colourGateUnlock.costForLevel(1) / 50) + 2);
    const before = await getUiState(page);
    expect(before.dewdropTotal).toBeGreaterThanOrEqual(UPGRADES.colourGateUnlock.costForLevel(1));

    await buyUpgradeViaUI(page, 'Colour Gate');

    await expect.poll(async () => (await getUiState(page)).unlockedAutomations, { timeout: 5_000 }).toContain('colourGate');

    const after = await getUiState(page);
    expect(after.upgradeLevels.colourGateUnlock).toBe(1);
    expect(after.lastBuiltAutomation).toBe('colourGate');
    // Assert the exact charge via the emitted event rather than a
    // before/after dewdropTotal diff: with 20 Sprouts already settled and
    // dewdropSystem accruing income every tick in the background (including
    // during the real-time waits above), a simple subtraction would be
    // flaky — dewdrops earned between the `before` snapshot and the actual
    // deduction are a real, expected source of drift, not a bug.
    const events = await getRecordedEvents(page);
    // Derived from the upgrade table, not a literal: this assertion silently
    // went stale when the Colour Gate was repriced during an economy rebalance.
    const gateCost = UPGRADES.colourGateUnlock.costForLevel(1);
    expect(events.some((e) => e.type === 'currency:dewdropsChanged' && e.delta === -gateCost)).toBe(true);
    expect(events.some((e) => e.type === 'automation:built' && e.automationId === 'colourGate')).toBe(true);

    console_.assertNone();
  });
});

// ---------------------------------------------------------------------------
// The Garden Slide as a visibly working helper (GameRules §9.2, §9.3, §8.3)
// ---------------------------------------------------------------------------
// Three defects this covers, all of which made the Slide read as inert scenery
// even though the simulation behind it was already correct:
//
//   1. A carried Sprout lerped STRAIGHT from the Nursery tile to the habitat
//      tile, drifting diagonally across open grass while the L-shaped garden
//      path sat unused beside it.
//   2. The renderer derived its own ride duration from its own copy of the
//      420ms-per-tile constant, so Garden Slide Speed changed the simulated
//      timing and nothing else — the upgrade had no visible effect at all.
//   3. The built structure never animated and never showed that it had stopped
//      because its destination habitat was full.
//
// These assertions read real mesh positions out of the live scene through the
// dev-only `window.__debug` hook rather than eyeballing a screenshot.

const PATH_TILE_KEYS = new Set(GARDEN_PATH_TILES.map((t) => `${t.x},${t.z}`));
/** First parcel of the Slide's belt procession — present only while carrying. */
const SLIDE_BEAD_MESH = 'terrarium.automation.gardenSlide.bead.0';
/** The parked parcel that appears only when the Slide's destination is full. */
const SLIDE_WAIT_MESH = 'terrarium.automation.gardenSlide.wait';

/** Reads one mesh's absolute position + enabled flag out of the live scene. */
async function meshProbe(page: Page, name: string): Promise<{ pos: number[]; enabled: boolean } | null> {
  return page.evaluate((meshName) => {
    const debug = window.__debug as unknown as {
      meshInfo: (n: string) => { pos: number[]; enabled: boolean } | null | undefined;
    };
    const info = debug.meshInfo(meshName);
    return info ? { pos: info.pos, enabled: info.enabled } : null;
  }, name);
}

/** Perpendicular distance from an XZ point to the straight line a→b. */
function distanceToStraightLine(x: number, z: number, a: { x: number; z: number }, b: { x: number; z: number }): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  return Math.abs(dz * (x - a.x) - dx * (z - a.z)) / Math.hypot(dx, dz);
}

/**
 * Clicks the debug grant button until the player can afford `target`, rather
 * than hardcoding a click count against a specific price. Upgrade costs and
 * Dewdrop income are balance values that move; deriving the requirement from
 * `UPGRADES[...].costForLevel(...)` and topping up to it keeps these specs
 * correct across a rebalance instead of failing on a changed number.
 */
async function grantUntilAffordable(page: Page, target: number): Promise<void> {
  for (let i = 0; i < 40; i += 1) {
    if ((await getUiState(page)).dewdropTotal >= target) return;
    await grantDewdrops(page, 1);
  }
  throw new Error(`could not reach ${target} Dewdrops via the debug grant button`);
}

/** Drives the real unlock path to a built Garden Slide targeting the Ember Nook. */
async function buildGardenSlide(page: Page): Promise<void> {
  await grantUntilAffordable(page, UPGRADES.habitatCapacity.costForLevel(1));
  await buyUpgradeViaUI(page, 'Habitat Capacity'); // +3 slots per habitat
  await expect.poll(async () => (await getUiState(page)).upgradeLevels.habitatCapacity).toBe(1);
  // emberNook fed the most (so unlockSystem targets it) and left exactly one
  // slot short of full, so the Slide has one delivery to make before its
  // destination fills and the blocked state below becomes reachable.
  for (let i = 0; i < 8; i += 1) await spawnAndDrop(page, 'ember', 'emberNook');
  for (let i = 0; i < 6; i += 1) await spawnAndDrop(page, 'dew', 'dewPond');
  for (let i = 0; i < 6; i += 1) await spawnAndDrop(page, 'sun', 'sunflowerMeadow');
  await expect.poll(async () => (await getUiState(page)).unlockedAutomations, { timeout: 20_000 }).toContain('gardenSlide');
}

/** Waits until more than `seenBefore` transports have started, then returns the one at that index. */
async function waitForNextTransport(page: Page, seenBefore: number): Promise<{ sproutId: string; durationMs: number }> {
  await page.waitForFunction(
    (count) => (window.__ttEvents ?? []).filter((e) => e.type === 'sprout:transportStarted').length > count,
    seenBefore,
    { timeout: 30_000 },
  );
  return page.evaluate((count) => {
    const started = (window.__ttEvents ?? []).filter((e) => e.type === 'sprout:transportStarted');
    const event = started[count];
    if (event.type !== 'sprout:transportStarted') throw new Error('unreachable');
    return { sproutId: event.sproutId, durationMs: event.durationMs };
  }, seenBefore);
}

test.describe('Garden Slide: visibly carries Sprouts, along the path, at the upgraded speed', () => {
  test('a carried Sprout follows the garden path, the Slide shows its load, and Slide Speed shortens the ride', async ({ page }) => {
    test.slow(); // 20 spawn+drop round-trips, three real Upgrades-panel purchases, and two full rides
    const console_ = collectConsoleErrors(page);
    await page.goto('/');
    await waitForDevHooks(page);
    await installBusRecorder(page, ['sprout:transportStarted', 'sprout:transportCompleted', 'automation:built', 'habitat:full']);

    await buildGardenSlide(page);

    // A built but idle Slide shows no load at all: both the belt procession and
    // the parked "waiting" parcel exist as meshes but are hidden.
    const idleBead = await meshProbe(page, SLIDE_BEAD_MESH);
    const idleWait = await meshProbe(page, SLIDE_WAIT_MESH);
    expect(idleBead, 'the Slide belt parcel mesh should exist').not.toBeNull();
    expect(idleWait, 'the Slide waiting-parcel mesh should exist').not.toBeNull();
    expect(idleBead?.enabled, 'an idle Slide runs no belt').toBe(false);
    expect(idleWait?.enabled, 'an idle Slide is not showing a blockage').toBe(false);

    // --- Ride 1, un-upgraded -------------------------------------------------
    await page.click('[data-testid="debug-spawn-ember"]');
    const ride1 = await waitForNextTransport(page, 0);
    expect(ride1.durationMs, 'sim must supply the ride duration').toBeGreaterThan(0);

    // Sample the carried Sprout's real world position while the ride is in
    // flight, stopping the moment the sim reports arrival — a SETTLED Sprout
    // stands on an offset slot on the habitat, which is legitimately off-path.
    const samples = await page.evaluate(
      async ([sproutId, meshName]) => {
        const carried: number[][] = [];
        const bead: number[][] = [];
        const debug = window.__debug as unknown as { meshInfo: (n: string) => { pos: number[] } | null | undefined };
        const arrived = () =>
          (window.__ttEvents ?? []).some((e) => e.type === 'sprout:transportCompleted' && e.sproutId === sproutId);
        for (let i = 0; i < 80 && !arrived(); i += 1) {
          const sprout = debug.meshInfo(`terrarium.sprout.${sproutId}`);
          if (sprout) carried.push([sprout.pos[0], sprout.pos[2]]);
          const load = debug.meshInfo(meshName);
          if (load) bead.push([load.pos[0], load.pos[2]]);
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        return { carried, bead };
      },
      [ride1.sproutId, SLIDE_BEAD_MESH] as const,
    );

    expect(samples.carried.length, 'should have caught the Sprout mid-ride').toBeGreaterThan(4);

    // 1) It actually travels.
    const first = samples.carried[0];
    const last = samples.carried[samples.carried.length - 1];
    expect(Math.hypot(last[0] - first[0], last[1] - first[1]), 'the Sprout visibly moves').toBeGreaterThan(2);

    // 2) Every mid-ride position sits on a tile that actually has path art.
    for (const [x, z] of samples.carried) {
      const key = `${Math.round(x)},${Math.round(z)}`;
      expect(PATH_TILE_KEYS.has(key), `carried Sprout at ${x.toFixed(2)},${z.toFixed(2)} (tile ${key}) is off the garden path`).toBe(
        true,
      );
    }

    // 3) It is NOT the old straight diagonal: the routed ride swings well clear
    //    of the Nursery→Ember Nook line it used to cut across.
    const maxDeviation = Math.max(
      ...samples.carried.map(([x, z]) => distanceToStraightLine(x, z, NURSERY_TILE, HABITAT_TILES.emberNook)),
    );
    expect(maxDeviation, 'the route departs from the old straight lerp').toBeGreaterThan(1);

    // 4) The Slide structure itself shows a load, and that load moves.
    expect(samples.bead.length).toBeGreaterThan(4);
    const beadTravel = Math.max(...samples.bead.map(([x, z]) => Math.hypot(x - samples.bead[0][0], z - samples.bead[0][1])));
    expect(beadTravel, 'the Slide animates while it is carrying').toBeGreaterThan(0.05);

    // --- Blocked -------------------------------------------------------------
    // That delivery took the Ember Nook's last free slot, so automationSystem
    // now declines to dispatch — and the Slide has to SHOW that, not just idle.
    await expect
      .poll(async () => (await getRecordedEvents(page)).some((e) => e.type === 'habitat:full' && e.habitatId === 'emberNook'), {
        timeout: 15_000,
      })
      .toBe(true);
    await page.click('[data-testid="debug-spawn-ember"]');
    await page.waitForTimeout(900); // let the carry→blocked cross-fade settle
    const blockedWait = await meshProbe(page, SLIDE_WAIT_MESH);
    const blockedBelt = await meshProbe(page, SLIDE_BEAD_MESH);
    expect(blockedWait?.enabled, 'a blocked Slide shows a parcel it cannot deliver').toBe(true);
    expect(blockedBelt?.enabled, 'a blocked Slide is not still running its belt').toBe(false);

    // --- Ride 2, with Garden Slide Speed -------------------------------------
    await grantUntilAffordable(page, UPGRADES.habitatCapacity.costForLevel(2) + UPGRADES.gardenSlideSpeed.costForLevel(1));
    await buyUpgradeViaUI(page, 'Habitat Capacity'); // reopens the Ember Nook
    await expect.poll(async () => (await getUiState(page)).upgradeLevels.habitatCapacity).toBe(2);
    await buyUpgradeViaUI(page, 'Garden Slide Speed');
    await expect.poll(async () => (await getUiState(page)).upgradeLevels.gardenSlideSpeed).toBe(1);

    const seen = await page.evaluate(() => (window.__ttEvents ?? []).filter((e) => e.type === 'sprout:transportStarted').length);
    await page.click('[data-testid="debug-spawn-ember"]');
    const ride2 = await waitForNextTransport(page, seen);

    // The whole point of GAP 2: one level of Garden Slide Speed is a 20%
    // reduction in the sim, and the renderer now animates over exactly the
    // interval the sim reports — so this single number governs both.
    expect(ride2.durationMs).toBeLessThan(ride1.durationMs);
    expect(ride2.durationMs).toBeLessThanOrEqual(ride1.durationMs * 0.85);

    console_.assertNone();
  });
});
