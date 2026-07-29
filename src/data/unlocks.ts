// Stub — types + ids are final, values are placeholders for Subagent B.

import type { AutomationId } from '../core/ids';

export interface UnlockThreshold {
  automationId: AutomationId;
  /** TODO(B): balance. Correct manual placements required to unlock. */
  requiredCorrectPlacements: number;
}

export const UNLOCK_THRESHOLDS: Record<AutomationId, UnlockThreshold> = {
  gardenSlide: {
    automationId: 'gardenSlide',
    requiredCorrectPlacements: 0,
  },
  colourGate: {
    automationId: 'colourGate',
    requiredCorrectPlacements: 0,
  },
};

export const UNLOCK_THRESHOLD_LIST: UnlockThreshold[] = Object.values(UNLOCK_THRESHOLDS);
