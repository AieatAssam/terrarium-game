// Small Web Audio synthesis helpers shared by music.ts and sfx.ts. Original
// synthesis only (docs/CONTRACTS.md "Audio") — no samples, no external
// files. Every helper takes the AudioContext explicitly so nothing here ever
// touches a module-scope `new AudioContext()` (that would throw under the
// jsdom test environment and fight browser autoplay policy).

export type OscType = OscillatorType;

export interface EnvelopeOptions {
  /** Seconds to rise from 0 to `peak`. */
  attack?: number;
  /** Seconds to fall from `peak` to `sustain * peak`. */
  decay?: number;
  /** Fraction of `peak` held after decay, 0..1. */
  sustain?: number;
  /** Seconds to fall from the sustain level to 0 at note-off. */
  release?: number;
  /** Peak gain, 0..1. */
  peak?: number;
}

const DEFAULT_ENVELOPE: Required<EnvelopeOptions> = {
  attack: 0.01,
  decay: 0.08,
  sustain: 0.6,
  release: 0.2,
  peak: 0.5,
};

/**
 * Creates a GainNode driven by an ADSR-ish envelope starting at `startTime`
 * and returns it plus a `release()` you call to begin the note-off ramp.
 * Caller is responsible for eventually disconnecting (schedule a timeout, or
 * rely on the ramp reaching ~0 and garbage collection once disconnected).
 */
export function createEnvelopeGain(
  ctx: BaseAudioContext,
  startTime: number,
  options: EnvelopeOptions = {},
): { gainNode: GainNode; release: (releaseTime: number) => void } {
  const { attack, decay, sustain, release, peak } = { ...DEFAULT_ENVELOPE, ...options };
  const gainNode = ctx.createGain();
  const g = gainNode.gain;
  g.setValueAtTime(0, startTime);
  g.linearRampToValueAtTime(peak, startTime + attack);
  g.linearRampToValueAtTime(peak * sustain, startTime + attack + decay);

  const releaseFn = (releaseTime: number) => {
    g.cancelScheduledValues(releaseTime);
    g.setValueAtTime(g.value, releaseTime);
    g.linearRampToValueAtTime(0, releaseTime + release);
  };

  return { gainNode, release: releaseFn };
}

export interface ToneOptions extends EnvelopeOptions {
  type?: OscType;
  frequency: number;
  /** Optional pitch glide target; if set, frequency ramps to this by `duration`. */
  frequencyTo?: number;
  duration: number;
  /** Optional lowpass filter cutoff in Hz; omit for no filter. */
  filterFrequency?: number;
  filterQ?: number;
}

/**
 * Plays one short tone (oscillator -> optional filter -> envelope gain ->
 * destination) starting at `when` (AudioContext time). Fire-and-forget; the
 * oscillator stops and is disconnected automatically after it finishes.
 */
export function playTone(
  ctx: BaseAudioContext,
  destination: AudioNode,
  when: number,
  options: ToneOptions,
): void {
  const { type = 'sine', frequency, frequencyTo, duration, filterFrequency, filterQ = 0.7 } = options;

  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(frequency, when);
  if (frequencyTo !== undefined) {
    osc.frequency.linearRampToValueAtTime(frequencyTo, when + duration);
  }

  const { gainNode, release } = createEnvelopeGain(ctx, when, options);

  let lastNode: AudioNode = osc;
  if (filterFrequency !== undefined) {
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(filterFrequency, when);
    filter.Q.setValueAtTime(filterQ, when);
    lastNode.connect(filter);
    lastNode = filter;
  }
  lastNode.connect(gainNode);
  gainNode.connect(destination);

  osc.start(when);
  const stopAt = when + duration;
  release(Math.max(when, stopAt - (options.release ?? DEFAULT_ENVELOPE.release)));
  osc.stop(stopAt + 0.05);
  osc.onended = () => {
    osc.disconnect();
    gainNode.disconnect();
  };
}

/** Simple musical helper: MIDI-ish note name -> frequency isn't needed here;
 * callers just use plain Hz constants from scale tables (see music.ts). */
export function nowPlusJitter(ctx: BaseAudioContext, jitterSeconds = 0): number {
  return ctx.currentTime + jitterSeconds;
}
