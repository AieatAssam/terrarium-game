import { describe, expect, it } from 'vitest';

import { createJournalModel, TOTAL_JOURNAL_SLOTS } from './journalModel';

describe('journal model', () => {
  it('reports 12 total slots', () => {
    expect(TOTAL_JOURNAL_SLOTS).toBe(12);
    expect(createJournalModel().totalSlots).toBe(12);
  });

  it('reports 4 discoverable slots (ember/dew/sun/star) in Phase 1', () => {
    const model = createJournalModel();
    expect(model.discoverableCount).toBe(4);
    expect(model.slots.filter((s) => s.kind === 'discoverable')).toHaveLength(4);
  });

  it('fills the remaining slots as locked placeholders', () => {
    const model = createJournalModel();
    expect(model.lockedCount).toBe(8);
    expect(model.slots.filter((s) => s.kind === 'locked')).toHaveLength(8);
    expect(model.slots).toHaveLength(12);
  });

  it('marks only discovered sprout types as discovered', () => {
    const model = createJournalModel(new Set(['ember', 'star']));
    const discoverable = model.slots.filter((s) => s.kind === 'discoverable');
    const embers = discoverable.find((s) => s.kind === 'discoverable' && s.sproutType === 'ember');
    const dew = discoverable.find((s) => s.kind === 'discoverable' && s.sproutType === 'dew');
    expect(embers && 'discovered' in embers ? embers.discovered : undefined).toBe(true);
    expect(dew && 'discovered' in dew ? dew.discovered : undefined).toBe(false);
  });

  it('defaults to nothing discovered when no set is given', () => {
    const model = createJournalModel();
    expect(model.slots.every((s) => s.kind !== 'discoverable' || s.discovered === false)).toBe(true);
  });
});
