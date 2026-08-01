// Upgrades panel: lists the six upgrades straight from src/data/upgrades.ts
// (read live, never hardcoded — B is still filling in real balance values).
// Level is mirrored purely from `upgrade:purchased` events; it never
// advances optimistically on click, so the UI can't show progress the sim
// hasn't confirmed.

import type { AutomationId, UpgradeId } from '../../core/ids';
import { isDev } from '../../core/env';
import { UPGRADE_LIST } from '../../data/upgrades';
import { el } from '../dom';
import { icons } from '../icons';
import { iconHtml, onManifestIconsReady, preloadManifestIcons } from '../manifestIcons';
import { createPanel } from '../panel';
import type { UiStateStore } from '../uiState';

function upgradeManifestKey(id: UpgradeId): string {
  return `ui.icon.upgrade.${id}`;
}

/**
 * Which automation an unlock upgrade actually places (2026-08-01, manual
 * placement — GameRules §9.8). Purchasing only unlocks now; the player
 * still has to open the build menu and place it, so the maxed-out row
 * needs to say that plainly rather than a bare "Max" that reads as done.
 */
const AUTOMATION_UPGRADE: Partial<Record<UpgradeId, AutomationId>> = {
  colourGateUnlock: 'colourGate',
  moodBellUnlock: 'moodBell',
};

/**
 * As with build-mode selection (buildMenu.ts), there's no `upgrade:
 * purchaseRequested`-shaped event in docs/CONTRACTS.md's GameEvent union —
 * purchasing an upgrade is a sim-state mutation nothing currently exposes a
 * command channel for. Same two-part answer: an `onPurchaseUpgrade` callback
 * (primary, discoverable) plus this CustomEvent as a zero-import fallback
 * whoever ends up owning the purchase command path can listen for without
 * depending on src/ui. Reported back for integration, not added to
 * CONTRACTS.md unilaterally.
 */
export const PURCHASE_UPGRADE_EVENT = 'terrarium:purchaseUpgrade';

export interface PurchaseUpgradeEventDetail {
  upgradeId: UpgradeId;
}

export interface UpgradesPanelHooks {
  onPurchaseUpgrade?: (upgradeId: UpgradeId) => void;
  /**
   * Why an upgrade is unavailable for reasons other than cost (the Colour
   * Gate's behavioral gate), or null. Without this the panel could only see
   * price, so a player holding plenty of Dewdrops got an enabled-looking
   * button whose click the sim silently discarded.
   */
  getUpgradeLockReason?: (upgradeId: UpgradeId) => string | null;
}

export interface UpgradesPanelHandle {
  overlay: HTMLElement;
  open: (trigger?: HTMLElement) => void;
  close: () => void;
  isOpen: () => boolean;
  dispose: () => void;
}

