// Stub — types + ids are final, values are placeholders for Subagent B.

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
  /** TODO(B): balance. Meaning depends on `kind`. */
  magnitudePerLevel: number;
}

export interface UpgradeDefinition {
  id: UpgradeId;
  displayName: string;
  description: string;
  /** TODO(B): balance. */
  maxLevel: number;
  effect: UpgradeEffect;
  /** TODO(B): real monotonic cost curve. Placeholder: constant 0. */
  costForLevel: (level: number) => number;
}

const placeholderCostCurve = (_level: number): number => 0;

export const UPGRADES: Record<UpgradeId, UpgradeDefinition> = {
  podRhythm: {
    id: 'podRhythm',
    displayName: 'TODO(B): Pod Rhythm',
    description: 'TODO(B)',
    maxLevel: 1,
    effect: { kind: 'podSpawnRate', magnitudePerLevel: 0 },
    costForLevel: placeholderCostCurve,
  },
  habitatCapacity: {
    id: 'habitatCapacity',
    displayName: 'TODO(B): Habitat Capacity',
    description: 'TODO(B)',
    maxLevel: 1,
    effect: { kind: 'habitatCapacity', magnitudePerLevel: 0 },
    costForLevel: placeholderCostCurve,
  },
  gardenSlideSpeed: {
    id: 'gardenSlideSpeed',
    displayName: 'TODO(B): Garden Slide Speed',
    description: 'TODO(B)',
    maxLevel: 1,
    effect: { kind: 'automationSpeed', magnitudePerLevel: 0 },
    costForLevel: placeholderCostCurve,
  },
  dewdropMultiplier: {
    id: 'dewdropMultiplier',
    displayName: 'TODO(B): Dewdrop Multiplier',
    description: 'TODO(B)',
    maxLevel: 1,
    effect: { kind: 'currencyMultiplier', magnitudePerLevel: 0 },
    costForLevel: placeholderCostCurve,
  },
  decorativeExpansion1: {
    id: 'decorativeExpansion1',
    displayName: 'TODO(B): Decorative Expansion I',
    description: 'TODO(B)',
    maxLevel: 1,
    effect: { kind: 'decorativeUnlock', magnitudePerLevel: 0 },
    costForLevel: placeholderCostCurve,
  },
  colourGateUnlock: {
    id: 'colourGateUnlock',
    displayName: 'TODO(B): Colour Gate Unlock',
    description: 'TODO(B)',
    maxLevel: 1,
    effect: { kind: 'automationUnlock', magnitudePerLevel: 0 },
    costForLevel: placeholderCostCurve,
  },
};

export const UPGRADE_LIST: UpgradeDefinition[] = Object.values(UPGRADES);
