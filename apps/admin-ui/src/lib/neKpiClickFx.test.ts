import { describe, expect, it } from 'vitest';
import { neKpiClickKind } from './neKpiClickFx';

describe('neKpiClickKind', () => {
  it('gives each named card its own effect', () => {
    expect(neKpiClickKind('Total items')).toBe('all');
    expect(neKpiClickKind('Total users')).toBe('users');
    expect(neKpiClickKind('Active / signed in today')).toBe('users');
    expect(neKpiClickKind('Adoption today')).toBe('adoption');
    expect(neKpiClickKind('Adoption · overall')).toBe('adoption');
    expect(neKpiClickKind('Open items')).toBe('pending');
    expect(neKpiClickKind('Closed items')).toBe('approved');
    expect(neKpiClickKind('Opened today')).toBe('today');
    expect(neKpiClickKind('Closed today')).toBe('today');
    expect(neKpiClickKind('Rejected')).toBe('reject');
    expect(neKpiClickKind('SLA breached')).toBe('overdue');
    expect(neKpiClickKind('Booked')).toBe('money');
    expect(neKpiClickKind('In progress')).not.toBe('all');
    expect(neKpiClickKind('Something else')).toBe('tap');
  });
});
