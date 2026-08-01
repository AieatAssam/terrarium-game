import { describe, expect, it } from 'vitest';

import { EventBus } from '../../events/bus';
import { UPGRADES } from '../../data/upgrades';
import { createUiStateStore } from '../uiState';
import { createUpgradesPanel } from './upgrades';

/**
 * Regression guard for the cost-display off-by-one: the buy button must
 * show whatever purchaseUpgrade (src/sim/systems.ts) actually charges next
 * — costForLevel(level + 1) — not costForLevel(level), which is what the
 * CURRENT level had already cost. No test caught this when it shipped,
 * which is why it shipped.
 */
describe('upgrades panel buy button cost', () => {
  it('matches costForLevel(level + 1) at level 0 (first purchase)', () => {
    const bus = new EventBus();
    const store = createUiStateStore(bus);
    const panel = createUpgradesPanel(store);

    const buyBtn = panel.overlay.querySelector<HTMLButtonElement>(
      `button[aria-label^="Buy ${UPGRADES.podRhythm.displayName}"]`,
    );
    expect(buyBtn).not.toBeNull();
    expect(buyBtn!.textContent).toBe(UPGRADES.podRhythm.costForLevel(1).toLocaleString());
  });

  it('matches costForLevel(level + 1) after one purchase (level 1 -> 2)', () => {
    const bus = new EventBus();
    const store = createUiStateStore(bus);
    const panel = createUpgradesPanel(store);

    bus.emit({ type: 'upgrade:purchased', upgradeId: 'podRhythm', level: 1 });

    const buyBtn = panel.overlay.querySelector<HTMLButtonElement>(
      `button[aria-label^="Buy ${UPGRADES.podRhythm.displayName}"]`,
    );
    expect(buyBtn!.textContent).toBe(UPGRADES.podRhythm.costForLevel(2).toLocaleString());
  });

  it('is affordable exactly when dewdropTotal covers what a click will actually charge', () => {
    const bus = new EventBus();
    const store = createUiStateStore(bus);
    const panel = createUpgradesPanel(store);
    bus.emit({ type: 'upgrade:purchased', upgradeId: 'podRhythm', level: 1 });

    const realCost = UPGRADES.podRhythm.costForLevel(2);
    const buyBtn = () =>
      panel.overlay.querySelector<HTMLButtonElement>(`button[aria-label^="Buy ${UPGRADES.podRhythm.displayName}"]`)!;

    bus.emit({ type: 'currency:dewdropsChanged', total: realCost - 1, delta: 0 });
    expect(buyBtn().disabled).toBe(true);

    bus.emit({ type: 'currency:dewdropsChanged', total: realCost, delta: 0 });
    expect(buyBtn().disabled).toBe(false);
  });
});

/**
 * 2026-08-01 manual placement (GameRules §9.8): purchasing colourGateUnlock/
 * moodBellUnlock only unlocks the automation now, it no longer builds it —
 * the maxed row must say the player still has something to do, not just
 * "Max" (which reads as fully finished).
 */
describe('upgrades panel: unlocked-but-not-placed copy', () => {
  const lockNoteFor = (overlay: ParentNode, displayName: string): string | undefined =>
    overlay.querySelector<HTMLButtonElement>(`button[aria-label^="Buy ${displayName}"],button[aria-label^="${displayName}"]`)
      ?.parentElement?.querySelector<HTMLElement>('.tt-upgrade-lock')?.textContent ?? undefined;

  it('shows "Ready to build" once colourGateUnlock is maxed but the Gate is not yet placed', () => {
    const bus = new EventBus();
    const store = createUiStateStore(bus);
    const panel = createUpgradesPanel(store);

    bus.emit({ type: 'upgrade:purchased', upgradeId: 'colourGateUnlock', level: 1 });
    bus.emit({ type: 'automation:unlocked', automationId: 'colourGate' });

    expect(lockNoteFor(panel.overlay, 'Colour Gate')).toBe('Ready to build — open the build menu below.');
  });

  it('reverts to bare "Max" once the Gate is actually placed', () => {
    const bus = new EventBus();
    const store = createUiStateStore(bus);
    const panel = createUpgradesPanel(store);

    bus.emit({ type: 'upgrade:purchased', upgradeId: 'colourGateUnlock', level: 1 });
    bus.emit({ type: 'automation:unlocked', automationId: 'colourGate' });
    bus.emit({ type: 'automation:built', automationId: 'colourGate', instanceId: 'colourGate-1', siteTile: { x: 8, z: 6 } });

    const buyBtn = panel.overlay.querySelector<HTMLButtonElement>('button[aria-label*="Colour Gate"]');
    expect(buyBtn!.textContent).toBe('Max');
    expect(lockNoteFor(panel.overlay, 'Colour Gate')).toBeFalsy();
  });
});
