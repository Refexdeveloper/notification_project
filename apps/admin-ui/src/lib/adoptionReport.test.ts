import { describe, expect, it } from 'vitest';
import {
  adoptionCounts,
  adoptionKpisFromUsers,
  adoptionRows,
  adoptionStatus,
  filterAdoptionUsersByUser,
  scopeAdoptionUsers,
} from '@/lib/adoptionReport';
import { companyIdFromLabel } from '@/lib/refexCompanies';

const NOW = new Date('2026-11-02T10:00:00+05:30');

const users = [
  { user_name: 'Never', email: 'never@x.com', last_sign_in: null, ever_logged_in: false },
  { user_name: 'Earlier', email: 'earlier@x.com', last_sign_in: '2026-10-30T09:00:00+05:30' },
  { user_name: 'Today late', email: 'late@x.com', last_sign_in: '2026-11-02T09:30:00+05:30' },
  { user_name: 'Today early', email: 'early@x.com', last_sign_in: '2026-11-02T00:15:00+05:30' },
  { user_name: 'Flag only', email: 'flag@x.com', last_sign_in: null, ever_logged_in: true },
];

describe('adoptionReport', () => {
  it('uses IST calendar day for signed in today', () => {
    expect(adoptionStatus({ last_sign_in: '2026-11-01T19:00:00Z' }, NOW)).toBe('today');
    expect(adoptionStatus({ last_sign_in: '2026-11-01T18:00:00Z' }, NOW)).toBe('earlier');
    expect(adoptionStatus({ ever_logged_in: true }, NOW)).toBe('earlier');
    expect(adoptionStatus({}, NOW)).toBe('never');
  });

  it('counts never exceed the roster', () => {
    const c = adoptionCounts(users, NOW);
    expect(c).toEqual({ all: 5, today: 2, ever: 4, never: 1 });
    expect(c.today).toBeLessThanOrEqual(c.all);
  });

  it('filters by card focus and sorts today first', () => {
    expect(adoptionRows(users, 'today', NOW).map((r) => r.user.user_name)).toEqual(['Today late', 'Today early']);
    expect(adoptionRows(users, 'never', NOW).map((r) => r.user.user_name)).toEqual(['Never']);
    expect(adoptionRows(users, 'all', NOW).map((r) => r.status)).toEqual([
      'today', 'today', 'earlier', 'earlier', 'never',
    ]);
  });

  it('scopes the roster by company and ticket assignees', () => {
    const ril = companyIdFromLabel('Refex Industries Limited');
    const venwind = companyIdFromLabel('Venwind Refex Power Limited');
    const roster = [
      { user_id: '1', user_name: 'Ada', company: 'Refex Industries Limited', last_sign_in: '2026-11-02T05:00:00+05:30' },
      { user_id: '2', user_name: 'Bea', company: 'Venwind Refex Power Limited', last_sign_in: null },
      { user_id: '3', user_name: 'Cara', company: null, last_sign_in: '2026-10-01T05:00:00+05:30' },
    ];
    expect(scopeAdoptionUsers(roster, { company: 'all' })).toHaveLength(3);
    expect(scopeAdoptionUsers(roster, { company: ril, itsmCompanyMode: true }).map((u) => u.user_name)).toEqual(['Ada']);
    expect(scopeAdoptionUsers(roster, { company: venwind, itsmCompanyMode: true }).map((u) => u.user_name)).toEqual(['Bea']);
    expect(
      scopeAdoptionUsers(roster, {
        company: ril,
        itsmCompanyMode: true,
        ticketKeys: ['cara', '3'],
      }).map((u) => u.user_name),
    ).toEqual(['Ada', 'Cara']);
    const kpis = adoptionKpisFromUsers(
      scopeAdoptionUsers(roster, { company: ril, itsmCompanyMode: true }),
      NOW,
    );
    expect(kpis.usersCard).toBe(1);
    expect(kpis.signedInToday).toBe(1);
    expect(kpis.adoptionOverall).toBe(100);
  });

  it('scopes the roster by user filter', () => {
    const roster = [
      { user_id: '1', user_name: 'Ada Lovelace', email: 'ada@x.com', last_sign_in: '2026-11-02T05:00:00+05:30' },
      { user_id: '2', user_name: 'Bea Kernel', email: 'bea@x.com', last_sign_in: null },
      { user_id: '3', user_name: 'Cara Node', email: 'cara@x.com', last_sign_in: '2026-10-01T05:00:00+05:30' },
    ];
    expect(filterAdoptionUsersByUser(roster, 'all')).toHaveLength(3);
    expect(filterAdoptionUsersByUser(roster, '2').map((u) => u.user_name)).toEqual(['Bea Kernel']);
    expect(filterAdoptionUsersByUser(roster, 'Ada Lovelace').map((u) => u.user_name)).toEqual(['Ada Lovelace']);
    const kpis = adoptionKpisFromUsers(filterAdoptionUsersByUser(roster, 'Ada Lovelace'), NOW);
    expect(kpis.usersCard).toBe(1);
    expect(kpis.signedInToday).toBe(1);
    expect(kpis.adoptionOverall).toBe(100);
  });
});
