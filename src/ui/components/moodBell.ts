// The Mood Bell's control surface — GameRules §9.5 (names "Mood Bell"
// explicitly among Routing helpers), §7.3 (names "mood" as a future Sprout
// trait), §9.6 stage 4 ("multi-attribute routes").
//
// Simpler than the Colour Gate's panel: the Bell has ONE rule, not a 2-lane
// map, so the whole control is a single row of picture choices — Sunny or
// Sleepy — with no per-choice mismatch note needed. A Mood Bell delivery is
// always correct by construction (it carries a matching-mood Sprout to ITS
// OWN correct habitat, computed from its type), unlike a Colour Gate lane
// the player could point at the wrong home.
//
// The panel never writes game state itself. It calls `setMoodBellRule`, and
// re-renders only from what the store mirrors back off
// `automation:moodBellRuleChanged` — so it can never show a rule the
// simulation has not actually adopted.

import type { MoodId } from '../../core/ids';
import { el } from '../dom';
import { icons } from '../icons';
import { iconHtml, onManifestIconsReady, preloadManifestIcons } from '../manifestIcons';
import { moodIconKey, safeMoodColor, safeMoodDisplayName } from '../moodVisuals';
import { createPanel } from '../panel';
import type { UiStateStore } from '../uiState';

export interface MoodBellPanelHooks {
  onSetMoodBellRule?: (mood: MoodId) => void;
}

export interface MoodBellPanelHandle {
  overlay: HTMLElement;
  open: (trigger?: HTMLElement) => void;
  close: () => void;
  isOpen: () => boolean;
  /** True once the player owns a Mood Bell — the nav entry hides until then. */
  isAvailable: () => boolean;
  dispose: () => void;
}

const CHOOSABLE: MoodId[] = ['sunny', 'sleepy'];

/** assets/manifest.json key for a mood's real icon art, mirroring sproutManifestIconKey's shape. */
function moodManifestIconKey(mood: MoodId): string {
  return `mood.${mood}.badge`;
}

export function createMoodBellPanel(store: UiStateStore, hooks: MoodBellPanelHooks = {}): MoodBellPanelHandle {
  const titleId = 'tt-moodbell-title';
  const panel = createPanel({ titleId, labelledBy: titleId });
  const choices = new Map<MoodId, HTMLButtonElement>();
  const summary = el('p', { className: 'tt-gate-summary' }, ['']);

  function buildChoice(mood: MoodId): HTMLButtonElement {
    const art = el('span', {
      className: 'tt-gate-choice-art',
      html: iconHtml(moodManifestIconKey(mood), icons[moodIconKey(mood)]),
      'aria-hidden': 'true',
    });
    art.style.color = safeMoodColor(mood);

    const button = el(
      'button',
      { type: 'button', className: 'tt-gate-choice', 'aria-pressed': false },
      [art, el('span', { className: 'tt-gate-choice-name' }, [safeMoodDisplayName(mood)])],
    );
    button.addEventListener('click', () => {
      hooks.onSetMoodBellRule?.(mood);
    });
    return button;
  }

  const choiceRow = el('div', { className: 'tt-gate-choices', role: 'group', 'aria-label': 'Which little ones the Bell welcomes' });
  for (const mood of CHOOSABLE) {
    const button = buildChoice(mood);
    choices.set(mood, button);
    choiceRow.append(button);
  }

  function render(): void {
    const state = store.getState();
    const chosen = state.moodBellRule;
    summary.textContent = `Carrying every ${safeMoodDisplayName(chosen)} little one straight home, of any colour.`;
    for (const [mood, button] of choices) {
      const active = mood === chosen;
      button.setAttribute('aria-pressed', String(active));
      button.classList.toggle('is-active', active);
      button.setAttribute(
        'aria-label',
        `Carry ${safeMoodDisplayName(mood)} little ones home${active ? ' (currently chosen)' : ''}`,
      );
    }
  }

  function updateIcons(): void {
    for (const [mood, button] of choices) {
      const art = button.querySelector('.tt-gate-choice-art');
      if (art) art.innerHTML = iconHtml(moodManifestIconKey(mood), icons[moodIconKey(mood)]);
    }
  }

  const closeBtn = el(
    'button',
    { type: 'button', className: 'tt-panel-close', 'aria-label': 'Close Mood Bell' },
    [el('span', { html: icons.close, 'aria-hidden': 'true' })],
  );
  closeBtn.addEventListener('click', () => panel.close());

  panel.dialog.append(
    el('div', { className: 'tt-panel-header' }, [el('h2', { id: titleId }, ['Mood Bell']), closeBtn]),
    el('p', { className: 'tt-gate-intro' }, [
      'Your Mood Bell rings for whichever little ones are Sunny or Sleepy — choose which, and it carries every ' +
        'one of that mood straight to their own home, whatever colour they are. Everyone else keeps travelling ' +
        "however they already were: your Garden Slide, your Colour Gate, or your own two hands.",
    ]),
    el('section', { className: 'tt-gate-lane' }, [summary, choiceRow]),
  );

  preloadManifestIcons(CHOOSABLE.map(moodManifestIconKey));

  render();
  const unsubscribeState = store.subscribe(render);
  const unsubscribeIcons = onManifestIconsReady(updateIcons);

  return {
    overlay: panel.overlay,
    open: panel.open,
    close: panel.close,
    isOpen: panel.isOpen,
    isAvailable: () => store.getState().unlockedAutomations.has('moodBell'),
    dispose: () => {
      unsubscribeState();
      unsubscribeIcons();
    },
  };
}
