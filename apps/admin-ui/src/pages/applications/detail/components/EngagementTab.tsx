import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { KissflowApplication } from '@/mocks/applications';
import {
  buildEngagementReport,
  fetchKissflowUserDetail,
  formatLogin,
  loadCachedEngagement,
  type EngagementReport,
  type UserEngagementRow,
} from '@/services/userAnalytics';
import { isBackendApiMode } from '@/services/backendApi';
import { loadEngagementFromBackend } from '@/services/engagementApi';
import { buildLeadReport, type LeadReport } from '@/services/leadReport';
import {
  kissflowExtraDetailEntries,
  kissflowUserDetailEntries,
} from '@/services/kissflowUserDisplay';
import { REFEX_ENV_CONFIG } from '@/seeds/refexAppCatalog';
import Sheet from '@/components/ui/Sheet';

interface EngagementTabProps {
  app: KissflowApplication;
}

type LoginFilter = 'all' | 'today' | 'inactive' | 'never' | 'assigned' | 'role';

const FILTER_PILLS: { value: LoginFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'assigned', label: 'Has assignments' },
  { value: 'role', label: 'App role' },
  { value: 'today', label: 'Logged in today' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'never', label: 'Never' },
];

function withKissflowCredentials(app: KissflowApplication): KissflowApplication {
  const creds = REFEX_ENV_CONFIG[app.environment];
  return {
    ...app,
    accountId: app.accountId || creds.accountId,
    subdomain: app.subdomain || creds.subdomain,
    accessKeyId: app.accessKeyId || creds.accessKeyId,
    accessKeySecret: app.accessKeySecret || creds.accessKeySecret,
  };
}

function hasKissflowCredentials(app: KissflowApplication): boolean {
  const resolved = withKissflowCredentials(app);
  return Boolean(resolved.accessKeyId && resolved.accessKeySecret);
}

function isLeadTrackerApp(app: KissflowApplication): boolean {
  return (
    app.id.includes('lead-tracker') ||
    app.appId.includes('Lead_tracker') ||
    app.appId.includes('Lead_Trcaker') ||
    app.name.toLowerCase().includes('lead tracker')
  );
}

function leadReportToEngagement(report: LeadReport, app: KissflowApplication): EngagementReport {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return {
    applicationId: app.id,
    generatedAt: report.generatedAt,
    users: report.rows.map((row) => {
      const lastLogin = row.lastSignedIn;
      const loginDate = lastLogin ? new Date(lastLogin) : null;
      const loggedInToday = Boolean(loginDate && loginDate >= start);
      return {
        userId: row.email || row.name,
        email: row.email,
        name: row.name,
        role: '',
        department: '',
        status: 'Active',
        lastLogin,
        loggedInToday,
        daysSinceLogin:
          loginDate && !Number.isNaN(loginDate.getTime())
            ? Math.floor((Date.now() - loginDate.getTime()) / (1000 * 60 * 60 * 24))
            : null,
        assigned: row.openLeads + row.closedLeads,
        open: row.openLeads,
        pending: 0,
        closed: 0,
        completed: row.closedLeads,
        rejected: 0,
        other: 0,
        byResource: [],
      };
    }),
    totals: {
      totalUsers: report.rows.length,
      activeToday: report.rows.filter((r) => r.loggedInToday).length,
      inactive: report.rows.filter((r) => r.lastSignedIn && !r.loggedInToday).length,
      neverLoggedIn: report.rows.filter((r) => !r.lastSignedIn).length,
      totalAssigned: report.totals.totalLeads,
    },
    errors: report.errors,
    source: report.source,
  };
}

function matchesFilter(u: UserEngagementRow, filter: LoginFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'today') return u.loggedInToday;
  if (filter === 'inactive') return !u.loggedInToday && !!u.lastLogin;
  if (filter === 'never') return !u.lastLogin;
  if (filter === 'assigned') return u.assigned > 0;
  if (filter === 'role') return Boolean(u.hasAppRole || (u.appRoleNames && u.appRoleNames.length > 0));
  return true;
}

