import { ALL_STATUSES, GROUP_STATUSES, addToCounts, canTransition, emptyCounts, groupOf } from './status';

describe('status machine', () => {
  it('maps every status to exactly one group', () => {
    const all = Object.values(GROUP_STATUSES).flat();
    expect(new Set(all).size).toBe(all.length);
    expect([...all].sort()).toEqual([...ALL_STATUSES].sort());
    expect(groupOf('queued')).toBe('in_progress');
    expect(groupOf('refused')).toBe('not_removable');
    expect(groupOf('action_required')).toBe('action_required');
  });
  it('allows the documented transitions and blocks terminal states', () => {
    expect(canTransition('queued', 'sent')).toBe(true);
    expect(canTransition('overdue', 'escalated')).toBe(true);
    expect(canTransition('action_required', 'sent')).toBe(true);
    expect(canTransition('completed', 'sent')).toBe(false);
    expect(canTransition('cancelled', 'queued')).toBe(false);
    expect(canTransition('queued', 'completed')).toBe(false);
    expect(canTransition('draft', 'queued')).toBe(true);
    expect(canTransition('draft', 'cancelled')).toBe(true);
    expect(canTransition('draft', 'sent')).toBe(false);
    expect(canTransition('queued', 'draft')).toBe(false);
  });
  it('counts by group', () => {
    const c = emptyCounts();
    addToCounts(c, 'sent', 2);
    addToCounts(c, 'completed', 1);
    addToCounts(c, 'refused', 1);
    addToCounts(c, 'action_required', 3);
    addToCounts(c, 'draft', 1);
    expect(c).toEqual({ total: 8, toSend: 1, inProgress: 2, actionRequired: 3, completed: 1, notRemovable: 1 });
  });
});
