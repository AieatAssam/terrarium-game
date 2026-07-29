// Achievements panel (list, read live from src/data/achievements.ts) plus a
// toast notification on achievement:unlocked. The toast region is the one
// place that uses aria-live — a one-off unlock announcement is exactly what
// live regions are for, unlike the constantly-ticking Dewdrop HUD.

import { ACHIEVEMENT_LIST } from '../../data/achievements';
import type { EventBus } from '../../events';
import { el } from '../dom';
import { icons } from '../icons';
import { createPanel } from '../panel';
import type { UiStateStore } from '../uiState';

export interface AchievementsPanelHandle {
  overlay: HTMLElement;
  open: (trigger?: HTMLElement) => void;
  close: () => void;
  isOpen: () => boolean;
  dispose: () => void;
}

export function createAchievementsPanel(store: UiStateStore): AchievementsPanelHandle {
  const titleId = 'tt-achievements-title';
  const body = el('div');
  const panel = createPanel({ titleId, labelledBy: titleId });

  function render(): void {
    const unlocked = store.getState().unlockedAchievements;
    body.replaceChildren(
      ...ACHIEVEMENT_LIST.map((achievement) => {
        const isUnlocked = unlocked.has(achievement.id);
        return el('div', { className: 'tt-achievement-row', 'data-unlocked': isUnlocked }, [
          el('span', { html: icons.achievements, 'aria-hidden': 'true' }),
          el('div', {}, [
            el('h3', {}, [achievement.displayName]),
            el('p', {}, [isUnlocked ? achievement.rewardText : 'Not yet unlocked.']),
          ]),
        ]);
      }),
    );
  }

  const closeBtn = el(
    'button',
    { type: 'button', className: 'tt-panel-close', 'aria-label': 'Close Achievements' },
    [el('span', { html: icons.close, 'aria-hidden': 'true' })],
  );
  closeBtn.addEventListener('click', () => panel.close());

  panel.dialog.append(
    el('div', { className: 'tt-panel-header' }, [el('h2', { id: titleId }, ['Achievements']), closeBtn]),
    body,
  );

  render();
  const unsubscribe = store.subscribe(render);

  return {
    overlay: panel.overlay,
    open: panel.open,
    close: panel.close,
    isOpen: panel.isOpen,
    dispose: unsubscribe,
  };
}

const TOAST_VISIBLE_MS = 4200;

export interface ToastRegionHandle {
  element: HTMLElement;
  dispose: () => void;
}

export function createAchievementToastRegion(bus: EventBus): ToastRegionHandle {
  const element = el('div', { className: 'tt-toast-region', role: 'status', 'aria-live': 'polite' });

  const unsubscribe = bus.subscribe('achievement:unlocked', (event) => {
    const def = ACHIEVEMENT_LIST.find((a) => a.id === event.achievementId);
    const toast = el('div', { className: 'tt-toast' }, [
      el('span', { html: icons.achievements, 'aria-hidden': 'true' }),
      el('span', {}, [`Achievement unlocked: ${def?.displayName ?? event.achievementId}`]),
    ]);
    element.append(toast);
    setTimeout(() => toast.remove(), TOAST_VISIBLE_MS);
  });

  return { element, dispose: unsubscribe };
}
