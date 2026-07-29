// Garden Journal panel: 12 slots, 4 discoverable in Phase 1 (ember/dew/sun/
// star), remaining 8 shown as locked silhouettes. Wired to
// journal:entryDiscovered.

import { SPROUT_TYPE_LIST } from '../../data/sproutTypes';
import { el } from '../dom';
import { icons } from '../icons';
import { createJournalModel, type JournalModel } from '../journalModel';
import { iconHtml, onManifestIconsReady, preloadManifestIcons } from '../manifestIcons';
import { createPanel } from '../panel';
import { safeColor, safeDisplayName, sproutIconKey, sproutManifestIconKey } from '../sproutVisuals';
import type { UiStateStore } from '../uiState';

export interface JournalPanelHandle {
  overlay: HTMLElement;
  open: (trigger?: HTMLElement) => void;
  close: () => void;
  isOpen: () => boolean;
  dispose: () => void;
}

function renderSlots(model: JournalModel): HTMLElement {
  const grid = el('div', { className: 'tt-journal-grid' });
  for (const slot of model.slots) {
    if (slot.kind === 'discoverable') {
      const label = slot.discovered ? safeDisplayName(slot.sproutType) : 'Not yet discovered';
      grid.append(
        el(
          'div',
          {
            className: 'tt-journal-slot',
            'data-discovered': slot.discovered,
            style: slot.discovered ? `color:${safeColor(slot.sproutType)}` : undefined,
          },
          [
            el('span', {
              'aria-hidden': 'true',
              html: slot.discovered
                ? iconHtml(sproutManifestIconKey(slot.sproutType), icons[sproutIconKey(slot.sproutType)])
                : icons.lockedSlot,
              style: slot.discovered ? undefined : 'color:var(--tt-text-muted)',
            }),
            el('span', {}, [label]),
          ],
        ),
      );
    } else {
      grid.append(
        el('div', { className: 'tt-journal-slot', 'data-discovered': false }, [
          el('span', { html: icons.lockedSlot, style: 'color:var(--tt-text-muted)' }),
          el('span', {}, ['Locked']),
        ]),
      );
    }
  }
  return grid;
}

export function createJournalPanel(store: UiStateStore): JournalPanelHandle {
  const titleId = 'tt-journal-title';
  const body = el('div');
  const panel = createPanel({ titleId, labelledBy: titleId });

  function render(): void {
    const model = createJournalModel(store.getState().journalDiscovered);
    body.replaceChildren(
      el('p', { className: 'tt-panel-desc' }, [
        `${model.slots.filter((s) => s.kind === 'discoverable' && s.discovered).length} of ${model.totalSlots} discovered.`,
      ]),
      renderSlots(model),
    );
  }

  const closeBtn = el(
    'button',
    { type: 'button', className: 'tt-panel-close', 'aria-label': 'Close Garden Journal' },
    [el('span', { html: icons.close, 'aria-hidden': 'true' })],
  );
  closeBtn.addEventListener('click', () => panel.close());

  panel.dialog.append(
    el('div', { className: 'tt-panel-header' }, [
      el('h2', { id: titleId }, ['Garden Journal']),
      closeBtn,
    ]),
    body,
  );

  preloadManifestIcons(SPROUT_TYPE_LIST.map((def) => def.silhouetteKey));

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
