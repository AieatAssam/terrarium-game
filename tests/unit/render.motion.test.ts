import { describe, expect, it } from 'vitest';

import { easeOutCubic, easingFn, getMotionConfig } from '../../src/render/motion';

describe('render/motion: getMotionConfig', () => {
  it('is a pure function of (reducedMotion, quality)', () => {
    const a = getMotionConfig(false, 'high');
    const b = getMotionConfig(false, 'high');
    expect(a).toEqual(b);
  });

  it('disables ambient/camera flourish and background motion under reduced motion', () => {
    const reduced = getMotionConfig(true, 'high');
    expect(reduced.ambientIntensity).toBe(0);
    expect(reduced.cameraFlourish).toBe(0);
    expect(reduced.backgroundMotion).toBe(0);
  });

  it('keeps full ambient/camera flourish/background motion when motion is not reduced', () => {
    const full = getMotionConfig(false, 'high');
    expect(full.ambientIntensity).toBeGreaterThan(0);
    expect(full.cameraFlourish).toBeGreaterThan(0);
    expect(full.backgroundMotion).toBeGreaterThan(0);
  });

  it('never zeroes out core feedback durations, even under reduced motion', () => {
    const reduced = getMotionConfig(true, 'high');
    expect(reduced.placementDurationMs).toBeGreaterThan(0);
    expect(reduced.revealDurationMs).toBeGreaterThan(0);
  });

  it('shortens core feedback durations under reduced motion vs full motion', () => {
    const reduced = getMotionConfig(true, 'high');
    const full = getMotionConfig(false, 'high');
    expect(reduced.placementDurationMs).toBeLessThan(full.placementDurationMs);
    expect(reduced.revealDurationMs).toBeLessThan(full.revealDurationMs);
  });

  it('swaps bounce easing for a calmer easeOut under reduced motion', () => {
    expect(getMotionConfig(false, 'high').easing).toBe('bounce');
    expect(getMotionConfig(true, 'high').easing).toBe('easeOut');
  });

  it('scales particle density down on low quality, independent of reduced motion', () => {
    const highQ = getMotionConfig(false, 'high');
    const lowQ = getMotionConfig(false, 'low');
    expect(lowQ.particleDensity).toBeLessThan(highQ.particleDensity);

    const highQReduced = getMotionConfig(true, 'high');
    const lowQReduced = getMotionConfig(true, 'low');
    expect(lowQReduced.particleDensity).toBeLessThan(highQReduced.particleDensity);
  });

  it('resolves an easing function per kind', () => {
    expect(easingFn('linear')(0.5)).toBe(0.5);
    expect(easingFn('easeOut')(1)).toBeCloseTo(1);
    expect(easingFn('easeOut')(0)).toBeCloseTo(0);
  });

  it('easeOutCubic clamps outside [0,1]', () => {
    expect(easeOutCubic(-1)).toBe(0);
    expect(easeOutCubic(2)).toBe(1);
  });
});
