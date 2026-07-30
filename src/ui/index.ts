// Mounts the whole UI layer: onboarding, HUD, build menu, Garden Journal,
// Upgrades, Achievements (+toast), Settings, Return dialog, Credits.
//
// Design constraints from the brief:
//  - Must be safe to mount synchronously, before Babylon/engine load, so the
//    onboarding callout is visible within 5s regardless of asset loading.
//  - Only ever imports event *types*/data from src/events and src/data, plus
//    src/core ids — never src/render, src/input or src/sim internals.
//  - Owns and creates its own AudioSystem (src/audio) unless one is injected
//    (tests, or a future integrator wiring point).

import type { UpgradeId } from '../core/ids';
import { isDev } from '../core/env';
import type { EventBus } from '../events';
import { createAudioSystem, type AudioSystem } from '../audio';

import { createAchievementsPanel, createAchievementToastRegion } from './components/achievements';
import { createBuildMenu, type BuildMenuHooks } from './components/buildMenu';
import { createCreditsPanel } from './components/credits';
import { createDebugPanel, type DebugPanelHooks } from './components/debugPanel';
import { createHud } from './components/hud';
import { createJournalPanel } from './components/journal';
import { createNav } from './components/nav';
import { createOnboarding } from './components/onboarding';
import { createReturnDialog } from './components/returnDialog';
import { createSettingsPanel } from './components/settings';
import { createUpgradesPanel } from './components/upgrades';
import { el } from './dom';
import { icons } from './icons';
import { iconHtml, preloadManifestIcons } from './manifestIcons';
import { injectUiStyles } from './styles';
import { createUiStateStore } from './uiState';

export interface MountUIOptions extends BuildMenuHooks {
  /** Inject an AudioSystem (e.g. in tests); otherwise one is created. */
  audio?: AudioSystem;
  onPurchaseUpgrade?: (upgradeId: UpgradeId) => void;
  /** See UpgradesPanelHooks — explains a behavioral (non-price) lock, e.g. the Colour Gate's. */
  getUpgradeLockReason?: (upgradeId: UpgradeId) => string | null;
  /** Dev-only debug controls — only rendered when isDev is true AND this is provided. */
  debug?: DebugPanelHooks;
}

export interface UIHandle {
  dispose: () => void;
  audio: AudioSystem;
}

export function mountUI(root: HTMLElement, bus: EventBus, options: MountUIOptions = {}): UIHandle {
  injectUiStyles();

  const audio = options.audio ?? createAudioSystem(bus);
  const store = createUiStateStore(bus);

  // Dev-only manual test hook (bus.emit(...) from the console to exercise
  // audio/UI reactions without a running sim yet). Dead-code-eliminated in
  // production builds since `isDev` is a build-time constant — see
  // src/core/env.ts. Distinct name (__terrariumUIF) so it can't collide with
  // any debug global another agent's area might add.
  if (isDev) {
    (window as unknown as Record<string, unknown>).__terrariumUIF = { bus, audio, store };
  }

  const layer = el('div', { className: 'tt-root' });
  root.appendChild(layer);

  // Unlock/resume audio on the first real user gesture anywhere on the page,
  // per autoplay policy. Also starts the ambient loop. Bound to `window`, NOT
  // `layer`: `.tt-root` is `pointer-events: none` (so it's outside the hit-test
  // path) and lives outside #app as a sibling of the canvas anyway, so a
  // listener on `layer` would never see pointerdowns on the canvas — the
  // primary interaction surface. A player who only ever drags Sprouts must
  // still unlock audio.
  const resumeAudio = () => audio.resume();
  window.addEventListener('pointerdown', resumeAudio, { once: true });
  window.addEventListener('keydown', resumeAudio, { once: true });

  const onboarding = createOnboarding(bus);
  const hud = createHud(store);
  const buildMenu = createBuildMenu(bus, store, {
    onEnterBuildMode: options.onEnterBuildMode,
    onExitBuildMode: options.onExitBuildMode,
  });
  const toastRegion = createAchievementToastRegion(bus);

  const journalPanel = createJournalPanel(store);
  const upgradesPanel = createUpgradesPanel(store, {
    onPurchaseUpgrade: options.onPurchaseUpgrade,
    getUpgradeLockReason: options.getUpgradeLockReason,
  });
  const achievementsPanel = createAchievementsPanel(store);
  const settingsPanel = createSettingsPanel(audio);
  const creditsPanel = createCreditsPanel();
  const returnDialog = createReturnDialog(bus);
  const debugPanel = isDev && options.debug ? createDebugPanel(options.debug) : undefined;

  preloadManifestIcons(['ui.icon.journal', 'ui.icon.settings', 'ui.icon.credits']);

  const nav = createNav([
    {
      key: 'journal',
      label: 'Journal',
      iconHtml: () => iconHtml('ui.icon.journal', icons.journal),
      isOpen: journalPanel.isOpen,
      open: journalPanel.open,
    },
    {
      key: 'upgrades',
      label: 'Upgrades',
      iconHtml: () => icons.upgrades,
      isOpen: upgradesPanel.isOpen,
      open: upgradesPanel.open,
    },
    {
      key: 'achievements',
      label: 'Achievements',
      iconHtml: () => icons.achievements,
      isOpen: achievementsPanel.isOpen,
      open: achievementsPanel.open,
    },
    {
      key: 'settings',
      label: 'Settings',
      iconHtml: () => iconHtml('ui.icon.settings', icons.settings),
      isOpen: settingsPanel.isOpen,
      open: settingsPanel.open,
    },
    {
      key: 'credits',
      label: 'Credits',
      iconHtml: () => iconHtml('ui.icon.credits', icons.credits),
      isOpen: creditsPanel.isOpen,
      open: creditsPanel.open,
    },
  ]);

  layer.append(
    hud.element,
    onboarding.element,
    buildMenu.element,
    nav.element,
    toastRegion.element,
    journalPanel.overlay,
    upgradesPanel.overlay,
    achievementsPanel.overlay,
    settingsPanel.overlay,
    creditsPanel.overlay,
    returnDialog.overlay,
  );
  if (debugPanel) layer.append(debugPanel.element);

  return {
    audio,
    dispose: () => {
      window.removeEventListener('pointerdown', resumeAudio);
      window.removeEventListener('keydown', resumeAudio);
      onboarding.dispose();
      hud.dispose();
      buildMenu.dispose();
      toastRegion.dispose();
      journalPanel.dispose();
      upgradesPanel.dispose();
      achievementsPanel.dispose();
      settingsPanel.dispose();
      returnDialog.dispose();
      debugPanel?.dispose();
      nav.dispose();
      store.dispose();
      if (!options.audio) audio.dispose();
      layer.remove();
    },
  };
}
