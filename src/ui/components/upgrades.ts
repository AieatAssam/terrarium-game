// Upgrades panel: lists the six upgrades straight from src/data/upgrades.ts
// (read live, never hardcoded — B is still filling in real balance values).
// Level is mirrored purely from `upgrade:purchased` events; it never
// advances optimistically on click, so the UI can't show progress the sim
// hasn't confirmed.

import type { UpgradeId } from '../../core/ids';
import { UPGRADE_LIST } from '../../data/upgrades';
import { el } from '../dom';
import { icons } from '../icons';
import { iconHtml, onManifestIconsReady, preloadManifestIcons } from '../manifestIcons';
import { createPanel } from '../panel';
import type { UiStateStore } from '../uiState';

function upgradeManifestKey(id: UpgradeId): string {
  return `ui.icon.upgrade.${id}`;
}

export interface UpgradesPanelHooks {
  onPurchaseUpgrade?: (upgradeId: UpgradeId) => void;
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

  function render(): void {
    const state = store.getState();
    body.replaceChildren(
      ...UPGRADE_LIST.map((upgrade) => {
        const level = state.upgradeLevels[upgrade.id] ?? 0;
        const maxed = level >= upgrade.maxLevel;
        const cost = maxed ? 0 : upgrade.costForLevel(level);
        const canAfford = !maxed && state.dewdropTotal >= cost;

        const buyBtn = el(
          'button',
          {
            type: 'button',
            className: 'tt-buy-btn',
            disabled: maxed || !canAfford,
            'aria-label': maxed
              ? `${upgrade.displayName}, maximum level reached`
              : `Buy ${upgrade.displayName} for ${cost} Dewdrops, currently level ${level} of ${upgrade.maxLevel}`,
          },
          [maxed ? 'Max' : `${Math.max(0, Math.floor(cost)).toLocaleString()}`],
        );
        if (!maxed) {
          buyBtn.addEventListener('click', () => hooks.onPurchaseUpgrade?.(upgrade.id));
        }

        return el('div', { className: 'tt-upgrade-row' }, [
          el('span', { html: iconHtml(upgradeManifestKey(upgrade.id), icons.upgrades), 'aria-hidden': 'true' }),
          el('div', { className: 'tt-upgrade-info' }, [
            el('h3', {}, [upgrade.displayName]),
            el('p', {}, [upgrade.description]),
            el('div', { className: 'tt-upgrade-meta' }, [`Level ${level} / ${upgrade.maxLevel}`]),
          ]),
          buyBtn,
        ]);
      }),
    );
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
  const unsubscribeIcons = onManifestIconsReady(render);

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
