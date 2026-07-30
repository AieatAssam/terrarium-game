// The Nursery's own voice: a small, warm note that appears beside the Dewdrop
// counter when the pod eases off or rests because a crowd of Sprouts is still
// looking for homes.
//
// This is the player-facing half of the accumulation rule in
// src/data/spawning.ts. GameRules §9.7 requires a bottleneck to be "a kind
// opportunity for problem-solving", shown "through animation/world state", with
// "a simple recommended solution" offered — never hidden in a metrics panel.
// §11 requires the copy to be friendly and concrete ("This home is already cosy
// and full"), never a technical error.
//
// So the note:
//   * says what the garden is doing, in garden language ("the nursery pod is
//     taking its time"), never "spawn rate throttled";
//   * says exactly how many little ones are waiting, so the cause is legible;
//   * offers the two real ways out — settle some by hand, or make more room —
//     with a button straight to Upgrades for the second;
//   * is reassuring about what is NOT happening: nobody leaves, nothing is
//     lost, and the pod picks straight back up.
//
// Accessibility: unlike the Dewdrop counter next to it (which updates many
// times a second and is deliberately NOT a live region), the rhythm changes
// rarely and matters, so this IS `aria-live="polite"` — a screen reader user
// should be told the garden has gone quiet without having to go looking.

import { el } from '../dom';
import type { UiStateStore } from '../uiState';

export interface NurseryNoteHooks {
  /** Opens the Upgrades panel — the "make more room" recommendation. */
  onOpenUpgrades?: (trigger?: HTMLElement) => void;
}

export interface NurseryNoteHandle {
  element: HTMLElement;
  dispose: () => void;
}

function waitingPhrase(count: number): string {
  if (count === 1) return 'one little one is';
  return `${count} little ones are`;
}

export function createNurseryNote(store: UiStateStore, hooks: NurseryNoteHooks = {}): NurseryNoteHandle {
  const heading = el('strong', { className: 'tt-nursery-note-title' }, ['']);
  const body = el('p', { className: 'tt-nursery-note-body' }, ['']);
  const action = el('button', { type: 'button', className: 'tt-nursery-note-action' }, ['Find more room']);
  action.addEventListener('click', () => hooks.onOpenUpgrades?.(action));

  const element = el(
    'div',
    {
      className: 'tt-nursery-note',
      role: 'status',
      'aria-live': 'polite',
    },
    [heading, body, action],
  );
  element.hidden = true;

  function render(): void {
    const { nurseryRhythm, waitingSproutCount } = store.getState();

    if (nurseryRhythm === 'lively') {
      element.hidden = true;
      return;
    }

    const waiting = waitingPhrase(waitingSproutCount);
    if (nurseryRhythm === 'easing') {
      heading.textContent = 'The nursery is taking its time.';
      body.textContent =
        `${waiting} still looking for a home, so the pod has slowed to a gentle rhythm. ` +
        'Settle a few into their habitats and it will pick right back up.';
    } else {
      heading.textContent = 'The nursery is having a rest.';
      body.textContent =
        `${waiting} waiting for somewhere to live, so the pod is dozing rather than adding to the crowd. ` +
        'Nobody is going anywhere — settle some of them, or clear a little more room in the habitats, ' +
        'and it will wake up straight away.';
    }
    element.classList.toggle('is-resting', nurseryRhythm === 'resting');
    element.hidden = false;
  }

  render();
  const unsubscribe = store.subscribe(render);

  return { element, dispose: unsubscribe };
}
