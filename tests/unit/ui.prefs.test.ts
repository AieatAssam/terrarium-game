// src/ui/prefs.ts is pure-ish logic (localStorage read/write + validation +
// a matchMedia-derived default) that several e2e specs depend on indirectly
// (reduced-motion reflection onto <html data-reduced-motion>), but had no
// unit coverage of its own. Focused on the correctness risks: falling back
// safely on missing/corrupt/malformed storage, and reflecting prefs onto the
// document correctly.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadPrefs, reflectPrefsToDocument, savePrefs, type Prefs } from '../../src/ui/prefs';

const STORAGE_KEY = 'terrarium.prefs.v1';

describe('prefs', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns sane defaults when nothing is stored', () => {
    const prefs = loadPrefs();
    expect(prefs).toMatchObject({
      musicVolume: 0.5,
      sfxVolume: 0.7,
      muted: false,
      highContrast: false,
    });
    expect(typeof prefs.reducedMotion).toBe('boolean');
  });

  it('round-trips a saved value through localStorage', () => {
    const prefs: Prefs = {
      musicVolume: 0.2,
      sfxVolume: 0.9,
      muted: true,
      reducedMotion: true,
      highContrast: true,
    };
    savePrefs(prefs);
    expect(loadPrefs()).toEqual(prefs);
  });

  it('falls back to defaults when the stored JSON is corrupt', () => {
    localStorage.setItem(STORAGE_KEY, '{not valid json');
    const prefs = loadPrefs();
    expect(prefs.musicVolume).toBe(0.5);
  });

  it('falls back to defaults when the stored value has the wrong shape', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ musicVolume: 'loud' }));
    const prefs = loadPrefs();
    expect(prefs.musicVolume).toBe(0.5);
    expect(prefs.muted).toBe(false);
  });

  it('falls back to defaults when localStorage.getItem throws (e.g. private browsing)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage unavailable');
    });
    expect(() => loadPrefs()).not.toThrow();
    expect(loadPrefs().musicVolume).toBe(0.5);
  });

  it('savePrefs does not throw when localStorage.setItem throws (e.g. quota exceeded)', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });
    expect(() =>
      savePrefs({ musicVolume: 0.5, sfxVolume: 0.5, muted: false, reducedMotion: false, highContrast: false }),
    ).not.toThrow();
  });

  it('reflectPrefsToDocument sets reducedMotion and contrast dataset attributes', () => {
    const root = document.createElement('html');
    reflectPrefsToDocument(
      { musicVolume: 0.5, sfxVolume: 0.5, muted: false, reducedMotion: true, highContrast: true },
      root,
    );
    expect(root.dataset.reducedMotion).toBe('true');
    expect(root.dataset.contrast).toBe('high');

    reflectPrefsToDocument(
      { musicVolume: 0.5, sfxVolume: 0.5, muted: false, reducedMotion: false, highContrast: false },
      root,
    );
    expect(root.dataset.reducedMotion).toBe('false');
    expect(root.dataset.contrast).toBe('normal');
  });

  it('defaults reducedMotion from prefers-reduced-motion when matchMedia reports it', () => {
    const matchMediaMock = vi.fn().mockReturnValue({ matches: true });
    vi.stubGlobal('matchMedia', matchMediaMock);
    expect(loadPrefs().reducedMotion).toBe(true);
    vi.unstubAllGlobals();
  });
});
