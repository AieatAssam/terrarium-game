import { describe, expect, it } from 'vitest';
import { MOOD_LIST, MOODS } from '../../src/data/moods';

describe('mood data completeness', () => {
  it('has exactly the two moods sunny/sleepy', () => {
    expect(Object.keys(MOODS).sort()).toEqual(['sleepy', 'sunny']);
    expect(MOOD_LIST).toHaveLength(2);
  });

  it('every mood has a non-placeholder display name, colour, and badge key', () => {
    for (const def of MOOD_LIST) {
      expect(def.displayName).not.toMatch(/TODO/);
      expect(def.primaryColor).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(def.silhouetteKey.length).toBeGreaterThan(0);
    }
  });

  it('primary colours are distinct (colour+shape encoding needs distinguishable hues)', () => {
    const colors = MOOD_LIST.map((d) => d.primaryColor.toLowerCase());
    expect(new Set(colors).size).toBe(colors.length);
  });

  it('MOODS is keyed by each definition\'s own id', () => {
    for (const [key, def] of Object.entries(MOODS)) {
      expect(def.id).toBe(key);
    }
  });
});
