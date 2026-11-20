import { describe, expect, it } from 'vitest';
import { itsmIssueOccurrenceKey, itsmIssueOccurrenceLabel, stampItsmOccurrenceCounts } from './itsmRecordDisplay';

describe('stampItsmOccurrenceCounts', () => {
  it('counts tickets that share category + sub category', () => {
    const rows = stampItsmOccurrenceCounts([
      { id: '1', category: 'Access & Identity', sub_category: 'Network Access' },
      { id: '2', category: 'Access & Identity', sub_category: 'Network Access' },
      { id: '3', category: 'Access & Identity', sub_category: 'New User Account' },
      { id: '4', category: 'Network Incident', sub_category: 'Internet Connectivity' },
    ]);
    expect(rows.map((r) => r.occurrence_count)).toEqual([2, 2, 1, 1]);
  });

  it('treats blank category/sub as a shared bucket', () => {
    const key = itsmIssueOccurrenceKey({ category: '', sub_category: null });
    expect(key).toBe('—||—');
    const rows = stampItsmOccurrenceCounts([
      { id: 'a' },
      { id: 'b', category: '  ', sub_category: '' },
    ]);
    expect(rows.every((r) => r.occurrence_count === 2)).toBe(true);
  });

  it('labels occurrence drill-down as Category · Sub Category', () => {
    expect(itsmIssueOccurrenceLabel({ category: 'Hardware', sub_category: 'Laptop' })).toBe('Hardware · Laptop');
    expect(itsmIssueOccurrenceLabel({ category: '', sub_category: null })).toBe('— · —');
  });
});
