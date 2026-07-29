// "While you were away" dialog. Guarded on offlineDewdrops > 0 — nothing
// emits save:loaded with a positive amount on a brand-new save, and a "0
// Dewdrops while you were away" popup would be worse than no popup.

import type { EventBus } from '../../events';
import { el } from '../dom';
import { icons } from '../icons';
import { createPanel } from '../panel';

export interface ReturnDialogHandle {
  overlay: HTMLElement;
  dispose: () => void;
}

function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 1) return 'a little while';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  return `${hours} hour${hours === 1 ? '' : 's'}${remMinutes ? ` ${remMinutes}m` : ''}`;
}

export function createReturnDialog(bus: EventBus): ReturnDialogHandle {
  const titleId = 'tt-return-title';
  const panel = createPanel({ titleId, labelledBy: titleId });
  panel.dialog.classList.add('tt-return-dialog');

  const unsubscribe = bus.subscribe('save:loaded', (event) => {
    if (event.offlineDewdrops <= 0) return;

    panel.dialog.replaceChildren(
      el('span', { className: 'tt-return-icon', html: icons.homeReturn, 'aria-hidden': 'true' }),
      el('h2', { id: titleId }, ['Welcome back!']),
      el('p', {}, [
        `While you were away for ${formatDuration(event.offlineSeconds)}, your garden collected ` +
          `${Math.floor(event.offlineDewdrops).toLocaleString()} Dewdrops.`,
      ]),
      (() => {
        const dismiss = el('button', { type: 'button', className: 'tt-return-dismiss' }, ['Back to the garden']);
        dismiss.addEventListener('click', () => panel.close());
        return dismiss;
      })(),
    );

    // First paint should not be blocked by anything slow — this only ever
    // opens in reaction to a real save:loaded event, well after mount.
    panel.open();
  });

  return { overlay: panel.overlay, dispose: unsubscribe };
}
