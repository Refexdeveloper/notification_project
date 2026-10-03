import { describe, expect, it } from 'vitest';
import {
  breakdownFromCounts,
  itsmSourceFromFilteredRecords,
  sourceChannelTotal,
  sourceCountsFromBreakdown,
  sourceCountsFromRecords,
  todayOpenSourceCounts,
} from './itsmSourceBreakdown';

describe('sourceCountsFromBreakdown', () => {
  it('keeps Email / WhatsApp / Mobile / Web even when a channel is zero', () => {
    const counts = sourceCountsFromBreakdown([
      { name: 'Email', count: 490 },
      { name: 'Web', count: 452 },
    ]);
    expect(counts).toEqual({
      Email: 490,
      WhatsApp: 0,
      Mobile: 0,
      Web: 452,
      Other: 0,
    });
    expect(sourceChannelTotal(counts)).toBe(942);
  });

  it('filters All tickets source to the current record set', () => {
    const counts = sourceCountsFromRecords([
      { source: 'Email' },
      { source: 'Email' },
      { source: 'Web' },
      { source_channel: 'Mobile' },
    ]);
    expect(counts).toEqual({ Email: 2, WhatsApp: 0, Mobile: 1, Web: 1, Other: 0 });
    expect(breakdownFromCounts(counts).find((r) => r.name === 'Email')?.count).toBe(2);
  });

  it('counts Today open tickets as created today and still open', () => {
    const today = '2026-10-03';
    const counts = todayOpenSourceCounts(
      [
        { source: 'Email', status: 'open', created_at: '2026-10-03T04:00:00.000Z' },
        { source: 'Web', status: 'closed', created_at: '2026-10-03T04:00:00.000Z' },
        { source: 'Mobile', status: 'open', created_at: '2026-10-02T04:00:00.000Z' },
      ],
      today,
    );
    expect(counts.Email).toBe(1);
    expect(counts.Web).toBe(0);
    expect(counts.Mobile).toBe(0);
  });

  it('drops source to zero when the filtered ticket set is empty', () => {
    const next = itsmSourceFromFilteredRecords([], '2026-10-03');
    expect(sourceChannelTotal(sourceCountsFromBreakdown(next.all))).toBe(0);
    expect(sourceChannelTotal(sourceCountsFromBreakdown(next.today))).toBe(0);
  });

  it('shrinks All tickets when the same list is company-filtered', () => {
    const all = [
      { source: 'Email', status: 'open', created_at: '2026-10-03T04:00:00.000Z', company: 'Extrovis' },
      { source: 'Web', status: 'closed', created_at: '2026-09-01T04:00:00.000Z', company: 'Refex' },
      { source: 'Email', status: 'closed', created_at: '2026-09-01T04:00:00.000Z', company: 'Extrovis' },
    ];
    const extrovis = all.filter((r) => r.company === 'Extrovis');
    const unfiltered = itsmSourceFromFilteredRecords(all, '2026-10-03');
    const filtered = itsmSourceFromFilteredRecords(extrovis, '2026-10-03');
    expect(sourceChannelTotal(sourceCountsFromBreakdown(unfiltered.all))).toBe(3);
    expect(sourceChannelTotal(sourceCountsFromBreakdown(filtered.all))).toBe(2);
    expect(sourceCountsFromBreakdown(filtered.all).Email).toBe(2);
    expect(sourceCountsFromBreakdown(filtered.all).Web).toBe(0);
    expect(sourceCountsFromBreakdown(filtered.today).Email).toBe(1);
  });

  it('keeps Other for the footnote only', () => {
    const counts = sourceCountsFromBreakdown([
      { name: 'Email', count: 2 },
      { name: 'Other', count: 9 },
    ]);
    expect(counts.Other).toBe(9);
    expect(sourceChannelTotal(counts)).toBe(2);
  });
});
