import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import EmbedDashboardHero from '@/components/feature/EmbedDashboardHero';
import EmbedKpiCard, { EMBED_ADOPTION_THEME, NE_KPI_GRID_CLASS } from '@/components/feature/EmbedKpiCard';
import { resolveNeAppKind, type NeAppKind } from '@/lib/neKpiIcons';
import EmbedAppRecordsTable from '@/components/feature/EmbedAppRecordsTable';
import { MisMobileRecordCard } from '@/components/feature/MisMobileCards';
import { buildEmbedDashboardPath, readEmbedReturnUrl } from '@/lib/embedMode';
import { LayoutDashboard, RefreshCw } from 'lucide-react';
import {
  AlertCircle,
  CheckCircle2,
  FolderKanban,
  Layers,
  Loader2,
  Percent,
  Sparkles,
  Users,
  UserCheck,
  XCircle,
} from 'lucide-react';
import { isBackendApiMode } from '@/services/backendApi';
import {
  appDashboardQueryKey,
  loadApplicationAppUsers,
  loadApplicationDashboard,
  readAppDashboardCache,
  readAppDashboardCacheSoft,
  refreshApplicationDashboardLive,
  type AppDashboardData,
  type AppDashboardUser,
} from '@/services/appDashboardApi';
import type { KissflowApplication } from '@/mocks/applications';
import { resolveBackendApplicationId } from '@/services/applicationsApi';
import {
  buildMisUsersFromRecords,
  companyCountsFromRecords,
  countPmPortfolio,
  countTodayActivity,
  entityCountsFromRecords,
  filterAppRecords,
  ensureFilterOption,
  filterOptionMatches,
  isUsableUserFilterLabel,
  mergeRosterWithTicketCounts,
  overlayRosterSignIn,
  unionRosterWithTicketUsers,
  stampRecordsWithAssigneeCompany,
  summarizeAppRecords,
  type RecordKpiFocus,
} from '@/lib/appDashboardClientFilter';
import { DASHBOARD_VERSION } from '@/lib/dashboardVersion';
import { displayDashCount, displayWhen } from '@/lib/dashboardEmpty';
import { compactMisName, looksLikeKissflowUserId, normalizeItsmPersonLabel } from '@/lib/personName';
import {
  buildEntityBucketOptions,
  buildRefexCompanyOptions,
  sortCompanyFilterOptions,
} from '@/lib/refexCompanies';
import {
  loadApplicationRecordInventory,
  type AppRecordColumn,
  type AppRecordRow,
} from '@/services/appRecordsApi';
import ExecutiveDateFilterBar, { CARD_BORDER, MUTED } from '@/components/feature/ExecutiveDateFilterBar';
import DashboardLoadingOverlay from '@/components/feature/DashboardLoadingOverlay';
import {
  currentIstYear,
  istTodayYmd,
  resolveDateScope,
  type DatePresetId,
} from '@/lib/executiveDateFilters';

function isSignedInTodayIst(lastSignIn: string | null | undefined): boolean {
  if (!lastSignIn) return false;
  try {
    const day = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(lastSignIn));
    return day === istTodayYmd();
  } catch {
    return false;
  }
}

function misUserLoginDisplay(
  user: {
    last_sign_in?: string | null;
    ever_logged_in?: boolean;
    is_active?: boolean;
    active_status?: string | null;
  },
  formatWhen: (v: string) => string,
) {
  const last = user.last_sign_in;
  if (last) {
    const signedToday = isSignedInTodayIst(last);
    return {
      inactive: !signedToday,
      text: formatWhen(last),
      signedToday,
    };
  }
  return { inactive: true, text: '-', signedToday: false };
}

function isSolarApplicationId(id: string) {
  return /solar|technician_reimbursement|reinvestment|site_expense/i.test(String(id || ''));
}

type Props = {
  app: KissflowApplication;
  /** Refexone embed shell — hide hints and extra metadata */
  embed?: boolean;
  /** Bumped by parent header Refresh — reloads incremental cache (does not wait on Kissflow). */
  refreshNonce?: number;
  onRefreshingChange?: (busy: boolean) => void;
};

const OPEN_COLOR = '#D4A574';
const CLOSED_COLOR = '#5BA88A';
const REJECTED_COLOR = '#C97B8C';

const KPI_STYLES = [
  { bg: '#EAF3FF', text: '#1E3A5F', muted: '#5B7A9D', iconBg: '#D6E8FF', iconColor: '#3977BE', icon: Layers },
  { bg: '#FFF2E4', text: '#7A4A1A', muted: '#A96A20', iconBg: '#FFE8CC', iconColor: '#A96A20', icon: FolderKanban },
  { bg: '#E8F7F1', text: '#1F5C45', muted: '#287B5D', iconBg: '#D3EFE3', iconColor: '#287B5D', icon: CheckCircle2 },
  { bg: '#FDECEF', text: '#7A3044', muted: '#B24E66', iconBg: '#F8D9E0', iconColor: '#B24E66', icon: XCircle },
] as const;

function closureRatioPct(open: number, closed: number): number {
  const den = open + closed;
  return den > 0 ? Math.round((closed / den) * 1000) / 10 : 0;
}

function currentIstMonth(): number {
  try {
    return Number(
      new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', month: 'numeric' }).format(new Date()),
    );
  } catch {
    return new Date().getMonth() + 1;
  }
}

