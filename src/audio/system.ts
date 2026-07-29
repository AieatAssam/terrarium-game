// Wires the synth/sfx/music modules to the typed event bus and exposes the
// small control surface UI/settings need (volumes, mute, resume-on-gesture).
//
// Ownership note (docs/CONTRACTS.md): this module only imports event *types*
// from src/events and plain data ids from src/core — never src/render or
// src/sim internals, per the audio policy in the brief.

import type { EventBus, GameEvent } from '../events';

import { startAmbientLoop, type AmbientLoopHandle } from './music';
import {
  playAchievementUnlocked,
  playDewdropTick,
  playHabitatFull,
  playPlacementCorrect,
  playPlacementIncorrect,
  playStarReveal,
  playUiClick,
  playUiHover,
  playUpgradePurchased,
} from './sfx';

export interface AudioSystemOptions {
  /**
   * Creates the underlying AudioContext. Defaults to `() => new
   * AudioContext()`. Tests (and any environment without a real Web Audio
   * implementation, e.g. jsdom) inject a fake here so construction never
   * throws — see system.test.ts.
   */
  contextFactory?: () => AudioContext;
  /** Minimum seconds between two dewdrop-tick chimes. Default 2. */
  dewdropTickThrottleSeconds?: number;
}

export interface AudioSystem {
  resume(): void;
  dispose(): void;

  setMuted(muted: boolean): void;
  isMuted(): boolean;

  setMusicVolume(volume: number): void;
  getMusicVolume(): number;

  setSfxVolume(volume: number): void;
  getSfxVolume(): number;

  playUiClick(): void;
  playUiHover(): void;

  /** Mirrored 0..1 target for the master gain — stable to assert on in tests
   * even against a fake context that doesn't simulate AudioParam ramps. */
  getMasterGainTarget(): number;
}

const DEFAULT_DEWDROP_THROTTLE_SECONDS = 2;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function createAudioSystem(bus: EventBus, options: AudioSystemOptions = {}): AudioSystem {
  const contextFactory = options.contextFactory ?? (() => new AudioContext());
  const dewdropThrottleSeconds = options.dewdropTickThrottleSeconds ?? DEFAULT_DEWDROP_THROTTLE_SECONDS;

  const ctx = contextFactory();

  const masterGain = ctx.createGain();
  const musicGain = ctx.createGain();
  const sfxGain = ctx.createGain();

  musicGain.connect(masterGain);
  sfxGain.connect(masterGain);
  masterGain.connect(ctx.destination);

  let muted = false;
  let musicVolume = 0.5;
  let sfxVolume = 0.7;
  let masterGainTarget = 1;
  let musicLoop: AmbientLoopHandle | undefined;
  let lastDewdropTickAt = Number.NEGATIVE_INFINITY;
  let disposed = false;

  musicGain.gain.value = musicVolume;
  sfxGain.gain.value = sfxVolume;

  function applyMasterGain(): void {
    masterGainTarget = muted ? 0 : 1;
    const now = ctx.currentTime;
    masterGain.gain.cancelScheduledValues(now);
    masterGain.gain.setValueAtTime(masterGain.gain.value, now);
    masterGain.gain.linearRampToValueAtTime(masterGainTarget, now + 0.05);
  }

  function ensureMusicStarted(): void {
    if (musicLoop || disposed) return;
    musicLoop = startAmbientLoop(ctx, musicGain);
  }

  const unsubscribers: Array<() => void> = [];
  function on<T extends GameEvent['type']>(type: T, handler: (event: Extract<GameEvent, { type: T }>) => void) {
    unsubscribers.push(bus.subscribe(type, handler));
  }

  on('sprout:placed:correct', () => playPlacementCorrect(ctx, sfxGain));
  on('sprout:placed:incorrect', () => playPlacementIncorrect(ctx, sfxGain));
  on('habitat:full', () => playHabitatFull(ctx, sfxGain));
  on('upgrade:purchased', () => playUpgradePurchased(ctx, sfxGain));
  on('achievement:unlocked', () => playAchievementUnlocked(ctx, sfxGain));
  on('sprout:spawned', (event) => {
    if (event.sproutType === 'star') {
      playStarReveal(ctx, sfxGain);
    }
  });
  on('habitat:dewdropTick', () => {
    const now = ctx.currentTime;
    if (now - lastDewdropTickAt < dewdropThrottleSeconds) return;
    lastDewdropTickAt = now;
    playDewdropTick(ctx, sfxGain);
  });

  applyMasterGain();

  const system: AudioSystem = {
    resume() {
      if (disposed) return;
      if (ctx.state === 'suspended') {
        void ctx.resume().catch(() => {
          // Autoplay was blocked or the context is already closing — not
          // fatal, a later gesture will retry via the same call site.
        });
      }
      ensureMusicStarted();
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      for (const unsubscribe of unsubscribers) unsubscribe();
      musicLoop?.stop();
      musicLoop = undefined;
      try {
        void ctx.close?.();
      } catch {
        // Some fakes/environments don't support close(); nothing to do.
      }
    },

    setMuted(value: boolean) {
      muted = value;
      applyMasterGain();
    },
    isMuted() {
      return muted;
    },

    setMusicVolume(volume: number) {
      musicVolume = clamp01(volume);
      musicGain.gain.setValueAtTime(musicVolume, ctx.currentTime);
    },
    getMusicVolume() {
      return musicVolume;
    },

    setSfxVolume(volume: number) {
      sfxVolume = clamp01(volume);
      sfxGain.gain.setValueAtTime(sfxVolume, ctx.currentTime);
    },
    getSfxVolume() {
      return sfxVolume;
    },

    playUiClick() {
      if (disposed) return;
      playUiClick(ctx, sfxGain);
    },
    playUiHover() {
      if (disposed) return;
      playUiHover(ctx, sfxGain);
    },

    getMasterGainTarget() {
      return masterGainTarget;
    },
  };

  return system;
}
