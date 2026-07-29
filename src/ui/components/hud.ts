// Minimal, unobtrusive Dewdrop counter. Deliberately NOT an aria-live
// region — it updates constantly as habitats tick, and a live region on a
// fast-changing counter is screen-reader spam. It's a normal, tab-reachable
// status element instead; a screen reader user can visit it on demand.

import { el } from '../dom';
import { icons } from '../icons';
import type { UiStateStore } from '../uiState';

export interface HudHandle {
  element: HTMLElement;
  dispose: () => void;
}

export function createHud(store: UiStateStore): HudHandle {
  const count = el('span', { className: 'tt-hud-count' }, ['0']);
  const element = el(
    'div',
    { className: 'tt-hud', role: 'group', 'aria-label': 'Dewdrops: 0' },
    [
      el('span', { className: 'tt-hud-icon', html: icons.dewdrop }),
      el('span', { className: 'tt-hud-label' }, ['Dewdrops']),
      count,
    ],
  );

  function render(): void {
    const total = store.getState().dewdropTotal;
    const formatted = Math.floor(total).toLocaleString();
    count.textContent = formatted;
    element.setAttribute('aria-label', `Dewdrops: ${formatted}`);
  }

  render();
  const unsubscribe = store.subscribe(render);

  return { element, dispose: unsubscribe };
}