function misPersonKey(u: AppDashboardUser): string {
  const mail = String(u.email || '').trim().toLowerCase();
  if (mail.includes('@')) return `email:${mail}`;
  const parts = String(u.user_name || u.user_id || '').trim().toLowerCase()
    .replace(/\./g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  while (parts.length > 1 && parts[parts.length - 1].length === 1) parts.pop();
  const compact = parts.join('');
  return compact.length >= 3 ? `name:${compact}` : `raw:${compact}`;
}

function mergeDashboardUsers(rows: AppDashboardUser[]): AppDashboardUser[] {
  const map = new Map<string, AppDashboardUser>();
  for (const u of rows) {
    const key = misPersonKey(u);
    const open = Number(u.open ?? u.pending ?? 0);
    const closed = Number(u.closed ?? u.completed ?? 0);
    const rejected = Number(u.rejected ?? 0);
    const hit = map.get(key);
    if (!hit) {
      map.set(key, { ...u, open, closed, rejected, total: open + closed + rejected });
      continue;
    }
    hit.open = Number(hit.open ?? 0) + open;
    hit.closed = Number(hit.closed ?? 0) + closed;
    hit.rejected = Number(hit.rejected ?? 0) + rejected;
    hit.total = Number(hit.open) + Number(hit.closed) + Number(hit.rejected);
    const name = String(u.user_name || '').trim();
    if (name.length > String(hit.user_name || '').length) hit.user_name = name;
    if (u.email && !hit.email) hit.email = u.email;
    if (u.user_id && !hit.user_id) hit.user_id = u.user_id;
    if (u.last_sign_in && (!hit.last_sign_in || new Date(u.last_sign_in) > new Date(hit.last_sign_in))) {
      hit.last_sign_in = u.last_sign_in;
    }
    if (u.ever_logged_in) hit.ever_logged_in = true;
    if (u.is_active != null) hit.is_active = u.is_active;
    if (u.active_status) hit.active_status = u.active_status;
  }
  return [...map.values()].map((u) => ({
    ...u,
    user_name: normalizeItsmPersonLabel(u.user_name),
  }));
}

function userMatchesFilter(u: AppDashboardUser, userFilter: string): boolean {
  if (!userFilter || userFilter === 'all') return true;
  const sel = userFilter.toLowerCase();
  const id = String(u.user_id || u.user_name).toLowerCase();
  const name = String(u.user_name || '').trim().toLowerCase()
    .replace(/\./g, '').replace(/\s+/g, '').replace(/m$/, '');
  const selName = sel.replace(/\./g, '').replace(/\s+/g, '').replace(/m$/, '');
  return id === sel || name === selName || id.includes(sel) || sel.includes(id);
}

function sumUserKpis(users: AppDashboardUser[]) {
  let open = 0;
  let closed = 0;
  let rejected = 0;
  for (const u of users) {
    open += Number(u.open ?? u.pending ?? 0);
    closed += Number(u.closed ?? u.completed ?? 0);
    rejected += Number(u.rejected ?? 0);
  }
  return { total: open + closed + rejected, open, closed, rejected };
}

function sortByClosedDesc<T extends { open?: number; closed?: number; pending?: number; completed?: number; total?: number }>(
  rows: T[],
): T[] {
  return [...rows].sort((a, b) => {
    const ac = Number(a.closed ?? a.completed ?? 0);
    const bc = Number(b.closed ?? b.completed ?? 0);
    if (bc !== ac) return bc - ac;
    const ao = Number(a.open ?? a.pending ?? 0);
    const bo = Number(b.open ?? b.pending ?? 0);
    if (bo !== ao) return bo - ao;
    return Number(b.total || 0) - Number(a.total || 0);
  });
}

function sortByClosureRatio<T extends { open?: number; closed?: number; pending?: number; completed?: number; total?: number }>(
  rows: T[],
): T[] {
  return [...rows].sort((a, b) => {
    const ao = Number(a.open ?? a.pending ?? 0);
    const ac = Number(a.closed ?? a.completed ?? 0);
    const bo = Number(b.open ?? b.pending ?? 0);
    const bc = Number(b.closed ?? b.completed ?? 0);
    const ra = closureRatioPct(ao, ac);
    const rb = closureRatioPct(bo, bc);
    if (rb !== ra) return rb - ra;
    return Number(b.total || 0) - Number(a.total || 0);
  });
}

function formatWhen(value: string | null | undefined): string {
  return displayWhen(value);
}

function DashboardCard({
  title,
  children,
  className = '',
  right,
  embed = false,
}: {
  title: string;
  children: ReactNode;
  className?: string;
  right?: ReactNode;
  embed?: boolean;
}) {
  return (
    <div
      className={`flex h-full flex-col p-5 ${
        embed
          ? 'rounded-xl border border-slate-100 bg-white shadow-[0_4px_18px_rgba(112,144,176,0.12)]'
          : `rounded-2xl bg-white shadow-sm ${className}`
      } ${embed ? className : ''}`}
      style={embed ? undefined : { border: `1px solid ${CARD_BORDER}` }}
    >
      <div className="mb-4 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        {right}
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}

function KpiCard({
  label,
  value,
  sub,
  styleIndex = 0,
  delta,
  embed = false,
  active = false,
  onClick,
  appKind,
  iconContext,
}: {
  label: string;
  value: number;
  sub?: string;
  styleIndex?: number;
  delta?: number | null;
  embed?: boolean;
  active?: boolean;
  onClick?: () => void;
  appKind?: NeAppKind;
  iconContext?: string;
}) {
  if (embed) {
    return (
      <EmbedKpiCard
        label={label}
        value={value}
        sub={sub}
        styleIndex={styleIndex}
        appKind={appKind}
        iconContext={iconContext}
        active={active}
        onClick={onClick}
      />
    );
  }

  const style = KPI_STYLES[styleIndex % KPI_STYLES.length];
  const Icon = style.icon;
  const deltaText =
    delta == null || !Number.isFinite(delta)
      ? null
      : delta === 0
        ? '±0 vs compare'
        : `${delta > 0 ? '+' : ''}${delta.toLocaleString('en-IN')} vs compare`;
  return (
    <div
      className="relative min-w-0 overflow-hidden rounded-2xl p-5 shadow-[0_2px_8px_rgba(40,60,90,0.04)] ring-1 ring-[#E6EBF2]"
      style={{ background: style.bg }}
    >
      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11px] font-semibold uppercase tracking-wider" style={{ color: style.muted }}>
            {label}
          </p>
          <p className="mt-2 text-[28px] font-bold leading-none tracking-tight tabular-nums" style={{ color: style.text }}>
            {value.toLocaleString('en-IN')}
          </p>
          {sub ? (
            <p className="mt-2 text-sm font-semibold" style={{ color: style.muted }}>
              {sub}
            </p>
          ) : null}
          {deltaText ? (
            <p
              className="mt-1 text-[11px] font-medium"
              style={{ color: delta != null && delta < 0 ? '#B24E66' : '#287B5D' }}
            >
              {deltaText}
            </p>
          ) : null}
        </div>
        <div
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ring-1 ring-black/5"
          style={{ background: style.iconBg }}
        >
          <Icon className="h-5 w-5" style={{ color: style.iconColor }} />
        </div>
      </div>
    </div>
  );
}

type P2pDocRow = {
  key: string;
  title: string;
  short: 'PO' | 'PR';
  total: number;
  open: number;
  closed: number;
  rejected: number;
};

function p2pDocShort(row: { key: string; title: string }): 'PO' | 'PR' {
  const hay = `${row.key} ${row.title}`.toLowerCase();
  if (hay.includes('purchase_order') || hay.includes('purchase order') || /\bpo\b/.test(hay)) return 'PO';
  return 'PR';
}

function PmSection({
  title,
  hint,
  cards,
  appKind,
}: {
  title: string;
  hint?: string;
  cards: Array<{
    label: string;
    value: number;
    styleIndex: number;
    active?: boolean;
    onClick?: () => void;
  }>;
  appKind?: NeAppKind;
}) {
  return (
    <div className="space-y-2">
      <div>
        <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-slate-400 sm:text-[11px] sm:tracking-[0.14em]">{title}</p>
        {hint ? <p className="mt-0.5 text-[11px] text-slate-400">{hint}</p> : null}
      </div>
      <div className={NE_KPI_GRID_CLASS}>
        {cards.map((card) => (
          <KpiCard
            key={card.label}
            label={card.label}
            value={displayDashCount(card.value)}
            styleIndex={card.styleIndex}
            embed
            appKind={appKind}
            iconContext={title}
            active={card.active}
            onClick={card.onClick}
          />
        ))}
      </div>
    </div>
  );
}

export default function AppDashboardTab({ app, embed = false, refreshNonce = 0, onRefreshingChange }: Props) {
  const appId = resolveBackendApplicationId(app);
  const appKind = resolveNeAppKind(appId, app?.displayName || app?.name);
  const navigate = useNavigate();
  const { id: routeAppId } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const embedReturnTo = readEmbedReturnUrl(searchParams);
  const [entity, setEntity] = useState('all');
  const [company, setCompany] = useState('all');
  const [userFilter, setUserFilter] = useState('all');
  const [period, setPeriod] = useState<DatePresetId>('fy');
  const [calendarYear, setCalendarYear] = useState(() => currentIstYear());
  const [calendarMonth, setCalendarMonth] = useState(() => currentIstMonth());
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [kpiFocus, setKpiFocus] = useState<RecordKpiFocus | null>(null);
  const [recordsStatus, setRecordsStatus] = useState('all');
  const misSectionRef = useRef<HTMLDivElement>(null);
  const refreshGenRef = useRef(0);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<AppDashboardData | null>(null);
  const [recordInventory, setRecordInventory] = useState<AppRecordRow[]>([]);
  const [recordsColumns, setRecordsColumns] = useState<AppRecordColumn[]>([]);
  const [recordsDataSource, setRecordsDataSource] = useState<string | undefined>();
  const [fallbackAppUsers, setFallbackAppUsers] = useState<AppDashboardUser[]>([]);

  const resolvedDates = useMemo(
    () => resolveDateScope({ period, calendarYear, calendarMonth, dateFrom, dateTo }),
    [period, calendarYear, calendarMonth, dateFrom, dateTo],
  );

  const refresh = useCallback(
    async (forceRefresh = false) => {
      if (!isBackendApiMode() || !appId) {
        setError(!appId ? 'Missing application id' : 'Backend API mode is required');
        return;
      }

      const gen = ++refreshGenRef.current;
      const environment = (app.environment as 'production' | 'development') || 'production';

      if (forceRefresh) {
        setRefreshing(true);
        onRefreshingChange?.(true);
        setError('');
      }

      try {
        const baseKey = appDashboardQueryKey({
          environment,
          period: 'all',
        });
        const painted = readAppDashboardCache(appId, baseKey, { allowStale: true })
          ?? readAppDashboardCacheSoft(appId);
        if (painted) {
          setData(painted);
          setLoading(false);
        } else if (!forceRefresh) {
          setLoading(true);
        }

        const isSolarApp = isSolarApplicationId(appId);
        const isPmApp = /project_management|project_tracker/i.test(appId || '');
        const cachedPmEmpty = Boolean(
          isPmApp
          && painted
          && !(Number(painted?.portfolio?.tasks_total || 0) + Number(painted?.portfolio?.projects_total || 0)
            + Number(painted?.portfolio?.subtasks_total || 0)),
        );

        let result;
        try {
          result = await loadApplicationDashboard({
            applicationId: appId,
            environment,
            period: 'all',
            skipCache: Boolean(forceRefresh),
            preferCache: true,
          });
          if (forceRefresh && !isSolarApp) {
            void refreshApplicationDashboardLive({ applicationId: appId, environment }).catch(() => undefined);
          }
        } catch (firstErr) {
          if (isSolarApp) {
            if (painted) {
              result = { data: painted };
            } else {
              throw firstErr;
            }
          } else {
            result = await loadApplicationDashboard({
              applicationId: appId,
              environment,
              period: 'all',
              skipCache: true,
              preferCache: false,
            }).catch(() => {
              throw firstErr;
            });
          }
        }
        if (gen !== refreshGenRef.current) return;
        let base = result.data;
        const incomingPmEmpty = !Number(base?.portfolio?.tasks_total || 0)
          && !Number(base?.portfolio?.projects_total || 0)
          && !Number(base?.portfolio?.subtasks_total || 0);
        if (isPmApp && incomingPmEmpty && (!painted || cachedPmEmpty)) {
          const retry = await loadApplicationDashboard({
            applicationId: appId,
            environment,
            period: 'all',
            skipCache: true,
            preferCache: false,
          });
          if (gen !== refreshGenRef.current) return;
          if (retry.data) base = retry.data;
        }

        if (base) setData(base);
        setLoading(false);
        setRefreshing(false);
        onRefreshingChange?.(false);

        if (!base?.app_users?.length) {
          void loadApplicationAppUsers({ applicationId: appId, environment }).then((roster) => {
            if (gen !== refreshGenRef.current) return;
            setFallbackAppUsers(roster);
          });
        } else {
          setFallbackAppUsers([]);
        }
      } catch (err) {
        if (gen === refreshGenRef.current) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (gen === refreshGenRef.current) {
          setLoading(false);
          setRefreshing(false);
          onRefreshingChange?.(false);
        }
      }
    },
    [app, appId, onRefreshingChange],
  );

  const loadInventory = useCallback(
    async (forceRefresh = false) => {
      if (!isBackendApiMode() || !appId) return;
      const environment = (app.environment as 'production' | 'development') || 'production';
      const inv = await loadApplicationRecordInventory({
        applicationId: appId,
        environment,
        skipCache: forceRefresh && !isSolarApplicationId(appId),
        forceLive: false,
      });
      if (inv.ok) {
        setRecordInventory(inv.items);
        setRecordsColumns(inv.columns);
        setRecordsDataSource(inv.dataSource);
      }
    },
    [app, appId],
  );

  useEffect(() => {
    void refresh(false);
    void loadInventory(false);
  }, [appId]); // eslint-disable-line react-hooks/exhaustive-deps -- load dashboard + inventory once per app

  useEffect(() => {
    if (!refreshNonce) return;
    void refresh(true);
    void loadInventory(true);
  }, [refreshNonce]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setKpiFocus(null);
  }, [entity, company, userFilter, period, resolvedDates.from, resolvedDates.to]);

  const handleEntityChange = useCallback(
    (next: string) => {
      setEntity(next);
      setCompany('all');
      setUserFilter('all');
      setRecordsStatus('all');
      setKpiFocus(null);
    },
    [],
  );

  const handleCompanyChange = useCallback((next: string) => {
    setCompany(next);
    setUserFilter('all');
    setRecordsStatus('all');
    setKpiFocus(null);
  }, []);

  const clearFilters = useCallback(() => {
    setEntity('all');
    setCompany('all');
    setUserFilter('all');
    setPeriod('fy');
    setDateFrom('');
    setDateTo('');
    setRecordsStatus('all');
    setKpiFocus(null);
  }, []);

  const itsmCompanyMode = Boolean(
    data?.report_layout?.kind === 'itsm'
    || /itsm|service_management/i.test(appId || ''),
  );
  const travelMode = Boolean(
    data?.report_layout?.kind === 'travel'
    || /travel|expense_and_travel/i.test(appId || ''),
  );
  const hasInventory = recordInventory.length > 0;
  const dropdownFiltersActive = entity !== 'all' || company !== 'all' || userFilter !== 'all';
  const periodFiltersKpis = period !== 'all';
  const useClientKpis = hasInventory && (dropdownFiltersActive || periodFiltersKpis);
  const useClientInventory = hasInventory;
  const isPmLayout = data?.report_layout?.kind === 'pm'
    || /project_management|project_tracker/i.test(appId || '');
  const isP2pLayout = data?.report_layout?.kind === 'p2p'
    || /procurement|p2p/i.test(appId || '');

  const appRoster = useMemo(() => {
    const fromPayload = mergeDashboardUsers(data?.app_users || []);
    if (fromPayload.length) return fromPayload;
    const fromMgmt = mergeDashboardUsers(fallbackAppUsers);
    if (fromMgmt.length) return fromMgmt;
    // Do not fall back to data.users — that list is ticket activity (often Extrovis-only).
    return [];
  }, [data?.app_users, fallbackAppUsers]);

  const userRoster = useMemo(
    () => mergeDashboardUsers([...(appRoster || []), ...(data?.users || [])]),
    [appRoster, data?.users],
  );

  const stampedInventory = useMemo(
    () => stampRecordsWithAssigneeCompany(recordInventory, userRoster, { itsmCompanyMode }),
    [itsmCompanyMode, recordInventory, userRoster],
  );

  const assignedFilterName = useMemo(() => {
    if (userFilter === 'all') return undefined;
    const hit = userRoster.find((u) => {
      const id = String(u.user_id || '').trim();
      const name = String(u.user_name || '').trim();
      return userFilter === id
        || userFilter === name
        || compactMisName(name) === userFilter
        || compactMisName(name) === compactMisName(userFilter);
    });
    return hit?.user_name || userFilter;
  }, [userFilter, userRoster]);

  const assignedFilterId = useMemo(() => {
    if (userFilter === 'all') return undefined;
    const hit = userRoster.find((u) => {
      const id = String(u.user_id || '').trim();
      const name = String(u.user_name || '').trim();
      return userFilter === id
        || userFilter === name
        || compactMisName(name) === userFilter;
    });
    return hit?.user_id || (looksLikeKissflowUserId(userFilter) ? userFilter : undefined);
  }, [userFilter, userRoster]);

  const activityDates = period === 'daily';

  const periodScopedInventory = useMemo(() => {
    if (!stampedInventory.length) return [] as AppRecordRow[];
    return filterAppRecords(stampedInventory, {
      dateFrom: resolvedDates.from,
      dateTo: resolvedDates.to,
      itsmCompanyMode,
      travelMode,
      activityDates,
    });
  }, [activityDates, itsmCompanyMode, resolvedDates.from, resolvedDates.to, stampedInventory, travelMode]);

  const filterInventory = useMemo(() => {
    if (!periodScopedInventory.length) return [] as AppRecordRow[];
    return filterAppRecords(periodScopedInventory, {
      entity,
      itsmCompanyMode,
      travelMode,
    });
  }, [entity, itsmCompanyMode, periodScopedInventory, travelMode]);

  const scopeRecords = useMemo(() => {
    if (!useClientInventory) return [] as AppRecordRow[];
    return filterAppRecords(filterInventory, {
      company,
      itsmCompanyMode,
      travelMode,
    });
  }, [company, filterInventory, itsmCompanyMode, travelMode, useClientInventory]);

  const kpiRecords = useMemo(() => {
    if (!useClientInventory) return [] as AppRecordRow[];
    return filterAppRecords(scopeRecords, {
      assigned: assignedFilterName,
      assignedId: assignedFilterId,
      itsmCompanyMode,
    });
  }, [
    assignedFilterId,
    assignedFilterName,
    itsmCompanyMode,
    scopeRecords,
    useClientInventory,
  ]);

  const todayKind = kpiFocus === 'opened_today' ? 'opened' : kpiFocus === 'closed_today' ? 'closed' : undefined;

  const scopedRecords = useMemo(() => {
    if (!useClientInventory) return [] as AppRecordRow[];
    if (recordsStatus === 'all' && !todayKind) return kpiRecords;
    return filterAppRecords(kpiRecords, {
      status: recordsStatus,
      todayKind,
    });
  }, [kpiRecords, recordsStatus, todayKind, useClientInventory]);

  const misOwnerMode = isP2pLayout ? 'assignee_or_requester' as const : 'assignee' as const;

  const identityAssignees = useMemo(() => {
    if (!itsmCompanyMode || !stampedInventory.length) return [] as AppDashboardUser[];
    return buildMisUsersFromRecords(stampedInventory, userRoster, { ownerMode: misOwnerMode });
  }, [itsmCompanyMode, misOwnerMode, stampedInventory, userRoster]);

  const identityRoster = useMemo(
    () => (itsmCompanyMode ? unionRosterWithTicketUsers(appRoster, identityAssignees) : appRoster),
    [appRoster, identityAssignees, itsmCompanyMode],
  );

  const clientMisUsers = useMemo(() => {
    if (!useClientInventory) {
      return sortByClosedDesc(mergeRosterWithTicketCounts(identityRoster, data?.users || []));
    }
    const ticketUsers = buildMisUsersFromRecords(scopedRecords, userRoster, { ownerMode: misOwnerMode });
    // Entity / Company / User filters: MIS must mirror scoped tickets — not the full APP_ROLE
    // roster with zeros, and not drop assignees who are outside the roster.
    if (dropdownFiltersActive) {
      const scoped = ticketUsers.filter((u) => Number(u.total || 0) > 0);
      return sortByClosedDesc(overlayRosterSignIn(scoped, userRoster));
    }
    const merged = mergeRosterWithTicketCounts(identityRoster, ticketUsers);
    const focused = Boolean(kpiFocus && kpiFocus !== 'total');
    const rows = focused
      ? merged.filter((u) => Number(u.total || 0) > 0)
      : merged;
    return sortByClosedDesc(overlayRosterSignIn(rows, userRoster));
  }, [
    data?.users,
    dropdownFiltersActive,
    identityRoster,
    kpiFocus,
    misOwnerMode,
    scopedRecords,
    useClientInventory,
    userRoster,
  ]);

  const workUsers = useMemo(
    () => overlayRosterSignIn(identityRoster, userRoster),
    [identityRoster, userRoster],
  );

  const userFilterOptions = useMemo(() => {
    // Entity/Company/Period may narrow the list. Never rebuild from the User-filtered
    // set — that dropped the selected id and the native <select> snapped back to All.
    const scopedUsers = (entity !== 'all' || company !== 'all')
      ? buildMisUsersFromRecords(scopeRecords, userRoster, { ownerMode: misOwnerMode })
        .filter((u) => Number(u.total || 0) > 0)
      : workUsers;
    const options = scopedUsers
      .filter((u) => {
        const name = String(u.user_name || '').trim();
        return isUsableUserFilterLabel(name, u.user_id);
      })
      .map((u) => ({
        id: String(u.user_id || '').trim() || compactMisName(u.user_name) || String(u.user_name),
        label: u.user_name || String(u.user_id),
        email: String(u.email || '').trim().toLowerCase(),
      }));
    const deduped = new Map<string, { id: string; label: string }>();
    for (const o of options) {
      const key = o.email.includes('@')
        ? `email:${o.email}`
        : (o.id ? `id:${o.id.toLowerCase()}` : `name:${o.label.trim().toLowerCase()}`);
      if (!deduped.has(key)) deduped.set(key, { id: o.id, label: o.label });
    }
    const unique = [...deduped.values()];
    return ensureFilterOption(
      [
        { id: 'all', label: unique.length ? `All Users (${unique.length})` : 'All Users' },
        ...unique,
      ],
      userFilter,
      assignedFilterName,
    );
  }, [assignedFilterName, company, entity, misOwnerMode, scopeRecords, userFilter, userRoster, workUsers]);

  useEffect(() => {
    if (userFilter === 'all') return;
    const valid = userFilterOptions.some((o) => filterOptionMatches(o, userFilter));
    if (!valid) setUserFilter('all');
  }, [userFilter, userFilterOptions]);

  const displayedMisUsers = useMemo(() => {
    let rows = clientMisUsers;
    if (userFilter !== 'all') rows = rows.filter((u) => userMatchesFilter(u, userFilter));
    return rows;
  }, [clientMisUsers, userFilter]);

  const entityOptions = useMemo(() => {
    // Always keep Refex/Extrovis (or Venwind) in the list, even at count 0, so the
    // native select cannot snap back to All when a period has no rows for one entity.
    const source = periodScopedInventory.length ? periodScopedInventory : recordInventory;
    const mode = travelMode ? 'refex_venwind' : itsmCompanyMode ? 'refex_extrovis' : 'all_buckets';
    const rows = entityCountsFromRecords(source, { itsmCompanyMode, travelMode });
    const counts: Record<string, number> = {};
    for (const r of rows) counts[r.id] = r.count;
    return ensureFilterOption(
      buildEntityBucketOptions(counts, { mode, allLabel: 'All entities' }),
      entity,
    );
  }, [entity, itsmCompanyMode, periodScopedInventory, recordInventory, travelMode]);

  const companyOptions = useMemo(() => {
    const source = filterInventory.length ? filterInventory : stampedInventory;
    const rows = companyCountsFromRecords(source, { itsmCompanyMode, entity });
    if (itsmCompanyMode) {
      const counts: Record<string, number> = {};
      for (const r of rows) counts[r.id] = r.count;
      const catalog = buildRefexCompanyOptions(counts, {
        includeAll: true,
        allLabel: 'All companies',
        entity,
      });
      const extras = rows.filter(
        (r) => String(r.id).startsWith('raw:') && !catalog.some((c) => c.id === r.id),
      );
      return sortCompanyFilterOptions(ensureFilterOption([...catalog, ...extras], company));
    }
    return sortCompanyFilterOptions(ensureFilterOption(
      [{ id: 'all', label: 'All companies' }, ...rows.map((r) => ({ id: r.id, label: r.label }))],
      company,
    ));
  }, [company, entity, filterInventory, itsmCompanyMode, stampedInventory]);

  const openVal = Number(data?.metrics.open ?? data?.metrics.pending ?? 0);
  const closedVal = Number(data?.metrics.closed ?? data?.metrics.completed ?? 0);
  const rejectedVal = Number(data?.metrics.rejected || 0);

  const clientKpis = useMemo(() => {
    if (useClientKpis) return summarizeAppRecords(kpiRecords);
    if (userFilter !== 'all' && displayedMisUsers.length) return sumUserKpis(displayedMisUsers);
    return { total: Number(data?.metrics.total ?? 0), open: openVal, closed: closedVal, rejected: rejectedVal };
  }, [closedVal, data?.metrics.total, displayedMisUsers, kpiRecords, openVal, rejectedVal, useClientKpis, userFilter]);

  const kpiTotal = clientKpis.total;
  const kpiOpen = clientKpis.open;
  const kpiClosed = clientKpis.closed;
  const kpiRejected = clientKpis.rejected;

  const showCompanyFilter = !itsmCompanyMode || entity === 'refex' || entity === 'all';
  // Extrovis entity has no legal-entity companies in the 29-list — hide Company until Refex/All.

  const adoptionOverall = Number(data?.metrics.sign_in_rate_overall ?? data?.metrics.user_adoption_pct ?? 0);
  const adoptionToday = Number(data?.metrics.sign_in_rate_today || 0);
  const usersCardCount = workUsers.length || Number(data?.metrics.total_users || 0);

  const p2pDocRows = useMemo((): P2pDocRow[] => {
    if (!isP2pLayout) return [];
    if (useClientKpis && kpiRecords.length) {
      const buckets: Record<'PO' | 'PR', P2pDocRow> = {
        PO: { key: 'purchase_orders', title: 'Purchase Order', short: 'PO', total: 0, open: 0, closed: 0, rejected: 0 },
        PR: { key: 'purchase_requests', title: 'Purchase Requisition', short: 'PR', total: 0, open: 0, closed: 0, rejected: 0 },
      };
      for (const r of kpiRecords) {
        const short = p2pDocShort({ key: String(r.process_id || ''), title: String(r.subject || '') });
        const b = buckets[short];
        b.total += 1;
        const s = String(r.status || '').toLowerCase();
        if (s === 'closed') b.closed += 1;
        else if (s === 'rejected') b.rejected += 1;
        else b.open += 1;
      }
      return [buckets.PO, buckets.PR];
    }
    const rows = (data?.by_process || []).map((row) => {
      const key = String(row.process_id || row.process_name || row.process_label);
      const title = String(row.process_label || row.process_name || row.process_id);
      return {
        key,
        title,
        short: p2pDocShort({ key, title }),
        total: displayDashCount(row.total),
        open: displayDashCount(row.open_count ?? row.pending),
        closed: displayDashCount(row.closed ?? row.completed),
        rejected: displayDashCount(row.rejected),
      };
    });
    if (!rows.length) {
      return [
        { key: 'purchase_orders', title: 'Purchase Order', short: 'PO' as const, total: 0, open: 0, closed: 0, rejected: 0 },
        { key: 'purchase_requests', title: 'Purchase Requisition', short: 'PR' as const, total: 0, open: 0, closed: 0, rejected: 0 },
      ];
    }
    return [...rows].sort((a, b) => Number(a.short === 'PR') - Number(b.short === 'PR'));
  }, [data?.by_process, isP2pLayout, kpiRecords, useClientKpis]);

  const handleKpiClick = useCallback((focus: RecordKpiFocus) => {
    setKpiFocus((prev) => {
      const next = prev === focus ? null : focus;
      if (!next || next === 'total' || next === 'opened_today' || next === 'closed_today') {
        setRecordsStatus('all');
      } else {
        setRecordsStatus(next);
      }
      return next;
    });
    window.requestAnimationFrame(() => {
      misSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, []);

  const kpiLabels = data?.report_layout?.kpi_labels;
  const totalLabel = kpiLabels?.total || 'Total items';
  const openLabel = kpiLabels?.open || 'Open';
  const closedLabel = kpiLabels?.closed || 'Closed';
  const rejectedLabel = kpiLabels?.rejected || 'Rejected';
  const todayActivity = useMemo(
    () => countTodayActivity(useClientInventory ? kpiRecords : recordInventory, istTodayYmd()),
    [kpiRecords, recordInventory, useClientInventory],
  );
  const pmPortfolio = useMemo(() => {
    if (!isPmLayout) return data?.portfolio;
    const api = data?.portfolio;
    if (!useClientKpis) return api;
    const counted = countPmPortfolio(kpiRecords);
    const countedSpan = counted.tasks_total + counted.subtasks_total;
    if (countedSpan > 0) return counted;
    return api;
  }, [data?.portfolio, isPmLayout, kpiRecords, useClientKpis]);

  if (!isBackendApiMode()) {
    return (
      <div className="surface p-6 text-sm text-foreground-600">
        Switch to backend API mode to load the live application dashboard.
      </div>
    );
  }

  const showEntityFilter = true;
  const showCompanyDropdown = showCompanyFilter && entity !== 'extrovis';

  const filterBar = (
    <ExecutiveDateFilterBar
      period={period}
      onPeriodChange={setPeriod}
      calendarYear={calendarYear}
      onCalendarYearChange={setCalendarYear}
      calendarMonth={calendarMonth}
      onCalendarMonthChange={setCalendarMonth}
      dateFrom={dateFrom}
      dateTo={dateTo}
      onDateFromChange={setDateFrom}
      onDateToChange={setDateTo}
      entity={entity}
      onEntityChange={showEntityFilter ? handleEntityChange : undefined}
      entityOptions={showEntityFilter ? entityOptions : undefined}
      entityLabel="Entity"
      company={company}
      onCompanyChange={showCompanyDropdown ? handleCompanyChange : undefined}
      companyOptions={showCompanyDropdown ? companyOptions : undefined}
      companyLabel="Company"
      user={userFilter}
      onUserChange={setUserFilter}
      userOptions={userFilterOptions}
      onClearFilters={clearFilters}
      embedLayout
      refreshing={refreshing}
      hideHints
    />
  );

  const embedHeroActions = (
    <>
      <button
        type="button"
        onClick={() => navigate(buildEmbedDashboardPath(routeAppId || app.id, embedReturnTo, searchParams), { replace: true })}
        className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#EAF2FF] px-3 text-xs font-semibold text-[#3977BE] ring-1 ring-[#D0E0F5] hover:bg-[#DCE8FA]"
      >
        <LayoutDashboard className="h-3.5 w-3.5" />
        Full Engagement report
      </button>
      <button
        type="button"
        onClick={() => void refresh(true)}
        disabled={refreshing}
        className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[#D0E0F5] bg-white px-3 text-xs font-semibold text-[#3977BE] hover:bg-[#F8FBFF] disabled:opacity-60"
      >
        <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
        Refresh dashboard
      </button>
    </>
  );

  return (
    <div className="relative rounded-3xl p-1">
      <DashboardLoadingOverlay
        show={(loading && !data) || (refreshing && !(isSolarApplicationId(appId) && data))}
        mode="fixed"
        label={refreshing ? 'Updating dashboard…' : 'Loading dashboard…'}
      />
      <div className="space-y-4">
        <EmbedDashboardHero
          actions={
            embed ? (
              embedHeroActions
            ) : (
              <button
                type="button"
                onClick={() => void refresh(true)}
                disabled={refreshing}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[#D0E0F5] bg-white px-3 text-xs font-semibold text-[#3977BE] hover:bg-[#F8FBFF] disabled:opacity-60"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
                Refresh dashboard
              </button>
            )
          }
          filters={filterBar}
        />

        {error && (
          <div className="flex gap-2 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <div className="font-semibold">Dashboard failed to load</div>
              <div className="mt-0.5">{error}</div>
            </div>
          </div>
        )}

        {data && (
          <>
            {isPmLayout ? (
              <div className="space-y-5">
                <PmSection
                  appKind={appKind}
                  title="Today's task activity"
                  cards={[
                    {
                      label: 'Opened today',
                      value: todayActivity.opened,
                      styleIndex: 0,
                      active: kpiFocus === 'opened_today',
                      onClick: () => handleKpiClick('opened_today'),
                    },
                    {
                      label: 'Closed today',
                      value: todayActivity.closed,
                      styleIndex: 2,
                      active: kpiFocus === 'closed_today',
                      onClick: () => handleKpiClick('closed_today'),
                    },
                  ]}
                />
                <PmSection
                  appKind={appKind}
                  title="Projects"
                  hint="In Progress = at least one pending task · Completed = all linked tasks done"
                  cards={[
                    { label: 'Total projects', value: displayDashCount(pmPortfolio?.projects_total), styleIndex: 0 },
                    { label: 'In progress', value: displayDashCount(pmPortfolio?.projects_open), styleIndex: 1 },
                    { label: 'Completed projects', value: displayDashCount(pmPortfolio?.projects_closed), styleIndex: 2 },
                  ]}
                />
                <PmSection
                  appKind={appKind}
                  title="All tasks"
                  hint="Every task on Project Task process (linked to a project or not)"
                  cards={[
                    { label: 'Total tasks', value: displayDashCount(pmPortfolio?.tasks_total), styleIndex: 0 },
                    { label: 'In progress', value: displayDashCount(pmPortfolio?.tasks_open), styleIndex: 1 },
                    { label: 'Completed', value: displayDashCount(pmPortfolio?.tasks_closed), styleIndex: 2 },
                  ]}
                />
                <PmSection
                  appKind={appKind}
                  title="Individual tasks"
                  hint="Tasks with no linked Project ID — stand-alone work"
                  cards={[
                    { label: 'Total individual', value: displayDashCount(pmPortfolio?.individual_total), styleIndex: 0 },
                    { label: 'In progress', value: displayDashCount(pmPortfolio?.individual_open), styleIndex: 1 },
                    { label: 'Completed', value: displayDashCount(pmPortfolio?.individual_closed), styleIndex: 2 },
                  ]}
                />
                <PmSection
                  appKind={appKind}
                  title="Sub-tasks"
                  hint="Child work under a parent task (Sub Task process)"
                  cards={[
                    { label: 'Total sub-tasks', value: displayDashCount(pmPortfolio?.subtasks_total), styleIndex: 0 },
                    { label: 'In progress', value: displayDashCount(pmPortfolio?.subtasks_open), styleIndex: 1 },
                    { label: 'Completed', value: displayDashCount(pmPortfolio?.subtasks_closed), styleIndex: 2 },
                  ]}
                />
              </div>
            ) : isP2pLayout ? (
              <div className="space-y-5">
                <PmSection
                  appKind={appKind}
                  title="Today"
                  cards={[
                    {
                      label: 'Opened today',
                      value: todayActivity.opened,
                      styleIndex: 0,
                      active: kpiFocus === 'opened_today',
                      onClick: () => handleKpiClick('opened_today'),
                    },
                    {
                      label: 'Closed today',
                      value: todayActivity.closed,
                      styleIndex: 2,
                      active: kpiFocus === 'closed_today',
                      onClick: () => handleKpiClick('closed_today'),
                    },
                  ]}
                />
                {p2pDocRows.map((row) => (
                  <PmSection
                    appKind={appKind}
                    key={row.key}
                    title={row.short === 'PO' ? 'Purchase orders' : 'Purchase requisitions'}
                    hint={row.short === 'PO' ? 'Approved and in-flight purchase orders' : 'Purchase requisitions waiting or completed'}
                    cards={[
                      { label: `Total ${row.short}s`, value: row.total, styleIndex: 0 },
                      {
                        label: `Open ${row.short}s`,
                        value: row.open,
                        styleIndex: 1,
                        active: kpiFocus === 'open',
                        onClick: () => handleKpiClick('open'),
                      },
                      {
                        label: `Closed ${row.short}s`,
                        value: row.closed,
                        styleIndex: 2,
                        active: kpiFocus === 'closed',
                        onClick: () => handleKpiClick('closed'),
                      },
                      {
                        label: `Rejected ${row.short}s`,
                        value: row.rejected,
                        styleIndex: 3,
                        active: kpiFocus === 'rejected',
                        onClick: () => handleKpiClick('rejected'),
                      },
                    ]}
                  />
                ))}
              </div>
            ) : (
              <div className={NE_KPI_GRID_CLASS}>
                <KpiCard
                  label={totalLabel}
                  value={displayDashCount(kpiTotal)}
                  styleIndex={0}
                  embed
                  appKind={appKind}
                  active={kpiFocus === 'total'}
                  onClick={() => handleKpiClick('total')}
                />
                <KpiCard
                  label={openLabel}
                  value={displayDashCount(kpiOpen)}
                  styleIndex={1}
                  embed
                  appKind={appKind}
                  active={kpiFocus === 'open'}
                  onClick={() => handleKpiClick('open')}
                />
                <KpiCard
                  label={closedLabel}
                  value={displayDashCount(kpiClosed)}
                  styleIndex={2}
                  embed
                  appKind={appKind}
                  active={kpiFocus === 'closed'}
                  onClick={() => handleKpiClick('closed')}
                />
                <KpiCard
                  label={rejectedLabel}
                  value={displayDashCount(kpiRejected)}
                  styleIndex={3}
                  embed
                  appKind={appKind}
                  active={kpiFocus === 'rejected'}
                  onClick={() => handleKpiClick('rejected')}
                />
                <KpiCard
                  label="Opened today"
                  value={displayDashCount(todayActivity.opened)}
                  styleIndex={0}
                  embed
                  appKind={appKind}
                  active={kpiFocus === 'opened_today'}
                  onClick={() => handleKpiClick('opened_today')}
                />
                <KpiCard
                  label="Closed today"
                  value={displayDashCount(todayActivity.closed)}
                  styleIndex={2}
                  embed
                  appKind={appKind}
                  active={kpiFocus === 'closed_today'}
                  onClick={() => handleKpiClick('closed_today')}
                />
              </div>
            )}

            <div className={NE_KPI_GRID_CLASS}>
              {!isP2pLayout ? (
                <EmbedKpiCard
                  label="Adoption · overall"
                  value={adoptionOverall}
                  suffix="%"
                  sub="Ever signed in ÷ app users"
                  themes={[EMBED_ADOPTION_THEME]}
                  styleIndex={0}
                />
              ) : (
                <div className="overflow-hidden rounded-xl border border-slate-100 bg-white p-5 shadow-[0_4px_18px_rgba(112,144,176,0.12)]">
                  <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    <Percent className="h-3.5 w-3.5" />
                    Users · P2P app
                  </div>
                  <p className="mt-2 text-[28px] font-bold tabular-nums leading-none text-slate-900">
                    {usersCardCount.toLocaleString('en-IN')}
                  </p>
                </div>
              )}
              <div className="rounded-xl border border-slate-100 bg-white p-5 shadow-[0_4px_18px_rgba(112,144,176,0.12)]">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  <Users className="h-3.5 w-3.5 text-sky-600" />
                  Users
                </div>
                <div className="mt-1 text-[28px] font-bold tabular-nums leading-none text-slate-900">
                  {usersCardCount.toLocaleString('en-IN')}
                </div>
              </div>
              <div className="rounded-xl border border-slate-100 bg-white p-5 shadow-[0_4px_18px_rgba(112,144,176,0.12)]">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  <UserCheck className="h-3.5 w-3.5 text-emerald-600" />
                  Signed in today
                </div>
                <div className="mt-1 text-[28px] font-bold tabular-nums leading-none text-slate-900">
                  {Number(data.metrics.signed_in_today || 0).toLocaleString('en-IN')}
                </div>
              </div>
              <div className="rounded-xl border border-slate-100 bg-white p-5 shadow-[0_4px_18px_rgba(112,144,176,0.12)]">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  <Sparkles className="h-3.5 w-3.5 text-violet-600" />
                  Adoption today
                </div>
                <div className="mt-1 text-[28px] font-bold tabular-nums leading-none text-slate-900">
                  {adoptionToday}%
                </div>
              </div>
            </div>

            <div ref={misSectionRef}>
            <DashboardCard
              embed
              title={isP2pLayout ? 'MIS · P2P users (requesters / PO creators)' : 'MIS · Users'}
              right={
                <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                  <Users className="h-3.5 w-3.5" />
                  {displayedMisUsers.length}
                  <span className="ml-2 font-normal text-slate-400">v{DASHBOARD_VERSION}</span>
                </span>
              }
            >
              <div className="space-y-2.5 px-1 pb-3 lg:hidden">
                {displayedMisUsers.map((user, index) => {
                  const open = Number(user.open ?? user.pending ?? 0);
                  const closed = Number(user.closed ?? user.completed ?? 0);
                  const rejected = Number(user.rejected || 0);
                  const login = misUserLoginDisplay(user, formatWhen);
                  const rowKey = `${compactMisName(user.user_name) || user.user_id || user.user_name}-${index}`;
                  return (
                    <MisMobileRecordCard
                      key={rowKey}
                      title={user.user_name}
                      subtitle={login.text === '-' ? 'Last sign-in —' : `Last sign-in ${login.text}`}
                      fields={[
                        { label: 'Open', value: open },
                        { label: 'Closed', value: closed },
                        { label: 'Rejected', value: rejected },
                        { label: 'Total', value: user.total || open + closed + rejected },
                        { label: 'Closure %', value: `${closureRatioPct(open, closed)}%` },
                      ]}
                    />
                  );
                })}
                {displayedMisUsers.length === 0 ? (
                  <p className="py-8 text-center text-sm text-slate-400">
                    No users for this filter. Try All entities or This FY.
                  </p>
                ) : null}
              </div>
              <div className="-mx-5 -mb-5 hidden overflow-x-auto lg:block">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-5 py-2.5 font-semibold">User</th>
                      <th className="px-5 py-2.5 font-semibold">Last sign-in</th>
                      <th className="px-5 py-2.5 text-right font-semibold">Open</th>
                      <th className="px-5 py-2.5 text-right font-semibold">Closed</th>
                      <th className="px-5 py-2.5 text-right font-semibold">Rejected</th>
                      <th className="px-5 py-2.5 text-right font-semibold">Total</th>
                      <th className="px-5 py-2.5 text-right font-semibold">Closure %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayedMisUsers.map((user, index) => {
                      const open = Number(user.open ?? user.pending ?? 0);
                      const closed = Number(user.closed ?? user.completed ?? 0);
                      const rejected = Number(user.rejected || 0);
                      const login = misUserLoginDisplay(user, formatWhen);
                      const rowKey = `${compactMisName(user.user_name) || user.user_id || user.user_name}-${index}`;
                      return (
                        <tr key={rowKey} className="border-t border-slate-100">
                          <td className="px-5 py-2.5 font-medium text-slate-900">{user.user_name}</td>
                          <td className="px-5 py-2.5 text-sm tabular-nums text-slate-600">
                            {login.text === '-' ? (
                              <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600 ring-1 ring-slate-200">
                                {login.text}
                              </span>
                            ) : (
                              <span className={login.signedToday ? 'font-semibold text-[#287B5D]' : undefined}>
                                {login.text}
                              </span>
                            )}
                          </td>
                          <td className="px-5 py-2.5 text-right font-semibold tabular-nums text-[#A96A20]">{open}</td>
                          <td className="px-5 py-2.5 text-right font-semibold tabular-nums text-[#287B5D]">{closed}</td>
                          <td className="px-5 py-2.5 text-right font-semibold tabular-nums text-[#B24E66]">{rejected}</td>
                          <td className="px-5 py-2.5 text-right tabular-nums">{user.total || open + closed + rejected}</td>
                          <td className="px-5 py-2.5 text-right font-semibold tabular-nums text-slate-700">
                            {closureRatioPct(open, closed)}%
                          </td>
                        </tr>
                      );
                    })}
                    {displayedMisUsers.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-5 py-8 text-center text-sm text-slate-400">
                          No users for this filter. Try All entities or This FY.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </DashboardCard>
            </div>

            <EmbedAppRecordsTable
              inventory={stampedInventory.length ? stampedInventory : recordInventory}
              columns={
                isP2pLayout
                  ? recordsColumns.filter((col) => col.id !== 'amount')
                  : recordsColumns
              }
              dataSource={recordsDataSource}
              entity={entity}
              company={company}
              status={recordsStatus}
              assigned={assignedFilterName}
              assignedId={assignedFilterId}
              dateFrom={resolvedDates.from || undefined}
              dateTo={resolvedDates.to || undefined}
              todayKind={todayKind}
              itsmCompanyMode={itsmCompanyMode}
              travelMode={travelMode}
              activityDates={activityDates}
              filterAnimating={false}
            />
          </>
        )}
      </div>
    </div>
  );
}
