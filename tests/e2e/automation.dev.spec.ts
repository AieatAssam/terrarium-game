import { expect, test, type Page } from '@playwright/test';
import {
  buyUpgradeViaUI,
  collectConsoleErrors,
  emitDropped,
  getRecordedEvents,
  getUiState,
  grantDewdrops,
  installBusRecorder,
  placeAutomationViaBuildMenu,
  spawnAndDrop,
  waitForDevHooks,
} from './helpers';
// Safe to import: src/render/layout.ts pulls in only src/sim/grid + src/sim/layout,
// no Babylon deep specifiers (which Playwright's loader cannot resolve — see the
// header of ./helpers.ts).
import { GARDEN_PATH_TILES } from '../../src/render/layout';
import { UPGRADES } from '../../src/data/upgrades';
import { getEffectiveHabitatCapacity } from '../../src/data/habitats';

// Automations are UNLOCKED by their condition (correct placements for the
// Garden Slide, a paid upgrade for the Colour Gate) and then PLACED by the
// player through the build menu (2026-08-01 revision, plan.yaml Phase 1.2/1.4
// — the old "auto-builds the instant its condition is met" behaviour was
// deliberately removed; see this session's brief and docs/GAME_DESIGN.md §9.8).
// These specs exercise the real unlock/build/placement conditions in
// src/sim/systems.ts against the live sim via the bus fast path plus the real
// build-menu + canvas click for placement, not mocks.

// Superseded by the Phase 7 configured Garden Transit acceptance and transit
// specs; these assertions target removed one-off automation behavior.
test.describe.skip('Garden Slide: unlock + manual placement at 20 correct placements', () => {
  test('unlocks at 20 correct placements, then places via the build menu, always targeting Sunflower Meadow', async ({ page }) => {
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
    // new 9-per-habitat capacity. The exact split no longer matters to WHICH
    // habitat the Slide targets (as of 2026-07-31 it always targets
    // Sunflower Meadow — the Colour Gate's fork can never physically reach
    // it, see unlockSystem's own doc comment in src/sim/systems.ts) — kept
    // uneven anyway so this test still exercises multiple habitats filling.
    for (let i = 0; i < 8; i += 1) await spawnAndDrop(page, 'ember', 'emberNook');
    for (let i = 0; i < 6; i += 1) await spawnAndDrop(page, 'dew', 'dewPond');
    for (let i = 0; i < 6; i += 1) await spawnAndDrop(page, 'sun', 'sunflowerMeadow');

    await expect.poll(async () => (await getUiState(page)).unlockedAutomations, { timeout: 20_000 }).toContain('gardenSlide');

    // Unlocked != placed: the player still has to open the build menu and
    // click the site (2026-08-01 manual placement). Do that here through the
    // real build-menu button + canvas click.
    await placeAutomationViaBuildMenu(page, 'gardenSlide');

    const state = await getUiState(page);
    expect(state.unlockedAutomations).toContain('gardenSlide');
    expect(state.lastBuiltAutomation).toBe('gardenSlide');
    expect(state.unlockedAchievements).toContain('firstAutomation');

    const events = await getRecordedEvents(page);
    const unlockedIndex = events.findIndex((e) => e.type === 'automation:unlocked' && e.automationId === 'gardenSlide');
    const builtIndex = events.findIndex((e) => e.type === 'automation:built' && e.automationId === 'gardenSlide');
    expect(unlockedIndex).toBeGreaterThanOrEqual(0);
    expect(builtIndex).toBeGreaterThanOrEqual(0);
    // Unlock must precede the (player-driven) build — the build menu only
    // offers automations that are unlocked, so this ordering is structural.
    expect(unlockedIndex).toBeLessThan(builtIndex);
    // Deterministic since 2026-07-31 (previously "most-fed habitat", which
    // this test could only make unambiguous by rigging the distribution).
    expect((events[builtIndex] as { targetHabitatId?: string }).targetHabitatId).toBe('sunflowerMeadow');

    console_.assertNone();
  });
});

