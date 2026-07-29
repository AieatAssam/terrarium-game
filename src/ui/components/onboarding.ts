// One action at a time onboarding: a single soft callout, not a modal
// sequence. Mounted synchronously (no await before this runs) so it's on
// screen well within the 5-second budget regardless of asset/engine load
// time. Dismisses itself on explicit close, or the first time the player
// actually drops a Sprout (success or not — either means they found the
// interaction).

import { el } from '../dom';
import { icons } from '../icons';
import type { EventBus } from '../../events';

export interface OnboardingHandle {
  element: HTMLElement;
  dispose: () => void;
}

export function createOnboarding(bus: EventBus): OnboardingHandle {
  const element = el(
    'div',
    { className: 'tt-onboarding', role: 'status' },
    [
      el('p', {}, ['Drag a Sprout to its glowing home.']),
      el(
        'button',
        {
          type: 'button',
          className: 'tt-onboarding-close',
          'aria-label': 'Dismiss tip',
        },
        [el('span', { html: icons.close, 'aria-hidden': 'true' })],
      ),
    ],
  );

  function dismiss(): void {
    if (element.isConnected) element.remove();
    unsubscribeCorrect();
    unsubscribeIncorrect();
  }

  element.querySelector('button')?.addEventListener('click', dismiss);
  const unsubscribeCorrect = bus.subscribe('sprout:placed:correct', dismiss);
  const unsubscribeIncorrect = bus.subscribe('sprout:placed:incorrect', dismiss);

  return { element, dispose: dismiss };
}
