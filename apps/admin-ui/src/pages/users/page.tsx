import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Layout from '@/components/feature/Layout';
import { EmptyState } from '@/components/ui/EmptyState';
import { REFEX_ENV_CONFIG, type RefexEnvironment } from '@/seeds/refexAppCatalog';
import { isBackendApiMode } from '@/services/backendApi';
import { loadWorkspaceUsers, type WorkspaceUser } from '@/services/usersApi';
import { formatLogin } from '@/services/userAnalytics';

const ENV_STORAGE_KEY = 'ne_users_environment';

function readEnvPreference(): RefexEnvironment {
  try {
    const v = localStorage.getItem(ENV_STORAGE_KEY);
    if (v === 'Production' || v === 'Development') return v;
  } catch {
    /* ignore */
  }
  return 'Production';
}

type LoginFilter = 'all' | 'today' | 'inactive' | 'never';

function matchesFilter(user: WorkspaceUser, filter: LoginFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'today') return user.loggedInToday;
  if (filter === 'inactive') return !user.loggedInToday && !!user.lastLogin;
  if (filter === 'never') return !user.lastLogin;
  return true;
}

export default function UsersPage() {
  const [environment, setEnvironment] = useState<RefexEnvironment>(readEnvPreference);
  const [loading, setLoading] = useState(isBackendApiMode());
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [users, setUsers] = useState<WorkspaceUser[]>([]);
  const [totals, setTotals] = useState({ total_users: 0, active_today: 0, inactive: 0, never_logged_in: 0 });
  const [search, setSearch] = useState('');
  const [loginFilter, setLoginFilter] = useState<LoginFilter>('all');

  useEffect(() => {
    if (!isBackendApiMode()) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    loadWorkspaceUsers(environment).then((result) => {
      if (cancelled) return;
      setUsers(result.users);
      setTotals(result.totals);
      setError(result.error || null);
      setWarning(result.warning || null);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [environment]);

  const rows = useMemo(() => {
    const q = search.toLowerCase();
    return users.filter((user) => {
      const matchSearch =
        !q ||
        user.name.toLowerCase().includes(q) ||
        user.email.toLowerCase().includes(q) ||
        user.userId.toLowerCase().includes(q);
      return matchSearch && matchesFilter(user, loginFilter);
    });
  }, [users, search, loginFilter]);

  const envMeta = REFEX_ENV_CONFIG[environment];

  return (
    <Layout
      breadcrumbs={[
        { label: 'Home', path: '/applications' },
        { label: 'Users' },
      ]}
    >
      <div className="dash-banner mb-6 px-5 py-4 flex flex-col lg:flex-row lg:items-center gap-4">
        <div>
          <h1 className="text-lg font-bold text-[#1E293B] tracking-tight">Users</h1>
          <p className="text-xs text-[#64748B] mt-0.5">
            Full Kissflow account directory · {envMeta.subdomain}.kissflow.com · PostgreSQL snapshot
          </p>
        </div>
        <div className="flex items-center gap-2 lg:ml-auto">
          {(['Production', 'Development'] as const).map((env) => (
            <button
              key={env}
              type="button"
              onClick={() => {
                setEnvironment(env);
                localStorage.setItem(ENV_STORAGE_KEY, env);
              }}
              className={`h-8 px-3 rounded-lg text-xs font-semibold cursor-pointer ${
                environment === env
                  ? 'bg-primary-600 text-white'
                  : 'bg-white border border-background-300 text-foreground-600'
              }`}
            >
              {env}
            </button>
          ))}
        </div>
      </div>

      {!isBackendApiMode() && (
        <EmptyState
          variant="apps"
          title="Backend API mode required"
          description="Enable VITE_USE_BACKEND_API to load the workspace user directory from PostgreSQL."
        />
      )}

      {isBackendApiMode() && (
        <>
          {error && (
            <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              {error}
            </div>
          )}
          {warning && !error && (
            <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
              {warning}
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
            <Stat label="Total users" value={totals.total_users} />
            <Stat label="Active today" value={totals.active_today} accent />
            <Stat label="Inactive" value={totals.inactive} />
            <Stat label="Never logged in" value={totals.never_logged_in} />
          </div>

          <p className="text-xs text-foreground-500 mb-4">
            Application detail pages show a filtered subset: users with assignments or app roles for
            that project only.{' '}
            <Link to="/applications" className="text-primary-600 font-medium hover:underline">
              Open an application
            </Link>
          </p>

          <div className="flex items-center gap-3 flex-wrap mb-4">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-sm text-foreground-400"></i>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, email, user id..."
                className="w-full h-9 pl-9 pr-3 text-sm rounded-lg border border-background-300/60 outline-none focus:border-primary-300"
              />
            </div>
            <div className="flex items-center bg-background-100 rounded-lg p-0.5 flex-wrap">
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
                  className={`h-7 px-2.5 rounded-md text-xs font-medium cursor-pointer whitespace-nowrap ${
                    loginFilter === value
                      ? 'bg-white shadow-sm text-foreground-900'
                      : 'text-foreground-500'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="bg-white border border-background-300/60 rounded-xl overflow-hidden">
            {loading ? (
              <div className="p-8 text-center text-sm text-foreground-500">Loading users…</div>
            ) : rows.length === 0 ? (
              <div className="p-8 text-center text-sm text-foreground-500">No users match your filters.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[760px]">
                  <thead>
                    <tr className="border-b border-background-200/70 bg-background-50 text-left text-[11px] uppercase tracking-wide text-foreground-400">
                      <th className="px-3 py-2.5 font-medium">User</th>
                      <th className="px-3 py-2.5 font-medium">Email</th>
                      <th className="px-3 py-2.5 font-medium">Type</th>
                      <th className="px-3 py-2.5 font-medium">Status</th>
                      <th className="px-3 py-2.5 font-medium text-center">Login today</th>
                      <th className="px-3 py-2.5 font-medium">Last signed in</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((user) => (
                      <tr key={user.userId} className="border-b border-background-100 last:border-0">
                        <td className="px-3 py-2.5 font-medium text-foreground-900">{user.name}</td>
                        <td className="px-3 py-2.5 text-primary-600">{user.email || '—'}</td>
                        <td className="px-3 py-2.5 text-foreground-600">{user.userType || '—'}</td>
                        <td className="px-3 py-2.5 text-foreground-600">{user.status}</td>
                        <td className="px-3 py-2.5 text-center">{user.loggedInToday ? 'Yes' : 'No'}</td>
                        <td className="px-3 py-2.5 text-foreground-600">{formatLogin(user.lastLogin)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </Layout>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="bg-white border border-background-300/60 rounded-xl px-3 py-2.5">
      <p className="text-[10px] uppercase tracking-wide text-foreground-400 font-medium">{label}</p>
      <p className={`text-xl font-semibold mt-0.5 ${accent ? 'text-accent-700' : 'text-foreground-950'}`}>
        {value}
      </p>
    </div>
  );
}
