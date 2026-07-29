// Pure Garden Journal slot model — no DOM, easy to unit test. 12 total
// collection slots; Phase 1 makes `SPROUT_TYPE_LIST.length` of them
// discoverable (ember/dew/sun/star = 4 today), the rest render as locked
// silhouette placeholders (docs/CONTRACTS.md "Garden Journal count").

import type { SproutTypeId } from '../core/ids';
import { SPROUT_TYPE_LIST } from '../data/sproutTypes';

export const TOTAL_JOURNAL_SLOTS = 12;

export interface DiscoverableJournalSlot {
  kind: 'discoverable';
  sproutType: SproutTypeId;
  discovered: boolean;
}

export interface LockedJournalSlot {
  kind: 'locked';
  /** Stable index among the locked-placeholder slots, for a React-less key. */
  slotIndex: number;
}

export type JournalSlot = DiscoverableJournalSlot | LockedJournalSlot;

export interface JournalModel {
  totalSlots: number;
  discoverableCount: number;
  lockedCount: number;
  slots: JournalSlot[];
}

/**
 * Builds the full 12-slot model. `discovered` is the set of sprout types the
 * player has actually found (mirrored from `journal:entryDiscovered` events
 * — see state.ts), not just the types that exist in data.
 */
export function createJournalModel(discovered: ReadonlySet<SproutTypeId> = new Set()): JournalModel {
  const discoverableCount = SPROUT_TYPE_LIST.length;
  const lockedCount = Math.max(0, TOTAL_JOURNAL_SLOTS - discoverableCount);

  const slots: JournalSlot[] = [
    ...SPROUT_TYPE_LIST.map(
      (def): DiscoverableJournalSlot => ({
        kind: 'discoverable',
        sproutType: def.id,
        discovered: discovered.has(def.id),
      }),
    ),
    ...Array.from({ length: lockedCount }, (_, i): LockedJournalSlot => ({ kind: 'locked', slotIndex: i })),
  ];

  return { totalSlots: TOTAL_JOURNAL_SLOTS, discoverableCount, lockedCount, slots };
}