test.describe.skip('Colour Gate: behavioral purchase gate', () => {
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

  test('purchase succeeds once Garden Slide is built, has fed for 300+ ticks, and 3+ Sprouts of another type are piled up, then places the Colour Gate via the build menu', async ({
    page,
  }) => {
    // test.slow() → 90s; this spec is heavier than that under GPU-stalled CI
    // (the dev runner's software GL stalls make each Playwright round-trip
    // take many seconds), so set an explicit, generous budget.
    test.setTimeout(240_000);
    test.slow(); // multiple UI round-trips + a real (if short) wait for tick-based ticks to accrue
    const console_ = collectConsoleErrors(page);
    await page.goto('/');
    await waitForDevHooks(page);
    await installBusRecorder(page, ['automation:built', 'automation:unlocked', 'currency:dewdropsChanged']);

    // 1) Unlock AND PLACE Garden Slide (same approach as the unlock spec
    // above — the behavioural gate counts ticks since the Slide was BUILT,
    // so it must be placed, not merely unlocked).
    await grantDewdrops(page, 3);
    await buyUpgradeViaUI(page, 'Habitat Capacity');
    await expect.poll(async () => (await getUiState(page)).upgradeLevels.habitatCapacity).toBe(1);
    for (let i = 0; i < 8; i += 1) await spawnAndDrop(page, 'ember', 'emberNook');
    for (let i = 0; i < 6; i += 1) await spawnAndDrop(page, 'dew', 'dewPond');
    for (let i = 0; i < 6; i += 1) await spawnAndDrop(page, 'sun', 'sunflowerMeadow');
    await expect.poll(async () => (await getUiState(page)).unlockedAutomations, { timeout: 20_000 }).toContain('gardenSlide');
    await placeAutomationViaBuildMenu(page, 'gardenSlide');

    // 2) Fast-forward past the 300-tick (30 real-second) continuous-feed
    // requirement using the debug speed control — this is progression logic,
    // not pointer input, so the fast-path is appropriate per the brief.
    await page.click('[data-testid="debug-speed-20x"]');
    await page.waitForTimeout(3_000); // >=300 ticks at 20x well within 3s of real time

    // 3) Pile up 4 idle Sprouts of a type Garden Slide isn't feeding. The
    // Slide always targets Sunflower Meadow (feeds `sun`), so `dew` and
    // `ember` both qualify as "another type" for the unsorted-pile condition
    // — use `dew` fresh so it can't be confused with the 8 `ember` already
    // settled from step 1, and (unlike `sun`) the Slide's dispatcher won't
    // carry it away, so it stays idle and counts toward the pile.
    for (let i = 0; i < 4; i += 1) {
      await page.click('[data-testid="debug-spawn-dew"]');
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

    // 5) Purchasing only UNLOCKS the Colour Gate; the player still has to
    // place it through the build menu (2026-08-01 manual placement).
    await placeAutomationViaBuildMenu(page, 'colourGate');

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

/** Drives the real unlock path to a BUILT Garden Slide, which always targets Sunflower Meadow. Unlock happens at 20 correct placements; the player then places it via the build menu (2026-08-01 manual placement — GameRules §9.8). */
async function buildGardenSlide(page: Page): Promise<void> {
  await grantUntilAffordable(page, UPGRADES.habitatCapacity.costForLevel(1));
  await buyUpgradeViaUI(page, 'Habitat Capacity'); // +3 slots per habitat
  await expect.poll(async () => (await getUiState(page)).upgradeLevels.habitatCapacity).toBe(1);
  // unlockSystem always targets sunflowerMeadow (2026-07-31). 10 Ember
  // placements plus enough Sun placements to land Sunflower Meadow at EXACTLY
  // capacity-1 (11-1=10, at habitatCapacity level 1) — and to hit the
  // 20-placement unlock the 10 Embers do their half of the threshold.
  //
  // Strays are absorbed, not raced: any natural Sun that spawned before the
  // pod freeze is drained into Sunflower Meadow FIRST (while it is empty and
  // has room), and the Sun loop then places only what is still missing
  // (capacity-1 minus strays). A drained stray also counts toward the unlock
  // (settleSprout emits sprout:placed:correct), so the arithmetic closes at
  // exactly 20 regardless of how many strays slipped in. A settle-into-SM
  // AFTER the loop would be the old failure mode: draining into an already
  // one-short SM overfills it, `habitat:full` fires, and a blocked Slide
  // shows its wait bead while the test still believes it is idle.
  await drainIdleSunSprouts(page);
  for (let i = 0; i < 10; i += 1) await spawnAndDrop(page, 'ember', 'emberNook');
  const sunTarget = getEffectiveHabitatCapacity('sunflowerMeadow', 1) - 1;
  while ((await sunflowerMeadowSettledCount(page)) < sunTarget) {
    await spawnAndDrop(page, 'sun', 'sunflowerMeadow');
  }
  await expect.poll(async () => (await getUiState(page)).unlockedAutomations, { timeout: 20_000 }).toContain('gardenSlide');
  await placeAutomationViaBuildMenu(page, 'gardenSlide');
}

/** Number of Sun Sprouts recorded as `sprout:settled` into Sunflower Meadow so far (caller's installBusRecorder must include 'sprout:settled'). */
async function sunflowerMeadowSettledCount(page: Page): Promise<number> {
  const events = await getRecordedEvents(page);
  return events.filter((e) => e.type === 'sprout:settled' && e.habitatId === 'sunflowerMeadow').length;
}

/**
 * Settles every currently-idle Sun Sprout — this test's own debug spawns AND
 * any natural pod spawn that happened to land during real wall-clock setup
 * time — into Sunflower Meadow, then polls until the settled count stops
 * rising (a stray that's already mid-ride via the Slide isn't idle, so
 * `emitDropped` on it is a harmless no-op; it settles on its own, which the
 * poll waits out rather than double-processing). Call this before relying on
 * "Sunflower Meadow is at exactly N" or "the Slide is genuinely idle" —
 * without it, a stray natural Sun Sprout sitting idle at the Nursery gets
 * boarded the instant the Slide is built, silently breaking both.
 */
async function drainIdleSunSprouts(page: Page): Promise<void> {
  let last = -1;
  for (let i = 0; i < 20; i += 1) {
    const sunIds = await page.evaluate(() =>
      (window.__ttSpawnedIds ?? []).filter((s) => s.sproutType === 'sun').map((s) => s.id),
    );
    for (const id of sunIds) await emitDropped(page, id, 'sunflowerMeadow');
    const count = await sunflowerMeadowSettledCount(page);
    if (count === last) return;
    last = count;
    await page.waitForTimeout(150);
  }
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

test.describe.skip('Garden Slide: visibly carries Sprouts, along the path, at the upgraded speed', () => {
  test('a carried Sprout follows the garden path, the Slide shows its load, and Slide Speed shortens the ride', async ({ page }) => {
    test.slow(); // 20 spawn+drop round-trips, three real Upgrades-panel purchases, and two full rides
    test.setTimeout(240_000); // GPU-stalled dev runner makes each round-trip slow (see test-3)
    const console_ = collectConsoleErrors(page);
    await page.goto('/');
    await waitForDevHooks(page);
    await installBusRecorder(page, [
      'sprout:transportStarted',
      'sprout:transportCompleted',
      'sprout:settled',
      'automation:built',
      'habitat:full',
    ]);

    // Freeze the pod at 'resting' (src/data/spawning.ts) BEFORE any setup, so
    // no natural pod can land for the rest of the test. The Slide targets
    // Sunflower Meadow, which this test keeps exactly one slot short of full —
    // a natural `sun` pod spawning mid-setup would get boarded, settle, and
    // fill SM, and the sun this test deliberately spawns for its rides would
    // then sit unboarded while waitForNextTransport times out. 12 idle Dew
    // Sprouts (never boarded — the Slide only carries its target type, `sun`)
    // push the waiting count past the rest threshold deterministically.
    for (let i = 0; i < 12; i += 1) {
      await page.click('[data-testid="debug-spawn-dew"]');
    }
    // The nursery note gains the `is-resting` class exactly when the pod rests
    // (src/ui/components/nurseryNote.ts) — the world-state guarantee that no
    // natural pod can open from here on.
    await expect(page.locator('.tt-nursery-note')).toHaveClass(/is-resting/, { timeout: 10_000 });

    await buildGardenSlide(page);
    // buildGardenSlide ITSELF ends with Sunflower Meadow at exactly one slot
    // short of full and every idle Sun drained into it (see its doc comment):
    // the drain runs first, while SM is empty, so a stray natural Sun that
    // spawned in the pre-freeze window is absorbed into the count instead of
    // overfilling SM the way draining into an already-one-short habitat did.

    // A built but idle Slide shows no load at all: both the belt procession and
    // the parked "waiting" parcel exist as meshes but are hidden. POLL, don't
    // probe once: the setup above ends with Sunflower Meadow one slot short of
    // full, so a natural pod spawn of the Slide's own type (`sun`) that lands
    // during the final moments gets boarded, and the carry/block blends take a
    // beat to decay out of whatever ride the setup's last moments left behind.
    await expect
      .poll(
        async () => {
          const bead = await meshProbe(page, SLIDE_BEAD_MESH);
          const wait = await meshProbe(page, SLIDE_WAIT_MESH);
          return { beadOk: bead !== null && !bead.enabled, waitOk: wait !== null && !wait.enabled };
        },
        { timeout: 15_000 },
      )
      .toEqual({ beadOk: true, waitOk: true });

    // --- Ride 1, un-upgraded ---------------------------------------------
    // Sun, not Ember: the Slide only ever carries the type it targets
    // (Sunflower Meadow's Sun Sprouts) — an Ember spawn would just sit idle,
    // uncarried, and waitForNextTransport would time out.
    // One in-page evaluate that (a) waits for the next transport to START and
    // (b) samples the carried Sprout + belt bead every 100ms until arrival.
    // The sampler is STARTED FIRST (a promise), and only then is the debug
    // button clicked: if the click had to round-trip before the poll loop even
    // began, a GPU-stalled page could consume most of the ride in that gap and
    // leave the sampler nothing to catch. Kicking the loop off before the
    // click means it is already polling when the ride begins.
    // The snapshot-of-seen-transports is passed in because natural pod spawns
    // board the Slide during setup, so "the first transport ever recorded"
    // would be a stale, already-completed ride.
    const seenTransports = await page.evaluate(
      () => (window.__ttEvents ?? []).filter((e) => e.type === 'sprout:transportStarted').length,
    );
    const rideSampler = page.evaluate(
      async ([seenBefore, meshName]) => {
        const debug = window.__debug as unknown as {
          meshInfo: (n: string) => { pos: number[] } | null | undefined;
        };
        const events = () => window.__ttEvents ?? [];
        // (a) Wait for the next transport, in-page, no Playwright round-trip.
        const deadline = performance.now() + 30_000;
        while (performance.now() < deadline) {
          const started = events().filter((e) => e.type === 'sprout:transportStarted');
          if (started.length > seenBefore) {
            const event = started[seenBefore];
            if (event.type !== 'sprout:transportStarted') throw new Error('unreachable');
            const sproutId = event.sproutId;
            const durationMs = event.durationMs;
            // (b) Sample immediately, still in the same evaluate.
            const carried: number[][] = [];
            const bead: number[][] = [];
            const arrived = () =>
              events().some((e) => e.type === 'sprout:transportCompleted' && e.sproutId === sproutId);
            for (let i = 0; i < 80 && !arrived(); i += 1) {
              const sprout = debug.meshInfo(`terrarium.sprout.${sproutId}`);
              if (sprout) carried.push([sprout.pos[0], sprout.pos[2]]);
              const load = debug.meshInfo(meshName);
              if (load) bead.push([load.pos[0], load.pos[2]]);
              await new Promise((resolve) => setTimeout(resolve, 100));
            }
            return { ride1: { sproutId, durationMs }, samples: { carried, bead } };
          }
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        throw new Error('no sprout:transportStarted arrived');
      },
      [seenTransports, SLIDE_BEAD_MESH] as const,
    );
    await page.click('[data-testid="debug-spawn-sun"]');
    const { ride1, samples } = await rideSampler;
    expect(ride1.durationMs, 'sim must supply the ride duration').toBeGreaterThan(0);

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

    // 3) SKIPPED for this route (was: assert the ride departs from the old
    //    naive diagonal lerp by >1 tile, regression protection for the
    //    corner-cutting bug the Garden Slide pass fixed). Nursery(8,8) ->
    //    Sunflower Meadow(8,13) is a straight south run with no fork or
    //    corner (src/sim/layout.ts) — unlike the old Nursery -> Ember/Dew
    //    routes, which bend through the Colour Gate, this leg's straight-line
    //    distance IS the real path, so a >1-tile-deviation assertion would
    //    fail on a perfectly correct ride. Checks 1/2/4 still cover motion,
    //    on-path-ness, and the Slide's own animation; there's no corner left
    //    to prove this route doesn't cut.

    // 4) The Slide structure itself shows a load, and that load moves.
    expect(samples.bead.length).toBeGreaterThan(4);
    const beadTravel = Math.max(...samples.bead.map(([x, z]) => Math.hypot(x - samples.bead[0][0], z - samples.bead[0][1])));
    expect(beadTravel, 'the Slide animates while it is carrying').toBeGreaterThan(0.05);

    // --- Blocked -----------------------------------------------------------
    // That delivery took Sunflower Meadow's last free slot, so automationSystem
    // now declines to dispatch — and the Slide has to SHOW that, not just idle.
    // (src/render/automation.ts's activityOf: blocked purely from `!carrying
    // && destinationFull`, driven by `habitat:full` — no idle Sprout is
    // required to observe it, but spawning one more of the Slide's own type
    // demonstrates it now waits rather than being force-carried.)
    await expect
      .poll(
        async () => (await getRecordedEvents(page)).some((e) => e.type === 'habitat:full' && e.habitatId === 'sunflowerMeadow'),
        { timeout: 15_000 },
      )
      .toBe(true);
    await page.click('[data-testid="debug-spawn-sun"]');
    await page.waitForTimeout(900); // let the carry→blocked cross-fade settle
    const blockedWait = await meshProbe(page, SLIDE_WAIT_MESH);
    const blockedBelt = await meshProbe(page, SLIDE_BEAD_MESH);
    expect(blockedWait?.enabled, 'a blocked Slide shows a parcel it cannot deliver').toBe(true);
    expect(blockedBelt?.enabled, 'a blocked Slide is not still running its belt').toBe(false);

    // --- Ride 2, with Garden Slide Speed ------------------------------------
    await grantUntilAffordable(page, UPGRADES.habitatCapacity.costForLevel(2) + UPGRADES.gardenSlideSpeed.costForLevel(1));
    await buyUpgradeViaUI(page, 'Habitat Capacity'); // reopens Sunflower Meadow
    await expect.poll(async () => (await getUiState(page)).upgradeLevels.habitatCapacity).toBe(2);
    await buyUpgradeViaUI(page, 'Garden Slide Speed');
    await expect.poll(async () => (await getUiState(page)).upgradeLevels.gardenSlideSpeed).toBe(1);

    const seen = await page.evaluate(() => (window.__ttEvents ?? []).filter((e) => e.type === 'sprout:transportStarted').length);
    await page.click('[data-testid="debug-spawn-sun"]');
    const ride2 = await waitForNextTransport(page, seen);

    // The whole point of GAP 2: one level of Garden Slide Speed is a 20%
    // reduction in the sim, and the renderer now animates over exactly the
    // interval the sim reports — so this single number governs both.
    expect(ride2.durationMs).toBeLessThan(ride1.durationMs);
    expect(ride2.durationMs).toBeLessThanOrEqual(ride1.durationMs * 0.85);

    console_.assertNone();
  });
});
