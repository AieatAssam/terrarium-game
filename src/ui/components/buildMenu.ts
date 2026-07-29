// Build menu: icon buttons for placing unlocked automations (Garden Slide,
// Colour Gate). This is the MENU only — selecting an item enters "placement
// mode" and shows a selected state; the actual 3D ghost/valid-invalid
// preview in the scene is Subagent E's (src/render + src/input).
//
// Cross-module contract for "player wants to place X": no GameEvent exists
// for a UI-initiated build-mode request (docs/CONTRACTS.md's event union is
// all sim-originated). Two things are offered so integration doesn't block
// on a CONTRACTS.md edit:
//   1. `onEnterBuildMode` / `onExitBuildMode` callbacks passed into mountUI.
//   2. A `window` CustomEvent('terrarium:buildMode', { detail: { automationId
//      | null } }) dispatched on every change, as a zero-import fallback E's
//      input layer can listen for without depending on src/ui.
// Both are reported back for the integrator to wire into a real command
// path once one exists.

import type { AutomationId } from '../../core/ids';
import type { EventBus } from '../../events';
import { el } from '../dom';
import { icons } from '../icons';
import { iconHtml, onManifestIconsReady, preloadManifestIcons } from '../manifestIcons';
import type { UiStateStore } from '../uiState';

export const BUILD_MODE_EVENT = 'terrarium:buildMode';

export interface BuildModeEventDetail {
  automationId: AutomationId | null;
}

export interface BuildMenuHooks {
  onEnterBuildMode?: (automationId: AutomationId) => void;
  onExitBuildMode?: () => void;
}

export interface BuildMenuHandle {
  element: HTMLElement;
  dispose: () => void;
}

const AUTOMATION_LABEL: Record<AutomationId, string> = {
  gardenSlide: 'Garden Slide',
  colourGate: 'Colour Gate',
};

const AUTOMATION_ICON: Record<AutomationId, keyof typeof icons> = {
  gardenSlide: 'gardenSlide',
  colourGate: 'colourGate',
};

const AUTOMATION_MANIFEST_KEY: Record<AutomationId, string> = {
  gardenSlide: 'ui.icon.gardenSlide',
  colourGate: 'ui.icon.colourGate',
};

export function createBuildMenu(bus: EventBus, store: UiStateStore, hooks: BuildMenuHooks = {}): BuildMenuHandle {
  const element = el('div', { className: 'tt-buildmenu', role: 'toolbar', 'aria-label': 'Build menu' });

  let selected: AutomationId | null = null;

  function setSelected(next: AutomationId | null): void {
    selected = next;
    dispatchEvent(new CustomEvent<BuildModeEventDetail>(BUILD_MODE_EVENT, { detail: { automationId: next } }));
    if (next) hooks.onEnterBuildMode?.(next);
    else hooks.onExitBuildMode?.();
    render();
  }

  function toggle(automationId: AutomationId): void {
    setSelected(selected === automationId ? null : automationId);
  }

  function render(): void {
    const unlocked = Array.from(store.getState().unlockedAutomations).sort();
    element.replaceChildren(
      ...unlocked.map((automationId) => {
        const isSelected = selected === automationId;
        const button = el(
          'button',
          {
            type: 'button',
            className: 'tt-buildmenu-item',
            'aria-pressed': isSelected,
            'aria-label': `${AUTOMATION_LABEL[automationId]}${isSelected ? ' (selected — click to cancel placement)' : ''}`,
          },
          [
            el('span', {
              'aria-hidden': 'true',
              html: iconHtml(AUTOMATION_MANIFEST_KEY[automationId], icons[AUTOMATION_ICON[automationId]]),
            }),
            el('span', {}, [AUTOMATION_LABEL[automationId]]),
          ],
        );
        button.addEventListener('click', () => toggle(automationId));
        return button;
      }),
    );
  }

  preloadManifestIcons(Object.values(AUTOMATION_MANIFEST_KEY));

  render();
  const unsubscribeState = store.subscribe(render);
  const unsubscribeIcons = onManifestIconsReady(render);
  // A successful build exits placement mode automatically.
  const unsubscribeBuilt = bus.subscribe('automation:built', () => {
    if (selected) setSelected(null);
  });

  return {
    element,
    dispose: () => {
      unsubscribeState();
      unsubscribeIcons();
      unsubscribeBuilt();
    },
  };
}
