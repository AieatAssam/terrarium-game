import { describe, expect, it } from 'vitest';
import { SPROUT_TYPE_LIST, SPROUT_TYPES, sproutMatchesHabitat } from '../../src/data/sproutTypes';
import { HABITAT_LIST } from '../../src/data/habitats';

describe('Star Sprout habitat rule', () => {
  it('has habitatId null (matches any habitat), unlike the 3 common types', () => {
    expect(SPROUT_TYPES.star.habitatId).toBeNull();
    expect(SPROUT_TYPES.ember.habitatId).not.toBeNull();
    expect(SPROUT_TYPES.dew.habitatId).not.toBeNull();
    expect(SPROUT_TYPES.sun.habitatId).not.toBeNull();
  });

  it('sproutMatchesHabitat treats Star Sprout as correct in every habitat', () => {
    for (const habitat of HABITAT_LIST) {
      expect(sproutMatchesHabitat('star', habitat.id)).toBe(true);
    }
  });

  it('sproutMatchesHabitat only accepts the exact matching habitat for common types', () => {
    expect(sproutMatchesHabitat('ember', 'emberNook')).toBe(true);
    expect(sproutMatchesHabitat('ember', 'dewPond')).toBe(false);
    expect(sproutMatchesHabitat('ember', 'sunflowerMeadow')).toBe(false);

    expect(sproutMatchesHabitat('dew', 'dewPond')).toBe(true);
    expect(sproutMatchesHabitat('dew', 'emberNook')).toBe(false);

    expect(sproutMatchesHabitat('sun', 'sunflowerMeadow')).toBe(true);
    expect(sproutMatchesHabitat('sun', 'dewPond')).toBe(false);
  });
});

describe('sprout type data completeness', () => {
  it('every sprout type has a non-placeholder display name and colour', () => {
    for (const def of SPROUT_TYPE_LIST) {
      expect(def.displayName).not.toMatch(/TODO/);
      expect(def.primaryColor).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it('primary colours are all distinct (colour+shape encoding needs distinguishable hues)', () => {
    const colors = SPROUT_TYPE_LIST.map((d) => d.primaryColor.toLowerCase());
    expect(new Set(colors).size).toBe(colors.length);
  });

  it('exactly one rare type (star) and three common types', () => {
    const rare = SPROUT_TYPE_LIST.filter((d) => d.rarity === 'rare');
    const common = SPROUT_TYPE_LIST.filter((d) => d.rarity === 'common');
    expect(rare.map((d) => d.id)).toEqual(['star']);
    expect(common).toHaveLength(3);
  });
});
