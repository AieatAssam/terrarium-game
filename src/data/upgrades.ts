// Real balance values (Subagent B, Phase 2). Cost curves are geometric
// (cost(level) = baseCost * growth^(level-1), rounded to the nearest 5 for
// readable numbers) so each level costs noticeably more than the last while
// staying reachable at the Dewdrop rates in src/data/habitats.ts. See
// docs/GAME_DESIGN.md ("Progression math") for the affordability check
// against those rates.

import type { UpgradeId } from '../core/ids';

export type UpgradeEffectKind =
  | 'podSpawnRate'
  | 'habitatCapacity'
  | 'automationSpeed'
  | 'currencyMultiplier'
  | 'decorativeUnlock'
  | 'automationUnlock';

export interface UpgradeEffect {
  kind: UpgradeEffectKind;
  /**
   * Meaning depends on `kind`:
   * - podSpawnRate: fractional reduction to pod spawn interval per level (multiplicative, e.g. 0.25 == 25% faster)
   * - habitatCapacity: flat capacity added to EACH habitat per level
   * - automationSpeed: fractional reduction to Garden Slide transport time per level (multiplicative)
   * - currencyMultiplier: fractional Dewdrop income bonus per level (additive to a 1.0 base multiplier)
   * - decorativeUnlock / automationUnlock: 1 (boolean-shaped; single-level unlocks)
   */
  magnitudePerLevel: number;
}

export interface UpgradeDefinition {
  id: UpgradeId;
  displayName: string;
  description: string;
  maxLevel: number;
  effect: UpgradeEffect;
  costForLevel: (level: number) => number;
}

/** cost(level) = baseCost * growth^(level-1), rounded to the nearest 5. */
function geometricCostCurve(baseCost: number, growth: number): (level: number) => number {
  return (level: number) => Math.round((baseCost * growth ** (level - 1)) / 5) * 5;
}

/** Single-level unlocks just have one fixed price. */
function flatCost(cost: number): (level: number) => number {
  return (_level: number) => cost;
}

export const UPGRADES: Record<UpgradeId, UpgradeDefinition> = {
  podRhythm: {
    id: 'podRhythm',
    displayName: 'Pod Rhythm',
    description: 'The nursery pod settles into a quicker rhythm — new Sprouts arrive more often.',
    maxLevel: 3,
    effect: { kind: 'podSpawnRate', magnitudePerLevel: 0.25 },
    costForLevel: geometricCostCurve(80, 1.6), // 80, 130, 205
  },
  habitatCapacity: {
    id: 'habitatCapacity',
    displayName: 'Habitat Capacity',
    description: 'Each habitat clears a little more room, so it can hold more settled Sprouts before it fills up.',
    maxLevel: 3,
    effect: { kind: 'habitatCapacity', magnitudePerLevel: 3 },
    costForLevel: geometricCostCurve(100, 1.7), // 100, 170, 290
  },
  gardenSlideSpeed: {
    id: 'gardenSlideSpeed',
    displayName: 'Garden Slide Speed',
    description: 'A smoother, waxed slide — the Garden Slide carries Sprouts to their habitat faster.',
    maxLevel: 3,
    effect: { kind: 'automationSpeed', magnitudePerLevel: 0.2 },
    costForLevel: geometricCostCurve(90, 1.6), // 90, 145, 230
  },
  dewdropMultiplier: {
    id: 'dewdropMultiplier',
    displayName: 'Dewdrop Multiplier',
    description: 'Extra shimmer in the garden — every settled Sprout produces more Dewdrops per tick.',
    maxLevel: 3,
    effect: { kind: 'currencyMultiplier', magnitudePerLevel: 0.15 },
    costForLevel: geometricCostCurve(120, 1.8), // 120, 215, 390
  },
  decorativeExpansion1: {
    id: 'decorativeExpansion1',
    displayName: 'Decorative Expansion I',
    description: 'Unlocks the first set of purely decorative garden scenery (stones, lanterns, moss).',
    maxLevel: 1,
    effect: { kind: 'decorativeUnlock', magnitudePerLevel: 1 },
    costForLevel: flatCost(60),
  },
  colourGateUnlock: {
    id: 'colourGateUnlock',
    displayName: 'Colour Gate',
    description:
      'Builds the Colour Gate: a second automation that sorts Sprouts to their correct habitat by colour, ' +
      "freeing the Garden Slide from being the garden's only route. Only purchasable once your Garden Slide " +
      "has been busy for a while and a few other Sprouts are waiting for a home.",
    maxLevel: 1,
    effect: { kind: 'automationUnlock', magnitudePerLevel: 1 },
    costForLevel: flatCost(450),
  },
};

export const UPGRADE_LIST: UpgradeDefinition[] = Object.values(UPGRADES);

/**
 * Current Dewdrop income multiplier from the dewdropMultiplier upgrade
 * (1.0 == no bonus). Shared by the sim tick (active play) and
 * computeOfflineProgress (offlineProgress.ts) so both apply the same bonus.
 */
export function getDewdropMultiplier(upgradeLevels: Partial<Record<UpgradeId, number>>): number {
  const level = upgradeLevels.dewdropMultiplier ?? 0;
  return 1 + level * UPGRADES.dewdropMultiplier.effect.magnitudePerLevel;
}
