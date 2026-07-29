import { CREDITS_SECTIONS } from '../creditsContent';
import { el } from '../dom';
import { icons } from '../icons';
import { createPanel } from '../panel';

export interface CreditsPanelHandle {
  overlay: HTMLElement;
  open: (trigger?: HTMLElement) => void;
  close: () => void;
  isOpen: () => boolean;
}

export function createCreditsPanel(): CreditsPanelHandle {
  const titleId = 'tt-credits-title';
  const panel = createPanel({ titleId, labelledBy: titleId });

  const body = el(
    'div',
    {},
    CREDITS_SECTIONS.map((section) =>
      el('div', { className: 'tt-credits-section' }, [
        el('h3', {}, [section.heading]),
        el(
          'ul',
          {},
          section.items.map((item) => el('li', {}, [item])),
        ),
      ]),
    ),
  );

  const closeBtn = el(
    'button',
    { type: 'button', className: 'tt-panel-close', 'aria-label': 'Close Credits' },
    [el('span', { html: icons.close, 'aria-hidden': 'true' })],
  );
  closeBtn.addEventListener('click', () => panel.close());

  panel.dialog.append(
    el('div', { className: 'tt-panel-header' }, [el('h2', { id: titleId }, ['Credits']), closeBtn]),
    body,
  );

  return { overlay: panel.overlay, open: panel.open, close: panel.close, isOpen: panel.isOpen };
}
