// Gentle looping ambient garden music: a slow, warm chord pad (detuned sine
// pair through a lowpass filter with a slow LFO sweep) plus sparse pentatonic
// "sparkle" plucks. Scheduled with a lookahead timer rather than sample-exact
// scheduling — this is cosy background music for a toy garden, not a DAW.

export interface AmbientLoopHandle {
  stop: () => void;
}

// C major pentatonic, low-to-mid register: warm, never dissonant, toy-like.
const PLUCK_SCALE = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33];

// Slow chord pad progression (root frequencies), each held for BAR_SECONDS.
const PAD_CHORDS = [130.81, 174.61, 146.83, 195.0]; // C3, F3, D3, G3 — soft I-IV-ii-V wander

const BAR_SECONDS = 4;
const LOOKAHEAD_MS = 250;
const SCHEDULE_AHEAD_SECONDS = 0.5;

export function startAmbientLoop(ctx: BaseAudioContext, destination: AudioNode): AmbientLoopHandle {
  let stopped = false;
  let barIndex = 0;
  let nextBarTime = ctx.currentTime + 0.1;
  const activeNodes = new Set<AudioScheduledSourceNode>();

  const padFilter = ctx.createBiquadFilter();
  padFilter.type = 'lowpass';
  padFilter.frequency.value = 900;
  padFilter.Q.value = 0.5;
  padFilter.connect(destination);

  // Slow LFO breathing the filter cutoff for a little life without being busy.
  const lfo = ctx.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = 0.06;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 220;
  lfo.connect(lfoGain);
  lfoGain.connect(padFilter.frequency);
  lfo.start();
  activeNodes.add(lfo);

  function scheduleChord(rootFreq: number, startTime: number, duration: number): void {
    // Root + soft fifth + gentle detuned octave-up shimmer, all sine — warm,
    // never sharp.
    const partials: Array<{ ratio: number; peak: number; type: OscillatorType }> = [
      { ratio: 1, peak: 0.09, type: 'sine' },
      { ratio: 1.5, peak: 0.05, type: 'sine' },
      { ratio: 2.003, peak: 0.03, type: 'sine' },
    ];
    for (const partial of partials) {
      const osc = ctx.createOscillator();
      osc.type = partial.type;
      osc.frequency.setValueAtTime(rootFreq * partial.ratio, startTime);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(partial.peak, startTime + 0.8);
      gain.gain.setValueAtTime(partial.peak, startTime + duration - 0.8);
      gain.gain.linearRampToValueAtTime(0, startTime + duration);

      osc.connect(gain);
      gain.connect(padFilter);
      osc.start(startTime);
      osc.stop(startTime + duration + 0.05);
      activeNodes.add(osc);
      osc.onended = () => {
        osc.disconnect();
        gain.disconnect();
        activeNodes.delete(osc);
      };
    }
  }

  function maybeSchedulePluck(barStart: number): void {
    // Roughly every other bar, a couple of soft plucks — sparse, not busy.
    if (Math.random() > 0.55) return;
    const pluckCount = 1 + Math.floor(Math.random() * 2);
    for (let i = 0; i < pluckCount; i++) {
      const offset = Math.random() * (BAR_SECONDS - 0.5);
      const frequency = PLUCK_SCALE[Math.floor(Math.random() * PLUCK_SCALE.length)];
      const startTime = barStart + offset;

      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(frequency, startTime);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(0.06, startTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + 1.2);

      osc.connect(gain);
      gain.connect(destination);
      osc.start(startTime);
      osc.stop(startTime + 1.3);
      activeNodes.add(osc);
      osc.onended = () => {
        osc.disconnect();
        gain.disconnect();
        activeNodes.delete(osc);
      };
    }
  }

  function tick(): void {
    if (stopped) return;
    while (nextBarTime < ctx.currentTime + SCHEDULE_AHEAD_SECONDS) {
      const chord = PAD_CHORDS[barIndex % PAD_CHORDS.length];
      scheduleChord(chord, nextBarTime, BAR_SECONDS + 0.5);
      maybeSchedulePluck(nextBarTime);
      barIndex += 1;
      nextBarTime += BAR_SECONDS;
    }
    timer = setTimeout(tick, LOOKAHEAD_MS) as unknown as number;
  }

  let timer: number = setTimeout(tick, 0) as unknown as number;

  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      clearTimeout(timer);
      lfo.stop();
      for (const node of activeNodes) {
        try {
          node.stop();
        } catch {
          // Already stopped/ended — fine, this is best-effort cleanup.
        }
      }
      padFilter.disconnect();
      lfoGain.disconnect();
    },
  };
}
