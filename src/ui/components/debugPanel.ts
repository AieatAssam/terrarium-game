// Dev-only debug panel (brief: "allow spawning each Sprout type, including
// Star Sprout; granting Dewdrops; speeding simulation; and resetting save
// data"). Gated by isDev at the call site in src/ui/index.ts — this module
// is never imported, let alone rendered, in a production build.

import type { SproutTypeId } from '../../core/ids';
import { el } from '../dom';

export interface DebugPanelHooks {
  spawnSprout: (sproutType: SproutTypeId) => void;
  grantDewdrops: (amount: number) => void;
  setSpeedMultiplier: (multiplier: number) => void;
  resetSave: () => Promise<void>;
}

export interface DebugPanelHandle {
  element: HTMLElement;
  dispose: () => void;
}

const SPROUT_TYPES: SproutTypeId[] = ['ember', 'dew', 'sun', 'star'];

export function createDebugPanel(hooks: DebugPanelHooks): DebugPanelHandle {
  const status = el('span', { className: 'tt-debug-status', 'aria-live': 'polite' }, ['']);

  const spawnButtons = SPROUT_TYPES.map((type) => {
    const button = el(
      'button',
      { type: 'button', className: 'tt-debug-btn', 'data-testid': `debug-spawn-${type}` },
      [`Spawn ${type}`],
    );
    button.addEventListener('click', () => {
      hooks.spawnSprout(type);
      status.textContent = `Spawned ${type}`;
    });
    return button;
  });

  const grantButton = el('button', { type: 'button', className: 'tt-debug-btn', 'data-testid': 'debug-grant-dewdrops' }, [
    '+50 Dewdrops',
  ]);
  grantButton.addEventListener('click', () => {
    hooks.grantDewdrops(50);
    status.textContent = 'Granted 50 Dewdrops';
  });

  const speedButtons = [1, 5, 20].map((multiplier) => {
    const button = el(
      'button',
      { type: 'button', className: 'tt-debug-btn', 'data-testid': `debug-speed-${multiplier}x` },
      [`${multiplier}x speed`],
    );
    button.addEventListener('click', () => {
      hooks.setSpeedMultiplier(multiplier);
      status.textContent = `Speed set to ${multiplier}x`;
    });
    return button;
  });

  const resetButton = el('button', { type: 'button', className: 'tt-debug-btn tt-debug-btn-danger', 'data-testid': 'debug-reset-save' }, [
    'Reset save',
  ]);
  resetButton.addEventListener('click', () => {
    if (!window.confirm('Reset all saved progress? This cannot be undone.')) return;
    void hooks.resetSave().then(() => {
      // Reload rather than asking the player to: resetSave stops the sim and
      // drops its state, so what's left on screen is a stale garden nothing is
      // driving any more. The renderer has no teardown path for "every mesh at
      // once", and a reload is both the honest representation of a fresh save
      // and what the player expects from a reset.
      status.textContent = 'Save reset — reloading…';
      window.location.reload();
    });
  });

  const element = el(
    'div',
    { className: 'tt-debug-panel', role: 'region', 'aria-label': 'Development debug panel' },
    [
      el('div', { className: 'tt-debug-title' }, ['DEV DEBUG']),
      el('div', { className: 'tt-debug-row' }, spawnButtons),
      el('div', { className: 'tt-debug-row' }, [grantButton, ...speedButtons]),
      el('div', { className: 'tt-debug-row' }, [resetButton]),
      status,
    ],
  );

  return {
    element,
    dispose: () => {
      element.remove();
    },
  };
}
