// Bottom nav bar: icon + short label buttons that open each panel. Every
// button pairs an icon with a visible plain-language label (never icon-only)
// and exposes aria-expanded so screen reader users know a given panel is
// open. Icons render an instant hand-drawn fallback, then swap to C's real
// manifest art once it loads (see manifestIcons.ts).

import { el } from '../dom';
import { onManifestIconsReady } from '../manifestIcons';

export interface NavItem {
  key: string;
  label: string;
  iconHtml: () => string;
  isOpen: () => boolean;
  open: (trigger?: HTMLElement) => void;
}

export interface NavHandle {
  element: HTMLElement;
  dispose: () => void;
}

export function createNav(items: NavItem[]): NavHandle {
  const element = el('nav', { className: 'tt-nav', 'aria-label': 'Garden menu' });

  const buttons = items.map((item) => {
    const iconSpan = el('span', { 'aria-hidden': 'true', html: item.iconHtml() });
    const button = el(
      'button',
      {
        type: 'button',
        className: 'tt-nav-btn',
        'aria-pressed': false,
        'aria-expanded': false,
        'aria-label': item.label,
      },
      [iconSpan, el('span', {}, [item.label])],
    );
    button.addEventListener('click', () => item.open(button));
    element.append(button);
    return { item, button, iconSpan };
  });

  function refreshIcons(): void {
    for (const { item, iconSpan } of buttons) iconSpan.innerHTML = item.iconHtml();
  }
  const unsubscribeIcons = onManifestIconsReady(refreshIcons);

  // Poll open/closed state cheaply after any click anywhere (panels close
  // via Escape/overlay click too, not just their own button) — a light
  // interval-based approach that's plenty for a handful of panels.
  function syncPressedStates(): void {
    for (const { item, button } of buttons) {
      const open = item.isOpen();
      button.setAttribute('aria-pressed', String(open));
      button.setAttribute('aria-expanded', String(open));
    }
  }
  const interval = window.setInterval(syncPressedStates, 200);

  return {
    element,
    dispose: () => {
      window.clearInterval(interval);
      unsubscribeIcons();
    },
  };
}