export default function EngagementTab({ app }: EngagementTabProps) {
  const [report, setReport] = useState<EngagementReport | null>(() => loadCachedEngagement(app.id));
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [loginFilter, setLoginFilter] = useState<LoginFilter>('all');
  const [selected, setSelected] = useState<UserEngagementRow | null>(null);
  const [errorBanner, setErrorBanner] = useState('');

  const refresh = useCallback(async (live = false) => {
    setLoading(true);
    setErrorBanner('');
    try {
      if (isBackendApiMode()) {
        const result = await loadEngagementFromBackend(app, { live });
        if (result.report?.users.length) {
          setReport(result.report);
          if (result.warning) setErrorBanner(result.warning);
          else if (result.report.errors.length) setErrorBanner(result.report.errors.slice(0, 3).join(' · '));
          return;
        }

        if (isLeadTrackerApp(app) && hasKissflowCredentials(app)) {
          const kissflowApp = withKissflowCredentials(app);
          const lead = await buildLeadReport(kissflowApp, {
            processId: kissflowApp.processIds?.[0] || 'Lead_tracker_1_A00',
          });
          if (lead.rows.length) {
            setReport(leadReportToEngagement(lead, app));
            setErrorBanner(
              'Showing live Kissflow lead assignees. Run ops/runbooks/16-ingest-lead-tracker-and-load.sh to cache in PostgreSQL.',
            );
            return;
          }
          if (lead.errors.length) {
            setReport(result.report);
            setErrorBanner(lead.errors.slice(0, 3).join(' · '));
            return;
          }
        }

        setReport(result.report);
        setErrorBanner(
          result.error ||
            (isLeadTrackerApp(app)
              ? hasKissflowCredentials(app)
                ? 'No lead assignees found in PostgreSQL or Kissflow. Run: bash ops/runbooks/16-ingest-lead-tracker-and-load.sh'
                : 'Kissflow credentials missing in Admin UI. Run: bash ops/runbooks/sync-kissflow-env-local.sh then restart Admin UI (npm run dev).'
              : 'Could not load engagement from backend-api'),
        );
        return;
      }

      const next = await buildEngagementReport(app);
      setReport(next);
      if (next.errors.length && !next.users.length) {
        setErrorBanner(next.errors.slice(0, 3).join(' · '));
      } else if (next.errors.length) {
        setErrorBanner(`Partial data. ${next.errors.length} source warning(s).`);
      }
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [app]);

  useEffect(() => {
    if (isBackendApiMode()) {
      void refresh(false);
      return;
    }
    const cached = loadCachedEngagement(app.id);
    setReport(cached);
    if (!cached) {
      void refresh();
    }
  }, [app.id, refresh]);

  const appRoleCount = useMemo(() => {
    if (!report) return 0;
    return report.users.filter(
      (u) => u.hasAppRole || (u.appRoleNames && u.appRoleNames.length > 0),
    ).length;
  }, [report]);

  const rows = useMemo(() => {
    if (!report) return [];
    return report.users.filter((u) => {
      const q = search.toLowerCase();
      const matchSearch =
        !q ||
        u.name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        u.department.toLowerCase().includes(q) ||
        u.role.toLowerCase().includes(q) ||
        u.userId.toLowerCase().includes(q);
      return matchSearch && matchesFilter(u, loginFilter);
    });
  }, [report, search, loginFilter]);

  const exportCsv = () => {
    const header = [
      'Name',
      'Email',
      'User ID',
      'Status',
      'Role',
      'Department',
      'Assigned',
      'Open',
      'Pending',
      'Closed',
      'Completed',
      'Rejected',
      'Logged In Today',
      'Last Login',
    ];
    const lines = rows.map((u) =>
      [
        u.name,
        u.email,
        u.userId,
        u.status,
        u.role,
        u.department,
        u.assigned,
        u.open,
        u.pending,
        u.closed,
        u.completed,
        u.rejected,
        u.loggedInToday ? 'Yes' : 'No',
        u.lastLogin || 'Never',
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(','),
    );
    const blob = new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${app.displayName || app.name}-user-engagement.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const filterActive = loginFilter !== 'all';

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-semibold text-foreground-950">User Engagement</h2>
          <p className="text-xs text-foreground-500 mt-0.5">
            {isBackendApiMode()
              ? 'Users with assignments or app roles in this application only — not the full account directory.'
              : 'Assigned workload and login activity across processes, boards, and dataforms'}
            {report?.generatedAt
              ? ` · Updated ${new Date(report.generatedAt).toLocaleString()}`
              : ''}
            {report?.source === 'cache' ? ' · cached' : ''}
          </p>
          {isBackendApiMode() && (
            <p className="text-xs text-primary-700 mt-1">
              Full user list:{' '}
              <Link to="/users" className="font-semibold hover:underline">
                Workspace → Users
              </Link>
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={exportCsv}
            disabled={!rows.length}
            className="h-8 px-3 rounded-lg border border-background-300/60 text-xs font-medium text-foreground-700 hover:bg-background-50 disabled:opacity-50 cursor-pointer inline-flex items-center gap-1.5"
          >
            <i className="ri-download-line"></i>
            Export
          </button>
          <button
            type="button"
            onClick={() => void refresh(isBackendApiMode())}
            disabled={loading}
            className="h-8 px-3 rounded-lg bg-primary-500 text-white text-xs font-medium hover:bg-primary-600 disabled:opacity-50 cursor-pointer inline-flex items-center gap-1.5"
          >
            {loading ? (
              <>
                <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                Refreshing
              </>
            ) : (
              <>
                <i className="ri-refresh-line"></i>
                Refresh analytics
              </>
            )}
          </button>
        </div>
      </div>

      {report && (
        <div className={`grid grid-cols-2 gap-2 ${isBackendApiMode() ? 'md:grid-cols-3 lg:grid-cols-6' : 'md:grid-cols-5'}`}>
          <Stat
            label={isBackendApiMode() ? 'Users in this app' : 'Total users'}
            value={report.totals.totalUsers}
            active={loginFilter === 'all'}
            onClick={() => setLoginFilter('all')}
            hint={
              isBackendApiMode()
                ? 'People with assignments or app roles in this application only'
                : 'All users in engagement report'
            }
          />
          <Stat
            label="Active today"
            value={report.totals.activeToday}
            accent
            active={loginFilter === 'today'}
            onClick={() => setLoginFilter('today')}
          />
          <Stat
            label="Inactive"
            value={report.totals.inactive}
            active={loginFilter === 'inactive'}
            onClick={() => setLoginFilter('inactive')}
          />
          <Stat
            label="Never logged in"
            value={report.totals.neverLoggedIn}
            active={loginFilter === 'never'}
            onClick={() => setLoginFilter('never')}
          />
          <Stat
            label="Assigned records"
            value={report.totals.totalAssigned}
            active={loginFilter === 'assigned'}
            onClick={() => setLoginFilter('assigned')}
            hint="Users with ≥1 assignment"
          />
          {isBackendApiMode() && (
            <Stat
              label="App role"
              value={appRoleCount}
              active={loginFilter === 'role'}
              onClick={() => setLoginFilter('role')}
              hint="Users with a Kissflow app role on this application"
            />
          )}
        </div>
      )}

      {filterActive && report && (
        <p className="text-xs text-primary-700 bg-primary-50 border border-primary-100 rounded-lg px-3 py-2">
          Showing <strong>{rows.length}</strong> of {report.users.length} users ·{' '}
          {FILTER_PILLS.find((p) => p.value === loginFilter)?.label}
          <button
            type="button"
            onClick={() => setLoginFilter('all')}
            className="ml-2 font-semibold underline cursor-pointer"
          >
            Clear filter
          </button>
        </p>
      )}

      {errorBanner && (
        <div className="px-3 py-2 rounded-lg bg-amber-50 border border-amber-100 text-xs text-amber-800">
          {errorBanner}
        </div>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-sm text-foreground-400"></i>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, email, department..."
            className="w-full h-9 pl-9 pr-3 text-sm rounded-lg border border-background-300/60 outline-none focus:border-primary-300"
          />
        </div>
        <div className="flex items-center bg-background-100 rounded-lg p-0.5 flex-wrap">
          {FILTER_PILLS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              onClick={() => setLoginFilter(value)}
              className={`h-7 px-2.5 rounded-md text-xs font-medium cursor-pointer whitespace-nowrap transition-colors ${
                loginFilter === value
                  ? 'bg-white shadow-sm text-foreground-900 ring-1 ring-primary-200'
                  : 'text-foreground-500 hover:text-foreground-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div
        className={`bg-white border rounded-xl overflow-hidden transition-colors ${
          filterActive ? 'border-primary-200 ring-2 ring-primary-100/80' : 'border-background-300/60'
        }`}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[960px]">
            <thead>
              <tr className="border-b border-background-200/70 bg-background-50 text-left text-[11px] uppercase tracking-wide text-foreground-400">
                <th className="px-3 py-2.5 font-medium">User</th>
                <th className="px-3 py-2.5 font-medium">Email</th>
                {isBackendApiMode() && <th className="px-3 py-2.5 font-medium">App roles</th>}
                <th className="px-3 py-2.5 font-medium text-right">Assigned</th>
                <th className="px-3 py-2.5 font-medium text-right">Open</th>
                <th className="px-3 py-2.5 font-medium text-right">Pending</th>
                <th className="px-3 py-2.5 font-medium text-right">Closed</th>
                <th className="px-3 py-2.5 font-medium text-right">Completed</th>
                <th className="px-3 py-2.5 font-medium text-right">Rejected</th>
                <th className="px-3 py-2.5 font-medium text-center">Login today</th>
                <th className="px-3 py-2.5 font-medium">Last signed in</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr
                  key={u.userId}
                  onClick={() => setSelected(u)}
                  className={`border-b border-background-100 last:border-0 hover:bg-primary-50/50 cursor-pointer transition-colors ${
                    filterActive ? 'bg-primary-50/20' : ''
                  }`}
                >
                  <td className="px-3 py-2.5">
                    <div className="font-medium text-foreground-900">{u.name}</div>
                    {(u.role || u.department) && (
                      <div className="text-[11px] text-foreground-400">
                        {[u.role, u.department].filter(Boolean).join(' · ')}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    {u.email ? (
                      <a
                        href={`mailto:${u.email}`}
                        onClick={(e) => e.stopPropagation()}
                        className="text-primary-600 hover:underline"
                      >
                        {u.email}
                      </a>
                    ) : (
                      <span className="text-foreground-400">—</span>
                    )}
                  </td>
                  {isBackendApiMode() && (
                    <td className="px-3 py-2.5 text-xs text-foreground-600 max-w-[180px]">
                      {u.appRoleNames?.length ? (
                        <span className="line-clamp-2" title={u.appRoleNames.join(', ')}>
                          {u.appRoleNames.slice(0, 2).join(', ')}
                          {u.appRoleNames.length > 2 ? ` +${u.appRoleNames.length - 2}` : ''}
                        </span>
                      ) : u.assigned > 0 ? (
                        <span className="chip-muted">Assigned only</span>
                      ) : (
                        '—'
                      )}
                    </td>
                  )}
                  <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{u.assigned}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-foreground-700">{u.open}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-foreground-700">{u.pending}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-foreground-700">{u.closed}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-foreground-700">{u.completed}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-foreground-700">{u.rejected}</td>
                  <td className="px-3 py-2.5 text-center">
                    {u.loggedInToday ? (
                      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-accent-50 text-accent-700">
                        <i className="ri-check-line"></i>
                      </span>
                    ) : (
                      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-red-50 text-red-600">
                        <i className="ri-close-line"></i>
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-foreground-500 whitespace-nowrap">
                    {formatLogin(u.lastLogin)}
                  </td>
                </tr>
              ))}
              {!loading && rows.length === 0 && (
                <tr>
                  <td
                    colSpan={isBackendApiMode() ? 11 : 10}
                    className="px-3 py-12 text-center text-sm text-foreground-500"
                  >
                    {filterActive
                      ? 'No users match this filter. Try another card or clear the filter.'
                      : 'No engagement data yet. Click Refresh analytics to pull users and records from Kissflow.'}
                  </td>
                </tr>
              )}
              {loading && rows.length === 0 && (
                <tr>
                  <td
                    colSpan={isBackendApiMode() ? 11 : 10}
                    className="px-3 py-12 text-center text-sm text-foreground-500"
                  >
                    Aggregating users and records…
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selected && (
        <UserDrillDown app={app} user={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
  active,
  onClick,
  hint,
}: {
  label: string;
  value: number;
  accent?: boolean;
  active?: boolean;
  onClick?: () => void;
  hint?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={hint}
      className={`text-left bg-white border rounded-xl px-3 py-2.5 cursor-pointer transition-all hover:shadow-md hover:-translate-y-0.5 active:scale-[0.98] ${
        active
          ? 'border-primary-400 ring-2 ring-primary-200 shadow-sm bg-primary-50/30'
          : 'border-background-300/60 hover:border-primary-200'
      }`}
    >
      <p className="text-[10px] uppercase tracking-wide text-foreground-400 font-medium">{label}</p>
      <p className={`text-xl font-semibold mt-0.5 ${accent ? 'text-accent-700' : 'text-foreground-950'}`}>
        {value}
      </p>
      {active && (
        <p className="text-[10px] text-primary-600 font-medium mt-1">Filtered</p>
      )}
    </button>
  );
}

function UserDrillDown({
  app,
  user,
  onClose,
}: {
  app: KissflowApplication;
  user: UserEngagementRow;
  onClose: () => void;
}) {
  const [open, setOpen] = useState(true);
  const [detailRaw, setDetailRaw] = useState<Record<string, unknown> | undefined>(user.kissflowRaw);
  const [loadingDetail, setLoadingDetail] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!user.userId) return;
    if (isBackendApiMode()) {
      setDetailRaw(user.kissflowRaw);
      setLoadingDetail(false);
      return;
    }
    setLoadingDetail(true);
    void fetchKissflowUserDetail(app, user.userId).then((detail) => {
      if (cancelled) return;
      if (detail?.raw) setDetailRaw(detail.raw);
      setLoadingDetail(false);
    });
    return () => {
      cancelled = true;
    };
  }, [app, user.userId, user.kissflowRaw]);

  const allFields = useMemo(() => kissflowUserDetailEntries(detailRaw), [detailRaw]);
  const extraFields = useMemo(() => kissflowExtraDetailEntries(detailRaw), [detailRaw]);

  return (
    <Sheet open={open} onClose={() => setOpen(false)} onExitComplete={onClose}>
      <div className="p-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h3 className="text-base font-semibold text-foreground-950">{user.name}</h3>
            <p className="text-xs text-foreground-500 mt-0.5">{user.email || user.userId}</p>
            {user.status && (
              <span className="inline-block mt-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-background-100 text-foreground-600">
                {user.status}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="w-8 h-8 rounded-lg hover:bg-background-100 flex items-center justify-center cursor-pointer transition-colors duration-150 active:scale-95"
          >
            <i className="ri-close-line"></i>
          </button>
        </div>

        <h4 className="text-xs font-semibold uppercase tracking-wide text-foreground-500 mb-2">
          Workload (this app)
        </h4>
        <div className="grid grid-cols-3 gap-2 mb-4">
          <Mini label="Assigned" value={user.assigned} />
          <Mini label="Open" value={user.open} />
          <Mini label="Pending" value={user.pending} />
          <Mini label="Closed" value={user.closed} />
          <Mini label="Completed" value={user.completed} />
          <Mini label="Rejected" value={user.rejected} />
        </div>

        <div className="rounded-xl border border-background-200/70 p-3 mb-4 text-xs space-y-2">
          <Row label="User ID" value={user.userId} mono />
          <Row label="Login today" value={user.loggedInToday ? 'Yes' : 'No'} />
          <Row label="Last signed in" value={formatLogin(user.lastLogin)} />
          <Row
            label="Days since login"
            value={user.daysSinceLogin == null ? '—' : String(user.daysSinceLogin)}
          />
          <Row label="Role" value={user.role || '—'} />
          <Row label="Department" value={user.department || '—'} />
        </div>

        <h4 className="text-xs font-semibold uppercase tracking-wide text-foreground-500 mb-2">
          Kissflow profile
          {loadingDetail && (
            <span className="ml-2 font-normal normal-case text-foreground-400">Loading…</span>
          )}
        </h4>
        {allFields.length === 0 && !loadingDetail ? (
          <p className="text-xs text-foreground-400 mb-4">
            No Kissflow profile payload stored. Refresh analytics and open again.
          </p>
        ) : (
          <div className="rounded-xl border border-background-200/70 divide-y divide-background-100 mb-4 max-h-64 overflow-y-auto">
            {allFields.map((field) => (
              <div key={field.key} className="px-3 py-2 flex justify-between gap-3 text-xs">
                <span className="text-foreground-500 shrink-0">{field.label}</span>
                <span
                  className={`text-foreground-800 font-medium text-right break-all ${
                    field.key === '_id' ? 'font-mono text-[11px]' : ''
                  }`}
                >
                  {field.value}
                </span>
              </div>
            ))}
          </div>
        )}

        {extraFields.length > 0 && (
          <>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-foreground-500 mb-2">
              Additional API fields (not in table)
            </h4>
            <p className="text-[11px] text-foreground-400 mb-2">
              Examples: Employee ID, Manager, Groups, Roles, phone, timezone, created/modified dates,
              profile picture URL, invitation status, and nested Kissflow objects.
            </p>
            <div className="rounded-xl border border-dashed border-background-300 divide-y divide-background-100 mb-4">
              {extraFields.map((field) => (
                <div key={field.key} className="px-3 py-2 flex justify-between gap-3 text-xs">
                  <span className="text-foreground-500">{field.label}</span>
                  <span className="text-foreground-800 text-right break-all max-w-[58%]">
                    {field.value}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}

        <h4 className="text-xs font-semibold uppercase tracking-wide text-foreground-500 mb-2">
          By resource
        </h4>
        <div className="space-y-2">
          {user.byResource.length === 0 && (
            <p className="text-xs text-foreground-400">No per-resource breakdown available</p>
          )}
          {user.byResource.map((r) => (
            <div
              key={`${r.resourceType}-${r.resourceId}`}
              className="rounded-lg border border-background-200/70 p-3"
            >
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-xs font-mono font-medium text-foreground-800">{r.resourceId}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-background-100 text-foreground-600">
                  {r.resourceType}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-1 text-[11px] text-foreground-600">
                <span>Assigned {r.assigned}</span>
                <span>Open {r.open}</span>
                <span>Pending {r.pending}</span>
                <span>Closed {r.closed}</span>
                <span>Done {r.completed}</span>
                <span>Rejected {r.rejected}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Sheet>
  );
}

function Mini({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-background-50 border border-background-200/70 px-2 py-2 text-center">
      <p className="text-base font-semibold text-foreground-900">{value}</p>
      <p className="text-[10px] text-foreground-400">{label}</p>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-foreground-500">{label}</span>
      <span
        className={`text-foreground-800 font-medium text-right break-all ${
          mono ? 'font-mono text-[11px]' : ''
        }`}
      >
        {value}
      </span>
    </div>
  );
}
