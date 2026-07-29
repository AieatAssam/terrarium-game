// Settings panel: music/sfx volume, mute, reduced-motion, high-contrast.
// Every change persists immediately via prefs.ts (separate localStorage
// entry, not the save envelope) and reflects live onto <html> + the audio
// system.

import type { AudioSystem } from '../../audio';
import { el } from '../dom';
import { icons } from '../icons';
import { iconHtml, onManifestIconsReady, preloadManifestIcons } from '../manifestIcons';
import { createPanel } from '../panel';
import { loadPrefs, reflectPrefsToDocument, savePrefs, type Prefs } from '../prefs';

export interface SettingsPanelHandle {
  overlay: HTMLElement;
  open: (trigger?: HTMLElement) => void;
  close: () => void;
  isOpen: () => boolean;
  dispose: () => void;
}

function toggleRow(labelText: string, checked: boolean, onChange: (next: boolean) => void): HTMLElement {
  const btn = el('button', {
    type: 'button',
    className: 'tt-toggle',
    role: 'switch',
    'aria-checked': checked,
    'aria-label': labelText,
  });
  btn.append(el('span', { className: 'tt-toggle-knob', 'aria-hidden': 'true' }));
  let state = checked;
  btn.addEventListener('click', () => {
    state = !state;
    btn.setAttribute('aria-checked', String(state));
    onChange(state);
  });
  return el('div', { className: 'tt-settings-row' }, [el('label', {}, [labelText]), btn]);
}

function sliderRow(
  labelText: string,
  id: string,
  value: number,
  onChange: (next: number) => void,
): HTMLElement {
  const input = el('input', {
    type: 'range',
    id,
    className: 'tt-slider',
    min: '0',
    max: '100',
    step: '1',
    value: String(Math.round(value * 100)),
    'aria-valuetext': `${Math.round(value * 100)} percent`,
  });
  input.addEventListener('input', () => {
    const next = Number(input.value) / 100;
    input.setAttribute('aria-valuetext', `${Math.round(next * 100)} percent`);
    onChange(next);
  });
  return el('div', { className: 'tt-settings-row' }, [el('label', { for: id }, [labelText]), input]);
}

export function createSettingsPanel(audio: AudioSystem | undefined): SettingsPanelHandle {
  const titleId = 'tt-settings-title';
  let prefs: Prefs = loadPrefs();
  reflectPrefsToDocument(prefs);
  audio?.setMusicVolume(prefs.musicVolume);
  audio?.setSfxVolume(prefs.sfxVolume);
  audio?.setMuted(prefs.muted);

  const muteIcon = el('span', {
    className: 'tt-settings-mute-icon',
    'aria-hidden': 'true',
    html: prefs.muted ? iconHtml('ui.icon.mute', icons.speakerOff) : iconHtml('ui.icon.volume', icons.speakerOn),
  });

  function renderMuteIcon(): void {
    muteIcon.innerHTML = prefs.muted
      ? iconHtml('ui.icon.mute', icons.speakerOff)
      : iconHtml('ui.icon.volume', icons.speakerOn);
  }

  function update(patch: Partial<Prefs>): void {
    prefs = { ...prefs, ...patch };
    savePrefs(prefs);
    reflectPrefsToDocument(prefs);
    if (patch.musicVolume !== undefined) audio?.setMusicVolume(patch.musicVolume);
    if (patch.sfxVolume !== undefined) audio?.setSfxVolume(patch.sfxVolume);
    if (patch.muted !== undefined) {
      audio?.setMuted(patch.muted);
      renderMuteIcon();
    }
  }

  const muteRow = toggleRow('Mute all audio', prefs.muted, (v) => update({ muted: v }));
  muteRow.prepend(muteIcon);

  const body = el('div', {}, [
    sliderRow('Music volume', 'tt-music-volume', prefs.musicVolume, (v) => update({ musicVolume: v })),
    sliderRow('Sound effects volume', 'tt-sfx-volume', prefs.sfxVolume, (v) => update({ sfxVolume: v })),
    muteRow,
    toggleRow('Reduced motion', prefs.reducedMotion, (v) => update({ reducedMotion: v })),
    toggleRow('High contrast', prefs.highContrast, (v) => update({ highContrast: v })),
  ]);

  preloadManifestIcons(['ui.icon.mute', 'ui.icon.volume']);
  const unsubscribeIcons = onManifestIconsReady(renderMuteIcon);

  const panel = createPanel({ titleId, labelledBy: titleId });
  const closeBtn = el(
    'button',
    { type: 'button', className: 'tt-panel-close', 'aria-label': 'Close Settings' },
    [el('span', { html: icons.close, 'aria-hidden': 'true' })],
  );
  closeBtn.addEventListener('click', () => panel.close());

  panel.dialog.append(
    el('div', { className: 'tt-panel-header' }, [el('h2', { id: titleId }, ['Settings']), closeBtn]),
    body,
  );

  return {
    overlay: panel.overlay,
    open: panel.open,
    close: panel.close,
    isOpen: panel.isOpen,
    dispose: unsubscribeIcons,
  };
}
