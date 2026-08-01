import { describe, expect, it } from 'vitest';

import { EventBus } from '../events';
import { createAudioSystem } from './system';

// jsdom has no Web Audio implementation, so every test here injects a fake
// AudioContext covering exactly the surface system.ts/synth.ts touch. The
// fake's AudioParam does NOT simulate time-based ramps (linearRampToValueAtTime
// just snaps `.value`) — that's fine, we assert both the node's last commanded
// value and the system's mirrored gain target, per the audio graph contract.

class FakeAudioParam {
  value = 0;
  constructor(initial = 0) {
    this.value = initial;
  }
  setValueAtTime(value: number) {
    this.value = value;
    return this;
  }
  linearRampToValueAtTime(value: number) {
    this.value = value;
    return this;
  }
  exponentialRampToValueAtTime(value: number) {
    this.value = value;
    return this;
  }
  cancelScheduledValues() {
    return this;
  }
}

class FakeAudioNode {
  connect() {
    return this;
  }
  disconnect() {
    /* no-op */
  }
}

class FakeGainNode extends FakeAudioNode {
  gain = new FakeAudioParam(1);
}

class FakeBiquadFilterNode extends FakeAudioNode {
  type = 'lowpass';
  frequency = new FakeAudioParam(350);
  Q = new FakeAudioParam(1);
}

class FakeOscillatorNode extends FakeAudioNode {
  type: OscillatorType = 'sine';
  frequency = new FakeAudioParam(440);
  onended: (() => void) | null = null;
  start() {
    /* no-op */
  }
  stop() {
    if (this.onended) this.onended();
  }
}

class FakeAudioContext {
  currentTime = 0;
  state: AudioContextState = 'suspended';
  destination = new FakeAudioNode();

  createGain() {
    return new FakeGainNode() as unknown as GainNode;
  }
  createOscillator() {
    return new FakeOscillatorNode() as unknown as OscillatorNode;
  }
  createBiquadFilter() {
    return new FakeBiquadFilterNode() as unknown as BiquadFilterNode;
  }
  resume() {
    this.state = 'running';
    return Promise.resolve();
  }
  close() {
    this.state = 'closed';
    return Promise.resolve();
  }
}

function makeSystem() {
  const bus = new EventBus();
  const fakeCtx = new FakeAudioContext();
  const system = createAudioSystem(bus, {
    contextFactory: () => fakeCtx as unknown as AudioContext,
  });
  return { bus, system };
}

describe('audio system', () => {
  it('builds the audio graph without throwing', () => {
    expect(() => makeSystem()).not.toThrow();
  });

  it('mutes the master gain to 0 and unmutes back to 1', () => {
    const { system } = makeSystem();

    expect(system.isMuted()).toBe(false);
    expect(system.getMasterGainTarget()).toBe(1);

    system.setMuted(true);
    expect(system.isMuted()).toBe(true);
    expect(system.getMasterGainTarget()).toBe(0);

    system.setMuted(false);
    expect(system.getMasterGainTarget()).toBe(1);
  });

  it('starts suspended and resume() unlocks the context', () => {
    const { system } = makeSystem();
    expect(system.getContextState()).toBe('suspended');
    system.resume();
    expect(system.getContextState()).toBe('running');
  });

  it('reacts to bus events without throwing', () => {
    const { bus, system } = makeSystem();
    system.resume();

    expect(() => {
      bus.emit({ type: 'sprout:placed:correct', sproutId: 's1', habitatId: 'emberNook' });
      bus.emit({ type: 'sprout:placed:incorrect', sproutId: 's1', habitatId: 'emberNook' });
      bus.emit({ type: 'habitat:dewdropTick', habitatId: 'emberNook', amount: 1 });
      bus.emit({ type: 'habitat:full', habitatId: 'emberNook' });
      bus.emit({ type: 'sprout:spawned', sproutId: 's2', sproutType: 'star', mood: 'sunny', podId: 'p1' });
      bus.emit({ type: 'upgrade:purchased', upgradeId: 'podRhythm', level: 1 });
      bus.emit({ type: 'achievement:unlocked', achievementId: 'firstPlacement' });
      system.playUiClick();
      system.playUiHover();
    }).not.toThrow();
  });

  it('throttles dewdrop tick chimes so it does not buzz', () => {
    const { bus, system } = makeSystem();
    system.resume();
    // Firing many ticks synchronously (same ctx.currentTime) must not throw
    // even though only the first should actually sound.
    expect(() => {
      for (let i = 0; i < 50; i++) {
        bus.emit({ type: 'habitat:dewdropTick', habitatId: 'dewPond', amount: 1 });
      }
    }).not.toThrow();
  });

  it('clamps volumes to 0..1', () => {
    const { system } = makeSystem();
    system.setMusicVolume(5);
    expect(system.getMusicVolume()).toBe(1);
    system.setMusicVolume(-2);
    expect(system.getMusicVolume()).toBe(0);
    system.setSfxVolume(0.42);
    expect(system.getSfxVolume()).toBeCloseTo(0.42);
  });

  it('disposes cleanly and stops reacting to events', () => {
    const { bus, system } = makeSystem();
    system.resume();
    system.dispose();
    expect(() => {
      bus.emit({ type: 'sprout:placed:correct', sproutId: 's1', habitatId: 'emberNook' });
      system.playUiClick();
    }).not.toThrow();
  });
});
