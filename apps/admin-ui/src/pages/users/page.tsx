import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronsUpDown, Search, Users } from 'lucide-react';
import Layout from '@/components/feature/Layout';
import DashboardLoadingOverlay from '@/components/feature/DashboardLoadingOverlay';
import UserWorkExpandPanel from '@/components/feature/UserWorkExpandPanel';
import { EmptyState } from '@/components/ui/EmptyState';
import { REFEX_ENV_CONFIG } from '@/seeds/refexAppCatalog';
import { isBackendApiMode } from '@/services/backendApi';
import {
  loadUserManagement,
  type UserManagementRow,
} from '@/services/usersApi';
import { formatLogin } from '@/services/userAnalytics';
import { resolvePersonDisplayName } from '@/lib/personName';

type LoginFilter = 'all' | 'today' | 'inactive' | 'never';
type WorkFilter = 'all' | 'open' | 'closed' | 'rejected';

export default function UsersPage() {
  const environment = 'Production' as const;
  const [loading, setLoading] = useState(isBackendApiMode());
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [items, setItems] = useState<UserManagementRow[]>([]);
  const [totals, setTotals] = useState({
    total_users: 0,
    active_today: 0,
    open: 0,
    closed: 0,
    rejected: 0,
  });
  const [search, setSearch] = useState('');
  const [loginFilter, setLoginFilter] = useState<LoginFilter>('all');
  const [workFilter, setWorkFilter] = useState<WorkFilter>('all');
  const [appFilter, setAppFilter] = useState('all');
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);

  useEffect(() => {
    if (!isBackendApiMode()) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    loadUserManagement(environment).then((result) => {
      if (cancelled) return;
      setItems(result.items);
      setTotals(result.totals);
      setError(result.error || null);
      setWarning(result.warning || null);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const appOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of items) {
      for (const app of row.applications || []) {
        map.set(app.application_id, app.application_name || app.application_id);
      }
    }
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [items]);

  const rows = useMemo(() => {
    const q = search.toLowerCase().trim();
    const filtered = items.filter((user) => {
      const name = String(user.user_name || '').toLowerCase();
      const email = String(user.email || '').toLowerCase();
      const uid = String(user.user_id || '').toLowerCase();
      const matchSearch =
        !q ||
        name.includes(q) ||
        email.includes(q) ||
        uid.includes(q) ||
        (user.applications || []).some((a) =>
          String(a.application_name || a.application_id || '')
            .toLowerCase()
            .includes(q),
        );
      if (!matchSearch) return false;

      if (loginFilter === 'today' && !user.signed_in_today) return false;
      if (loginFilter === 'inactive' && (user.signed_in_today || !user.last_sign_in)) return false;
      if (loginFilter === 'never' && user.ever_logged_in) return false;

      if (workFilter === 'open' && Number(user.open || 0) <= 0) return false;
      if (workFilter === 'closed' && Number(user.closed || 0) <= 0) return false;
      if (workFilter === 'rejected' && Number(user.rejected || 0) <= 0) return false;

      if (appFilter !== 'all') {
        const hit = (user.applications || []).some((a) => a.application_id === appFilter);
        if (!hit) return false;
      }
      return true;
    });
    return [...filtered].sort((a, b) => {
      const denA = Number(a.open || 0) + Number(a.closed || 0);
      const denB = Number(b.open || 0) + Number(b.closed || 0);
      const ra = denA > 0 ? Number(a.closed || 0) / denA : 0;
      const rb = denB > 0 ? Number(b.closed || 0) / denB : 0;
      if (rb !== ra) return rb - ra;
      return Number(b.total || 0) - Number(a.total || 0);
    });
  }, [items, search, loginFilter, workFilter, appFilter]);

  const closurePct = (open: number, closed: number) => {
    const den = open + closed;
    return den > 0 ? Math.round((closed / den) * 1000) / 10 : 0;
  };

  const envMeta = REFEX_ENV_CONFIG.Production;

  const safeUserDisplayName = (u: UserManagementRow): string => {
    return resolvePersonDisplayName(u.user_name, u.email, u.user_id) || u.email || u.user_id || '—';
  };
  const adoptionPct = totals.total_users
    ? Math.round((totals.active_today / totals.total_users) * 100)
    : 0;

  return (
    <Layout
      breadcrumbs={[
        { label: 'Home', path: '/applications' },
        { label: 'User management' },
      ]}
    >
      <div className="relative space-y-4">
        <DashboardLoadingOverlay show={loading && items.length === 0} mode="fixed" label="Loading users…" />

        <div className="overflow-hidden rounded-3xl bg-[#EEF3FF] px-5 py-5 text-slate-800 shadow-[0_2px_8px_rgba(40,60,90,0.04)] ring-1 ring-[#D7E2EF]">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white ring-1 ring-[#D7E2EF]">
                <Users className="h-5 w-5 text-[#3977BE]" />
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#3977BE]/80">Directory</p>
                <h1 className="text-lg font-bold tracking-tight text-slate-900">User management</h1>
                <p className="mt-0.5 text-xs text-slate-500">
                  Cross-app open / closed / rejected · {envMeta.subdomain} · Production
                </p>
              </div>
            </div>
            <div className="rounded-2xl bg-white px-4 py-2.5 ring-1 ring-[#D7E2EF]">
              <div className="text-[10px] uppercase tracking-wide text-slate-400">Total users</div>
              <div className="text-2xl font-semibold tabular-nums text-slate-900">{totals.total_users.toLocaleString('en-IN')}</div>
            </div>
          </div>
        </div>

        {!isBackendApiMode() && (
          <EmptyState
            variant="apps"
            title="Backend API mode required"
            description="Enable VITE_USE_BACKEND_API to load user management from PostgreSQL."
          />
        )}

        {isBackendApiMode() && (
          <>
            {error && (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                {error}
              </div>
            )}
            {warning && !error && (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                {warning}
              </div>
            )}

            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
              <Stat label="Users" value={totals.total_users} />
              <Stat label="Active today" value={totals.active_today} accent />
              <div className="rounded-2xl bg-[#F0EDFF] px-3.5 py-3 text-slate-800 shadow-sm ring-1 ring-[#E0D9F5]">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-[#5B4B9A]">Adoption today</p>
                <p className="mt-1 text-2xl font-bold tabular-nums leading-none">{adoptionPct}%</p>
                <p className="mt-1 text-[10px] text-slate-500">Active today ÷ users</p>
              </div>
              <Stat label="Open" value={totals.open} tone="text-[#A96A20]" />
              <Stat label="Closed" value={totals.closed} tone="text-[#287B5D]" />
              <Stat label="Rejected" value={totals.rejected} tone="text-[#B24E66]" />
            </div>

            <div className="rounded-3xl border border-slate-200/80 bg-white/95 p-3 shadow-[0_8px_30px_rgba(15,23,42,0.06)] sm:p-4">
              <div className="flex flex-wrap items-center gap-2.5">
                <div className="relative min-w-[180px] max-w-sm flex-1">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search name, email, app…"
                    className="h-11 w-full rounded-2xl border border-slate-200 bg-white pl-10 pr-3 text-sm font-medium outline-none focus:border-teal-300 focus:ring-2 focus:ring-teal-100"
                  />
                </div>
                <label className="relative inline-flex min-w-[11rem]">
                  <span className="sr-only">Application</span>
                  <select
                    className="h-11 w-full appearance-none rounded-2xl border border-emerald-200/80 bg-white pl-3.5 pr-9 text-sm font-semibold text-slate-800 outline-none focus:ring-2 focus:ring-emerald-100"
                    value={appFilter}
                    onChange={(e) => setAppFilter(e.target.value)}
                  >
                    <option value="all">All applications</option>
                    {appOptions.map(([id, name]) => (
                      <option key={id} value={id}>
                        {name}
                      </option>
                    ))}
                  </select>
                  <ChevronsUpDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                </label>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <div className="flex flex-wrap items-center gap-1 rounded-2xl bg-slate-100 p-1">
                  {(
                    [
                      ['all', 'All'],
                      ['today', 'Logged in today'],
                      ['inactive', 'Inactive'],
                      ['never', 'Never'],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setLoginFilter(value)}
                      className={`h-8 cursor-pointer whitespace-nowrap rounded-xl px-3 text-xs font-semibold transition ${
                        loginFilter === value
                          ? 'bg-[#E9F1FF] text-[#3977BE] shadow-sm ring-1 ring-[#D0E0F5]'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-1 rounded-2xl bg-slate-100 p-1">
                  {(
                    [
                      ['all', 'Any work'],
                      ['open', 'Has open'],
                      ['closed', 'Has closed'],
                      ['rejected', 'Has rejected'],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setWorkFilter(value)}
                      className={`h-8 cursor-pointer whitespace-nowrap rounded-xl px-3 text-xs font-semibold transition ${
                        workFilter === value
                          ? 'bg-[#EEF5FF] text-[#3977BE] shadow-sm ring-1 ring-[#D0E0F5]'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <p className="text-xs text-slate-500">
              Sorted by closure %. Service accounts filtered out.{' '}
              <Link to="/applications" className="font-semibold text-[#3977BE] hover:underline">
                Open an application
              </Link>
            </p>

            <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_8px_30px_rgba(15,23,42,0.05)]">
              {loading && items.length === 0 ? (
                <div className="min-h-[200px]" />
              ) : rows.length === 0 ? (
                <div className="p-10 text-center text-sm text-slate-500">No users match your filters.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[980px] text-sm">
                    <thead>
                      <tr className="border-b border-slate-100 bg-slate-50/90 text-left text-[11px] uppercase tracking-wide text-slate-500">
                        <th className="px-4 py-3 font-semibold">User</th>
                        <th className="px-4 py-3 font-semibold">Applications</th>
                        <th className="px-4 py-3 text-right font-semibold">Open</th>
                        <th className="px-4 py-3 text-right font-semibold">Closed</th>
                        <th className="px-4 py-3 text-right font-semibold">Rejected</th>
                        <th className="px-4 py-3 text-right font-semibold">Closure %</th>
                        <th className="px-4 py-3 text-center font-semibold">Login today</th>
                        <th className="px-4 py-3 font-semibold">Last signed in</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((user) => {
                        const expanded = expandedUserId === user.user_id;
                        return (
                          <Fragment key={user.user_id}>
                            <tr
                              className="cursor-pointer border-b border-slate-50 last:border-0 align-top hover:bg-[#EEF5FF]/70"
                              onClick={() => setExpandedUserId(expanded ? null : user.user_id)}
                            >
                              <td className="px-4 py-3">
                                <div className="flex items-start gap-2">
                                  <ChevronDown
                                    className={`mt-0.5 h-4 w-4 shrink-0 text-slate-400 transition ${expanded ? 'rotate-180' : ''}`}
                                  />
                                  <div>
                                    <div className="font-semibold text-slate-900">{safeUserDisplayName(user)}</div>
                                    <div className="text-xs text-[#3977BE]">{user.email || '—'}</div>
                                  </div>
                                </div>
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex flex-col gap-1">
                                  {(user.applications || []).map((app) => (
                                    <div key={`${user.user_id}-${app.application_id}`} className="text-xs text-slate-700">
                                      <span className="font-medium">{app.application_name}</span>
                                      <span className="text-slate-400">
                                        {' '}
                                        · O {app.open} · C {app.closed} · R {app.rejected}
                                      </span>
                                    </div>
                                  ))}
                                  {!user.applications?.length ? (
                                    <span className="text-xs text-slate-400">No app roles</span>
                                  ) : null}
                                </div>
                              </td>
                              <td className="px-4 py-3 text-right font-semibold tabular-nums text-[#A96A20]">
                                {user.open}
                              </td>
                              <td className="px-4 py-3 text-right font-semibold tabular-nums text-[#287B5D]">
                                {user.closed}
                              </td>
                              <td className="px-4 py-3 text-right font-semibold tabular-nums text-[#B24E66]">
                                {user.rejected}
                              </td>
                              <td className="px-4 py-3 text-right font-semibold tabular-nums text-slate-800">
                                {closurePct(Number(user.open || 0), Number(user.closed || 0))}%
                              </td>
                              <td className="px-4 py-3 text-center">
                                <span
                                  className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${
                                    user.signed_in_today
                                      ? 'bg-[#E8F7F0] text-[#287B5D] ring-[#CDEBD9]'
                                      : 'bg-slate-50 text-slate-500 ring-slate-200'
                                  }`}
                                >
                                  {user.signed_in_today ? 'Yes' : 'No'}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-slate-600">{formatLogin(user.last_sign_in)}</td>
                            </tr>
                            {expanded ? (
                              <tr className="border-b border-slate-100">
                                <td colSpan={8} className="max-w-0 p-0">
                                  <div className="max-w-full overflow-hidden">
                                    <UserWorkExpandPanel
                                      userName={safeUserDisplayName(user)}
                                      email={user.email}
                                      applications={user.applications}
                                      environment="Production"
                                    />
                                  </div>
                                </td>
                              </tr>
                            ) : null}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}

function Stat({
  label,
  value,
  accent,
  tone,
}: {
  label: string;
  value: number;
  accent?: boolean;
  tone?: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white px-3.5 py-3 shadow-sm">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums leading-none ${accent ? 'text-[#3977BE]' : tone || 'text-slate-900'}`}>
        {value.toLocaleString('en-IN')}
      </p>
    </div>
  );
}
