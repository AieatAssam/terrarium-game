// Short original SFX, all synthesized. Each function fires one sound
// immediately (starting a hair after `ctx.currentTime` so scheduling never
// lands in the past) into `destination` (the sfx bus gain node — see
// system.ts). Kept deliberately simple: a handful of oscillators + envelopes,
// warm/toy-like, nothing harsh (no distortion, no clipping, gentle peaks).

import { playTone } from './synth';

const EPS = 0.001;

/** UI click — a soft, short high tick. */
export function playUiClick(ctx: BaseAudioContext, destination: AudioNode): void {
  const t = ctx.currentTime + EPS;
  playTone(ctx, destination, t, {
    type: 'triangle',
    frequency: 640,
    duration: 0.06,
    attack: 0.001,
    decay: 0.05,
    sustain: 0.2,
    release: 0.03,
    peak: 0.28,
    filterFrequency: 3000,
  });
}

/** UI hover — even softer/quieter than click, a gentle high tick. */
export function playUiHover(ctx: BaseAudioContext, destination: AudioNode): void {
  const t = ctx.currentTime + EPS;
  playTone(ctx, destination, t, {
    type: 'sine',
    frequency: 880,
    duration: 0.04,
    attack: 0.001,
    decay: 0.03,
    sustain: 0.1,
    release: 0.02,
    peak: 0.12,
  });
}

/** Correct placement — cheerful little ascending major-triad arpeggio. */
export function playPlacementCorrect(ctx: BaseAudioContext, destination: AudioNode): void {
  const start = ctx.currentTime + EPS;
  const notes = [523.25, 659.25, 783.99]; // C5, E5, G5
  notes.forEach((frequency, i) => {
    playTone(ctx, destination, start + i * 0.07, {
      type: 'triangle',
      frequency,
      duration: 0.22,
      attack: 0.005,
      decay: 0.1,
      sustain: 0.4,
      release: 0.15,
      peak: 0.32,
      filterFrequency: 4000,
    });
  });
}

/** Incorrect placement — a friendly, soft "boing" bounce. Never harsh. */
export function playPlacementIncorrect(ctx: BaseAudioContext, destination: AudioNode): void {
  const t = ctx.currentTime + EPS;
  playTone(ctx, destination, t, {
    type: 'sine',
    frequency: 330,
    frequencyTo: 220,
    duration: 0.16,
    attack: 0.005,
    decay: 0.05,
    sustain: 0.5,
    release: 0.12,
    peak: 0.3,
    filterFrequency: 1200,
  });
  playTone(ctx, destination, t + 0.14, {
    type: 'sine',
    frequency: 260,
    frequencyTo: 200,
    duration: 0.12,
    attack: 0.005,
    decay: 0.04,
    sustain: 0.4,
    release: 0.1,
    peak: 0.18,
    filterFrequency: 900,
  });
}

/** Dewdrop collect tick — a single soft bell ping, pitch varies slightly. */
export function playDewdropTick(ctx: BaseAudioContext, destination: AudioNode): void {
  const t = ctx.currentTime + EPS;
  const wobble = 1 + (Math.random() - 0.5) * 0.08;
  playTone(ctx, destination, t, {
    type: 'sine',
    frequency: 987.77 * wobble, // B5-ish
    duration: 0.35,
    attack: 0.002,
    decay: 0.15,
    sustain: 0.25,
    release: 0.25,
    peak: 0.22,
    filterFrequency: 5000,
  });
}

/** Rare Star Sprout reveal — soft magical shimmer, ascending sparkle run. */
export function playStarReveal(ctx: BaseAudioContext, destination: AudioNode): void {
  const start = ctx.currentTime + EPS;
  const scale = [523.25, 587.33, 659.25, 783.99, 880, 1046.5]; // C major pentatonic-ish run
  scale.forEach((frequency, i) => {
    playTone(ctx, destination, start + i * 0.08, {
      type: 'triangle',
      frequency,
      duration: 0.4,
      attack: 0.01,
      decay: 0.15,
      sustain: 0.35,
      release: 0.3,
      peak: 0.22,
      filterFrequency: 6000,
    });
  });
  // A soft sustained shimmer pad underneath the run.
  playTone(ctx, destination, start, {
    type: 'sine',
    frequency: 1046.5,
    duration: 0.9,
    attack: 0.15,
    decay: 0.2,
    sustain: 0.3,
    release: 0.5,
    peak: 0.1,
  });
}

/** Habitat full — warm two-note "ding-dong" chime, a happy milestone cue. */
export function playHabitatFull(ctx: BaseAudioContext, destination: AudioNode): void {
  const t = ctx.currentTime + EPS;
  playTone(ctx, destination, t, {
    type: 'triangle',
    frequency: 783.99,
    duration: 0.3,
    attack: 0.005,
    decay: 0.1,
    sustain: 0.4,
    release: 0.2,
    peak: 0.3,
    filterFrequency: 4000,
  });
  playTone(ctx, destination, t + 0.18, {
    type: 'triangle',
    frequency: 659.25,
    duration: 0.4,
    attack: 0.005,
    decay: 0.15,
    sustain: 0.4,
    release: 0.3,
    peak: 0.3,
    filterFrequency: 4000,
  });
}

/** Upgrade purchased — short two-note "power up" blip. */
export function playUpgradePurchased(ctx: BaseAudioContext, destination: AudioNode): void {
  const t = ctx.currentTime + EPS;
  playTone(ctx, destination, t, {
    type: 'square',
    frequency: 440,
    duration: 0.09,
    attack: 0.003,
    decay: 0.04,
    sustain: 0.3,
    release: 0.05,
    peak: 0.16,
    filterFrequency: 2200,
  });
  playTone(ctx, destination, t + 0.09, {
    type: 'square',
    frequency: 660,
    duration: 0.15,
    attack: 0.003,
    decay: 0.06,
    sustain: 0.3,
    release: 0.1,
    peak: 0.18,
    filterFrequency: 2600,
  });
}

/** Achievement unlocked — small cheerful four-note fanfare. */
export function playAchievementUnlocked(ctx: BaseAudioContext, destination: AudioNode): void {
  const start = ctx.currentTime + EPS;
  const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
  notes.forEach((frequency, i) => {
    playTone(ctx, destination, start + i * 0.09, {
      type: 'triangle',
      frequency,
      duration: 0.28,
      attack: 0.005,
      decay: 0.1,
      sustain: 0.4,
      release: 0.2,
      peak: 0.3,
      filterFrequency: 4500,
    });
  });
}