export function createUpgradesPanel(store: UiStateStore, hooks: UpgradesPanelHooks = {}): UpgradesPanelHandle {
  const titleId = 'tt-upgrades-title';
  const body = el('div');
  const panel = createPanel({ titleId, labelledBy: titleId });

  // Rows are built ONCE and updated in place (text/disabled/aria-label only)
  // rather than torn down and rebuilt on every render. At a real income rate
  // (or the debug speed-up control), currency:dewdropsChanged can fire many
  // times per second — even coalesced to one render per animation frame,
  // full body.replaceChildren() every ~16ms was destroying and recreating
  // the very button a click was mid-flight against (QA finding: Playwright's
  // click kept hitting "element was detached from the DOM, retrying" on the
  // Colour Gate buy button). Stable elements make a click physically able to
  // complete regardless of how often the underlying numbers change.
  const rows = new Map<
    UpgradeId,
    { row: HTMLElement; icon: HTMLElement; meta: HTMLElement; buyBtn: HTMLButtonElement; lockNote: HTMLElement }
  >();

  for (const upgrade of UPGRADE_LIST) {
    const icon = el('span', { html: iconHtml(upgradeManifestKey(upgrade.id), icons.upgrades), 'aria-hidden': 'true' });
    const meta = el('div', { className: 'tt-upgrade-meta' }, [`Level 0 / ${upgrade.maxLevel}`]);
    // Sits in the row (not a transient toast) so the requirement stays
    // readable while the player watches the garden satisfy it.
    const lockNote = el('p', { className: 'tt-upgrade-lock' }, ['']);
    lockNote.hidden = true;
    const buyBtn = el('button', { type: 'button', className: 'tt-buy-btn' }, ['']);
    buyBtn.addEventListener('click', () => {
      if (buyBtn.disabled) return;
      dispatchEvent(new CustomEvent<PurchaseUpgradeEventDetail>(PURCHASE_UPGRADE_EVENT, { detail: { upgradeId: upgrade.id } }));
      if (hooks.onPurchaseUpgrade) {
        hooks.onPurchaseUpgrade(upgrade.id);
      } else if (isDev) {
        console.warn(
          `[terrarium/ui] Buy clicked for "${upgrade.id}" but no onPurchaseUpgrade hook is wired — ` +
            `listen for the "${PURCHASE_UPGRADE_EVENT}" window CustomEvent instead, or pass the hook into mountUI().`,
        );
      }
    });

    const row = el('div', { className: 'tt-upgrade-row' }, [
      icon,
      el('div', { className: 'tt-upgrade-info' }, [
        el('h3', {}, [upgrade.displayName]),
        el('p', {}, [upgrade.description]),
        meta,
        lockNote,
      ]),
      buyBtn,
    ]);
    rows.set(upgrade.id, { row, icon, meta, buyBtn, lockNote });
  }
  body.replaceChildren(...UPGRADE_LIST.map((u) => rows.get(u.id)!.row));

  function render(): void {
    const state = store.getState();
    for (const upgrade of UPGRADE_LIST) {
      const { meta, buyBtn, lockNote } = rows.get(upgrade.id)!;
      const level = state.upgradeLevels[upgrade.id] ?? 0;
      const maxed = level >= upgrade.maxLevel;
      // costForLevel is 1-indexed against the level being bought TO, not the
      // current level — purchaseUpgrade (src/sim/systems.ts) charges
      // costForLevel(level + 1). Displaying costForLevel(level) showed what
      // the CURRENT level had already cost, one tier cheaper than what a
      // click would actually charge, so an affordable-looking buy silently
      // did nothing once dewdrops sat between the two prices.
      const cost = maxed ? 0 : upgrade.costForLevel(level + 1);
      const canAfford = !maxed && state.dewdropTotal >= cost;
      const lockReason = maxed ? null : (hooks.getUpgradeLockReason?.(upgrade.id) ?? null);

      // "Purchased" and "placed" are different things now (2026-08-01,
      // manual placement — GameRules §9.8): a maxed automation-unlock
      // upgrade whose structure isn't built yet still needs the player to
      // do something, so "Max" alone would read as more finished than it is.
      const automationId = AUTOMATION_UPGRADE[upgrade.id];
      const readyToPlace = maxed && automationId !== undefined && !state.placedAutomations.has(automationId);

      meta.textContent = `Level ${level} / ${upgrade.maxLevel}`;
      lockNote.textContent = readyToPlace ? 'Ready to build — open the build menu below.' : (lockReason ?? '');
      lockNote.hidden = lockReason === null && !readyToPlace;
      buyBtn.disabled = maxed || !canAfford || lockReason !== null;
      buyBtn.textContent = maxed ? 'Max' : `${Math.max(0, Math.floor(cost)).toLocaleString()}`;
      buyBtn.setAttribute(
        'aria-label',
        maxed
          ? readyToPlace
            ? `${upgrade.displayName}, unlocked — open the build menu to place it`
            : `${upgrade.displayName}, maximum level reached`
          : lockReason
            ? `${upgrade.displayName}, not available yet. ${lockReason}`
            : `Buy ${upgrade.displayName} for ${cost} Dewdrops, currently level ${level} of ${upgrade.maxLevel}`,
      );
    }
  }

  function updateIcons(): void {
    for (const upgrade of UPGRADE_LIST) {
      rows.get(upgrade.id)!.icon.innerHTML = iconHtml(upgradeManifestKey(upgrade.id), icons.upgrades);
    }
  }

  const closeBtn = el(
    'button',
    { type: 'button', className: 'tt-panel-close', 'aria-label': 'Close Upgrades' },
    [el('span', { html: icons.close, 'aria-hidden': 'true' })],
  );
  closeBtn.addEventListener('click', () => panel.close());

  panel.dialog.append(
    el('div', { className: 'tt-panel-header' }, [el('h2', { id: titleId }, ['Upgrades']), closeBtn]),
    body,
  );

  preloadManifestIcons(UPGRADE_LIST.map((u) => upgradeManifestKey(u.id)));

  render();
  const unsubscribeState = store.subscribe(render);
  const unsubscribeIcons = onManifestIconsReady(updateIcons);

  return {
    overlay: panel.overlay,
    open: panel.open,
    close: panel.close,
    isOpen: panel.isOpen,
    dispose: () => {
      unsubscribeState();
      unsubscribeIcons();
    },
  };
}
