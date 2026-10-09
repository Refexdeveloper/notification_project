import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import EmbedDashboardHero from '@/components/feature/EmbedDashboardHero';
import EmbedKpiCard, { EMBED_ADOPTION_THEME, EMBED_KPI_THEMES, neKpiBalancedGridClass, neKpiSectionGridClass } from '@/components/feature/EmbedKpiCard';
import NeFinanceProcessCard from '@/components/feature/NeFinanceProcessCard';
import ItsmSourceBreakdown from '@/components/feature/ItsmSourceBreakdown';
import { resolveNeAppKind, type NeAppKind } from '@/lib/neKpiIcons';
import { NE_DASH_CLASS, NE_TYPE } from '@/lib/neDashType';
import EmbedAppRecordsTable from '@/components/feature/EmbedAppRecordsTable';
import { MisMobileRecordCard } from '@/components/feature/MisMobileCards';
import { buildEmbedDashboardPath, readEmbedReturnUrl } from '@/lib/embedMode';
import { LayoutDashboard, Plane, Receipt, RefreshCw, Wallet } from 'lucide-react';
import {
  AlertCircle,
  ChevronDown,
  Loader2,
  Sparkles,
  Users,
  UserCheck,
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
  websiteCountsFromRecords,
  countPmPortfolio,
  countTodayActivity,
  entityCountsFromRecords,
  filterAppRecords,
  ensureFilterOption,
  filterOptionMatches,
  mergeUserFilterOptions,
  isUsableUserFilterLabel,
  mergeRosterWithTicketCounts,
  misEligibleUsers,
  overlayRosterSignIn,
  unionRosterWithTicketUsers,
  stampRecordsWithAssigneeCompany,
  summarizeAppRecords,
  type RecordKpiFocus,
} from '@/lib/appDashboardClientFilter';
import { ITSM_CEO_RECORD_COLUMNS } from '@/lib/itsmRecordDisplay';
import { EMS_DASH_COLUMNS } from '@/lib/emsRecordDisplay';
import { travelColumnsForPack, type TravelPackKind } from '@/lib/travelRecordDisplay';
import { DASHBOARD_VERSION } from '@/lib/dashboardVersion';
import { itsmSourceFromFilteredRecords, recordsHaveSource } from '@/lib/itsmSourceBreakdown';
import { displayDashCount, displayWhen } from '@/lib/dashboardEmpty';
import { compactMisName, looksLikeKissflowUserId, normalizeItsmPersonLabel, personDedupeKey } from '@/lib/personName';
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

function formatMisUserName(user: {
  user_name?: string | null;
  is_active?: boolean;
  active_status?: string | null;
}): string {
  const name = String(user.user_name || '').trim() || 'Unknown';
  const status = String(user.active_status || '').toLowerCase();
  const inactive = user.is_active === false || status === 'inactive' || status.includes('inactive');
  return inactive ? `${name} (InActive)` : name;
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
  const have = personDedupeKey(u.user_name);
  const want = personDedupeKey(userFilter);
  if (have && want && (have === want || have.includes(want) || want.includes(have))) return true;
  return id === sel || id.includes(sel) || sel.includes(id);
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
  collapsible = false,
  open = true,
  onToggle,
}: {
  title: string;
  children: ReactNode;
  className?: string;
  right?: ReactNode;
  embed?: boolean;
  collapsible?: boolean;
  open?: boolean;
  onToggle?: () => void;
}) {
  return (
    <div
      className={`flex flex-col p-5 ${
        embed
          ? 'rounded-xl border border-slate-100 bg-white shadow-[0_4px_18px_rgba(112,144,176,0.12)]'
          : `rounded-2xl bg-white shadow-sm ${className}`
      } ${embed ? className : ''}`}
      style={embed ? undefined : { border: `1px solid ${CARD_BORDER}` }}
    >
      <div className={`flex items-center justify-between gap-2 ${open ? 'mb-4' : ''}`}>
        {collapsible ? (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            className="flex min-w-0 flex-1 items-center justify-between gap-2 text-left"
          >
            <h3 className={NE_TYPE.sectionTitle}>{title}</h3>
            <span className="flex shrink-0 items-center gap-2">
              {right}
              <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
            </span>
          </button>
        ) : (
          <>
            <h3 className={NE_TYPE.sectionTitle}>{title}</h3>
            {right}
          </>
        )}
      </div>
      {open ? <div className="min-h-0 flex-1">{children}</div> : null}
    </div>
  );
}

function KpiCard({
  label,
  value,
  sub,
  styleIndex = 0,
  active = false,
  onClick,
  appKind,
  iconContext,
  valueFormat = 'count',
}: {
  label: string;
  value: number;
  sub?: string;
  styleIndex?: number;
  embed?: boolean;
  active?: boolean;
  onClick?: () => void;
  appKind?: NeAppKind;
  iconContext?: string;
  valueFormat?: 'count' | 'inr';
}) {
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
      valueFormat={valueFormat}
    />
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

function sumRecordAmount(rows: Array<{ amount?: number | null; status?: string }>, status?: string) {
  return rows.reduce((sum, row) => {
    if (status && String(row.status || '').toLowerCase() !== status) return sum;
    const n = Number(row.amount);
    return sum + (Number.isFinite(n) ? n : 0);
  }, 0);
}

function sumRecordField(rows: Array<Record<string, unknown>>, key: string, fallbackKey?: string) {
  return rows.reduce((sum, row) => {
    const n = Number(row[key]);
    if (Number.isFinite(n) && n > 0) return sum + n;
    if (!fallbackKey) return sum;
    const fallback = Number(row[fallbackKey]);
    return sum + (Number.isFinite(fallback) ? fallback : 0);
  }, 0);
}

const EMS_CLAIM_TYPES = [
  { key: 'conveyance', label: 'Local Conveyance', hint: 'Local travel within city', match: /convey|local travel|transport/i },
] as const;

type TravelPackMetric = 'total' | 'open' | 'closed' | 'amount';

const TRAVEL_PROCESS_SECTIONS = [
  { kind: 'booking' as const, title: 'Travel Booking', match: /travel_management|travel booking|travel request/i, icon: Plane, styleIndex: 0 },
  { kind: 'advance' as const, title: 'Travel Advance', match: /advance_payment|travel advance/i, icon: Wallet, styleIndex: 1 },
  { kind: 'expense' as const, title: 'Travel Expense', match: /expense_management|amount claimed|travel expense|expense/i, icon: Receipt, styleIndex: 2 },
];

function claimsSub(count: number) {
  const n = displayDashCount(count);
  return `${n.toLocaleString('en-IN')} ${n === 1 ? 'claim' : 'claims'}`;
}

function requestsSub(count: number) {
  const n = displayDashCount(count);
  return `${n.toLocaleString('en-IN')} ${n === 1 ? 'request' : 'requests'}`;
}

function countByStatus(rows: Array<{ status?: string }>, status: string) {
  return rows.filter((row) => String(row.status || '').toLowerCase() === status).length;
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
    valueFormat?: 'count' | 'inr';
    sub?: string;
  }>;
  appKind?: NeAppKind;
}) {
  return (
    <div className="space-y-2">
      <div>
        <p className={NE_TYPE.sectionTitle}>{title}</p>
        {hint ? <p className={`mt-0.5 ${NE_TYPE.meta}`}>{hint}</p> : null}
      </div>
      <div className={neKpiSectionGridClass(cards.length)}>
        {cards.map((card) => (
          <KpiCard
            key={card.label}
            label={card.label}
            value={displayDashCount(card.value)}
            sub={card.sub}
            styleIndex={card.styleIndex}
            embed
            appKind={appKind}
            iconContext={title}
            active={card.active}
            onClick={card.onClick}
            valueFormat={card.valueFormat}
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
  const [claimTypeFocus, setClaimTypeFocus] = useState<string | null>(null);
  const [travelPackFocus, setTravelPackFocus] = useState<{ key: TravelPackKind; metric: TravelPackMetric } | null>(null);
  const [recordsStatus, setRecordsStatus] = useState('all');
  const [misScopedRecords, setMisScopedRecords] = useState<AppRecordRow[] | null>(null);
  const [sourceScopedRecords, setSourceScopedRecords] = useState<AppRecordRow[] | null>(null);
  const [userPage, setUserPage] = useState(0);
  const [usersOpen, setUsersOpen] = useState(false);
  const misSectionRef = useRef<HTMLDivElement>(null);
  const refreshGenRef = useRef(0);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<AppDashboardData | null>(null);
  const [recordInventory, setRecordInventory] = useState<AppRecordRow[]>([]);
  const [inventoryLoading, setInventoryLoading] = useState(true);
  const [recordsColumns, setRecordsColumns] = useState<AppRecordColumn[]>([]);
  const [recordsDataSource, setRecordsDataSource] = useState<string | undefined>();
  const inventoryReadyRef = useRef(false);
  const inventoryGenRef = useRef(0);
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
    async (forceRefresh = false, opts: { silent?: boolean } = {}) => {
      if (!isBackendApiMode() || !appId) {
        setInventoryLoading(false);
        return;
      }
      const silent = Boolean(opts.silent);
      const gen = inventoryGenRef.current;
      const environment = (app.environment as 'production' | 'development') || 'production';
      if (forceRefresh) inventoryReadyRef.current = false;
      if (!silent) setInventoryLoading(true);
      const inv = await loadApplicationRecordInventory({
        applicationId: appId,
        environment,
        skipCache: forceRefresh,
        forceLive: forceRefresh && isSolarApplicationId(appId),
      });
      if (gen !== inventoryGenRef.current) return;
      if (inv.ok) {
        inventoryReadyRef.current = true;
        setRecordInventory(inv.items);
        setRecordsColumns(inv.columns);
        setRecordsDataSource(inv.dataSource);
      }
      if (!silent) setInventoryLoading(false);
    },
    [app, appId],
  );

  const sourceInventoryRefreshRef = useRef(false);

  useEffect(() => {
    sourceInventoryRefreshRef.current = false;
    inventoryReadyRef.current = false;
    inventoryGenRef.current += 1;
    setRecordInventory([]);
    setMisScopedRecords(null);
    setSourceScopedRecords(null);
    setInventoryLoading(true);
    void refresh(false);
    void loadInventory(false);
  }, [appId]); // eslint-disable-line react-hooks/exhaustive-deps -- load dashboard + full inventory once per app

  useEffect(() => {
    if (!refreshNonce) return;
    inventoryReadyRef.current = false;
    inventoryGenRef.current += 1;
    setInventoryLoading(true);
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

  useEffect(() => {
    if (!itsmCompanyMode || !recordInventory.length || recordsHaveSource(recordInventory)) return;
    if (sourceInventoryRefreshRef.current) return;
    sourceInventoryRefreshRef.current = true;
    void loadInventory(true, { silent: true });
  }, [itsmCompanyMode, recordInventory, loadInventory]);
  const travelMode = Boolean(
    data?.report_layout?.kind === 'travel'
    || /travel|expense_and_travel/i.test(appId || ''),
  );
  const leadMode = Boolean(
    data?.report_layout?.kind === 'lead'
    || /lead/i.test(appId || ''),
  );
  const hasInventory = !inventoryLoading && recordInventory.length > 0;
  const dropdownFiltersActive = entity !== 'all' || company !== 'all' || userFilter !== 'all';
  const periodFiltersKpis = period !== 'all';
  const useClientKpis = hasInventory && (dropdownFiltersActive || periodFiltersKpis);
  const useClientInventory = hasInventory;
  const isPmLayout = data?.report_layout?.kind === 'pm'
    || /project_management|project_tracker/i.test(appId || '');
  const isP2pLayout = data?.report_layout?.kind === 'p2p'
    || /procurement|p2p/i.test(appId || '');
  const isEmsLayout = appKind === 'expense' && !travelMode;

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

  const tableInventory = useMemo(() => {
    let base = stampedInventory.length ? stampedInventory : recordInventory;
    if (travelMode && travelPackFocus) {
      const section = TRAVEL_PROCESS_SECTIONS.find((row) => row.kind === travelPackFocus.key);
      if (section) {
        base = base.filter((row) => section.match.test(String(row.process_id || row.subject || '')));
      }
    }
    if (isEmsLayout && claimTypeFocus) {
      const type = EMS_CLAIM_TYPES.find((row) => row.key === claimTypeFocus);
      if (type) {
        base = base.filter((row) => type.match.test(String(row.expense_type || '')));
      }
    }
    return base;
  }, [claimTypeFocus, isEmsLayout, recordInventory, stampedInventory, travelMode, travelPackFocus]);

  const assignedFilterName = useMemo(() => {
    if (userFilter === 'all') return undefined;
    const hit = userRoster.find((u) => {
      const id = String(u.user_id || '').trim();
      const name = String(u.user_name || '').trim();
      return userFilter === id
        || userFilter === name
        || personDedupeKey(name) === userFilter
        || personDedupeKey(name) === personDedupeKey(userFilter);
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
        || personDedupeKey(name) === userFilter
        || personDedupeKey(name) === personDedupeKey(userFilter);
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
      leadWebsiteMode: leadMode,
    });
  }, [company, filterInventory, itsmCompanyMode, leadMode, travelMode, useClientInventory]);

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

  const amountTotals = useMemo(() => {
    const all = kpiRecords;
    const booking = all.filter((r) => /travel_management|travel request|travel booking/i.test(String(r.process_id || r.subject || '')));
    const advance = all.filter((r) => /advance/i.test(String(r.process_id || r.subject || '')));
    const claimed = all.filter((r) => /expense_management|amount claimed|travel expense/i.test(String(r.process_id || r.subject || '')));
    return {
      all: sumRecordAmount(all),
      open: sumRecordAmount(all, 'open'),
      closed: sumRecordAmount(all, 'closed'),
      rejected: sumRecordAmount(all, 'rejected'),
      booking: sumRecordAmount(booking),
      advance: sumRecordAmount(advance),
      claimed: sumRecordAmount(claimed),
    };
  }, [kpiRecords]);

  const ticketKpiRows = itsmCompanyMode && misScopedRecords ? misScopedRecords : kpiRecords;
  const ticketSourceRows = itsmCompanyMode && sourceScopedRecords ? sourceScopedRecords : ticketKpiRows;
  const handleColumnScopedRows = useCallback((payload: { kpiRows: AppRecordRow[]; sourceRows: AppRecordRow[] }) => {
    setMisScopedRecords(payload.kpiRows);
    setSourceScopedRecords(payload.sourceRows);
  }, []);

  useEffect(() => {
    setMisScopedRecords(null);
    setSourceScopedRecords(null);
    setClaimTypeFocus(null);
    setTravelPackFocus(null);
  }, [entity, company, userFilter, period, dateFrom, dateTo]);

  const todayKind = kpiFocus === 'opened_today' ? 'opened' : kpiFocus === 'closed_today' ? 'closed' : undefined;

  const scopedRecords = useMemo(() => {
    if (!useClientInventory) return [] as AppRecordRow[];
    const byStatus = (recordsStatus === 'all' && !todayKind)
      ? kpiRecords
      : filterAppRecords(kpiRecords, {
        status: recordsStatus,
        todayKind,
      });
    if (!claimTypeFocus) return byStatus;
    const type = EMS_CLAIM_TYPES.find((row) => row.key === claimTypeFocus);
    if (!type) return byStatus;
    return byStatus.filter((row) => type.match.test(String(row.expense_type || '')));
  }, [claimTypeFocus, kpiRecords, recordsStatus, todayKind, useClientInventory]);

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
    const ticketUsers = useClientInventory
      ? buildMisUsersFromRecords(scopedRecords, userRoster, { ownerMode: misOwnerMode })
      : mergeRosterWithTicketCounts(identityRoster, data?.users || []);
    return sortByClosedDesc(misEligibleUsers(ticketUsers, userRoster));
  }, [
    data?.users,
    identityRoster,
    misOwnerMode,
    scopedRecords,
    useClientInventory,
    userRoster,
  ]);

  const workUsers = useMemo(
    () => overlayRosterSignIn(identityRoster, userRoster),
    [identityRoster, userRoster],
  );

  const userFilterPeople = useMemo(() => {
    // Same eligibility as the MIS Users table. Use scopeRecords (Entity /
    // Company / Period only) — never the User-filtered set, or the selected
    // id drops and the native <select> snaps back to All.
    const ticketUsers = useClientInventory
      ? buildMisUsersFromRecords(scopeRecords, userRoster, { ownerMode: misOwnerMode })
      : mergeRosterWithTicketCounts(identityRoster, data?.users || []);
    return misEligibleUsers(ticketUsers, userRoster);
  }, [
    data?.users,
    identityRoster,
    misOwnerMode,
    scopeRecords,
    useClientInventory,
    userRoster,
  ]);

  const userFilterOptions = useMemo(() => {
    const options = userFilterPeople
      .filter((u) => {
        const name = String(u.user_name || '').trim();
        return isUsableUserFilterLabel(name, u.user_id);
      })
      .map((u) => ({
        id: String(u.user_id || '').trim() || personDedupeKey(u.user_name) || String(u.user_name),
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
    const unique = mergeUserFilterOptions([...deduped.values()]);
    const base = [
      { id: 'all', label: unique.length ? `All Users (${unique.length})` : 'All Users' },
      ...unique,
    ];
    // Keep a still-eligible selected id so <select> does not snap. Do not
    // re-add roster-only names (Agnes Simon) that are absent from MIS.
    const selectedStillValid = unique.some((o) => filterOptionMatches(o, userFilter));
    return selectedStillValid
      ? ensureFilterOption(base, userFilter, assignedFilterName)
      : base;
  }, [assignedFilterName, userFilter, userFilterPeople]);

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

  const USER_PAGE_SIZE = 40;
  useEffect(() => {
    setUserPage(0);
  }, [entity, company, userFilter, period]);
  const pagedMisUsers = displayedMisUsers.slice(0, (userPage + 1) * USER_PAGE_SIZE);
  const hasMoreMisUsers = displayedMisUsers.length > pagedMisUsers.length;

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
    if (leadMode) {
      const rows = websiteCountsFromRecords(source);
      return sortCompanyFilterOptions(ensureFilterOption(
        [{ id: 'all', label: 'All websites' }, ...rows.map((r) => ({ id: r.id, label: r.label }))],
        company,
      ));
    }
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
  }, [company, entity, filterInventory, itsmCompanyMode, leadMode, stampedInventory]);

  const openVal = Number(data?.metrics.open ?? data?.metrics.pending ?? 0);
  const closedVal = Number(data?.metrics.closed ?? data?.metrics.completed ?? 0);
  const rejectedVal = Number(data?.metrics.rejected || 0);

  const clientKpis = useMemo(() => {
    if (useClientKpis) return summarizeAppRecords(ticketKpiRows);
    if (userFilter !== 'all' && displayedMisUsers.length) return sumUserKpis(displayedMisUsers);
    return { total: Number(data?.metrics.total ?? 0), open: openVal, closed: closedVal, rejected: rejectedVal };
  }, [closedVal, data?.metrics.total, displayedMisUsers, openVal, rejectedVal, ticketKpiRows, useClientKpis, userFilter]);

  const kpiTotal = clientKpis.total;
  const kpiOpen = clientKpis.open;
  const kpiClosed = clientKpis.closed;
  const kpiRejected = clientKpis.rejected;

  const showCompanyFilter = true;

  const scopedIdle = dropdownFiltersActive && useClientKpis && kpiTotal === 0;
  const adoptionOverall = scopedIdle
    ? 0
    : Number(data?.metrics.sign_in_rate_overall ?? data?.metrics.user_adoption_pct ?? 0);
  const adoptionToday = scopedIdle ? 0 : Number(data?.metrics.sign_in_rate_today || 0);
  const signedInToday = scopedIdle ? 0 : Number(data?.metrics.signed_in_today || 0);
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
      return [buckets.PO];
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
      ];
    }
    return rows.filter((row) => row.short === 'PO');
  }, [data?.by_process, isP2pLayout, kpiRecords, useClientKpis]);

  const handleKpiClick = useCallback((focus: RecordKpiFocus) => {
    setTravelPackFocus(null);
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

  const handleTravelPackClick = useCallback((key: TravelPackKind, metric: TravelPackMetric) => {
    setKpiFocus(null);
    setTravelPackFocus((prev) => {
      if (prev?.key === key && prev?.metric === metric) {
        setRecordsStatus('all');
        return null;
      }
      setRecordsStatus(metric === 'open' ? 'open' : metric === 'closed' ? 'closed' : 'all');
      return { key, metric };
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
    () => countTodayActivity(
      useClientInventory ? ticketKpiRows : recordInventory,
      istTodayYmd(),
      { itsmStrict: itsmCompanyMode },
    ),
    [itsmCompanyMode, recordInventory, ticketKpiRows, useClientInventory],
  );
  const itsmSource = useMemo(() => {
    if (!itsmCompanyMode) return { all: data?.by_source_all || data?.by_source, today: data?.by_source_today };
    // Follows MIS filters except Source column (Head / newceo). Never keep
    // an unfiltered API mix — that is why Company / User / Period looked stuck.
    if (useClientInventory) return itsmSourceFromFilteredRecords(ticketSourceRows, istTodayYmd());
    return {
      all: data?.by_source_all || data?.by_source,
      today: data?.by_source_today,
    };
  }, [
    data?.by_source,
    data?.by_source_all,
    data?.by_source_today,
    itsmCompanyMode,
    ticketSourceRows,
    useClientInventory,
  ]);
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

  const showEntityFilter = false;
  const showCompanyDropdown = showCompanyFilter;

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
      companyLabel={leadMode ? 'Website' : 'Company'}
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

  const showDashboardLoader = Boolean((loading && !data) || inventoryLoading);

  return (
    <div className={`relative rounded-3xl p-1 ${NE_DASH_CLASS}${travelMode || isEmsLayout ? ' ne-dash-finance' : ''}`}>
      <DashboardLoadingOverlay
        show={showDashboardLoader}
        mode="fixed"
        label={inventoryLoading && data ? 'Loading records…' : 'Loading dashboard…'}
      />
      <div className={`space-y-4 ${showDashboardLoader ? 'invisible' : ''}`}>
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
            ) : travelMode ? (
              <div className="space-y-5">
                <div className={neKpiBalancedGridClass(10)}>
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
                  <EmbedKpiCard
                    label="Adoption · overall"
                    value={adoptionOverall}
                    suffix="%"
                    sub="Ever signed in ÷ app users"
                    themes={[EMBED_ADOPTION_THEME]}
                    styleIndex={0}
                    surface="white"
                  />
                  <EmbedKpiCard
                    label="Users"
                    value={usersCardCount}
                    icon={Users}
                    themes={EMBED_KPI_THEMES}
                    styleIndex={1}
                    surface="white"
                  />
                  <EmbedKpiCard
                    label="Signed in today"
                    value={signedInToday}
                    icon={UserCheck}
                    themes={EMBED_KPI_THEMES}
                    styleIndex={2}
                    surface="white"
                  />
                  <EmbedKpiCard
                    label="Adoption today"
                    value={adoptionToday}
                    suffix="%"
                    icon={Sparkles}
                    themes={[EMBED_ADOPTION_THEME]}
                    styleIndex={0}
                    surface="white"
                  />
                </div>
                {TRAVEL_PROCESS_SECTIONS.map((section) => {
                  const rows = kpiRecords.filter((r) => section.match.test(String(r.process_id || r.subject || '')));
                  const total = rows.length;
                  const open = countByStatus(rows, 'open');
                  const closed = countByStatus(rows, 'closed');
                  const packActive = (metric: TravelPackMetric) => (
                    travelPackFocus?.key === section.kind && travelPackFocus?.metric === metric
                  );
                  if (section.kind === 'booking') {
                    return (
                      <NeFinanceProcessCard
                        key={section.kind}
                        title={section.title}
                        hint="All booking data in the current filters"
                        icon={section.icon}
                        styleIndex={section.styleIndex}
                        metrics={[
                          { label: 'Total', value: total, hint: requestsSub(total), active: packActive('total'), onClick: () => handleTravelPackClick('booking', 'total') },
                          { label: 'Open', value: open, active: packActive('open'), onClick: () => handleTravelPackClick('booking', 'open') },
                          { label: 'Closed', value: closed, active: packActive('closed'), onClick: () => handleTravelPackClick('booking', 'closed') },
                          { label: 'Booked', value: amountTotals.booking, format: 'inr', hint: requestsSub(total), active: packActive('amount'), onClick: () => handleTravelPackClick('booking', 'amount') },
                        ]}
                      />
                    );
                  }
                  const submitted = section.kind === 'advance' ? amountTotals.advance : amountTotals.claimed;
                  const claimedAmt = sumRecordAmount(rows, 'closed');
                  const lastMetric = claimedAmt > 0
                    ? { label: 'Claimed', value: claimedAmt, format: 'inr' as const, hint: requestsSub(closed), active: packActive('amount'), onClick: () => handleTravelPackClick(section.kind, 'amount') }
                    : { label: 'Submitted', value: submitted, format: 'inr' as const, hint: requestsSub(total), active: packActive('amount'), onClick: () => handleTravelPackClick(section.kind, 'amount') };
                  return (
                    <NeFinanceProcessCard
                      key={section.kind}
                      title={section.title}
                      hint="Submitted and claimed amounts from the current filters"
                      icon={section.icon}
                      styleIndex={section.styleIndex}
                      metrics={[
                        { label: 'Total', value: total, hint: requestsSub(total), active: packActive('total'), onClick: () => handleTravelPackClick(section.kind, 'total') },
                        { label: 'Open', value: open, active: packActive('open'), onClick: () => handleTravelPackClick(section.kind, 'open') },
                        { label: 'Closed', value: closed, active: packActive('closed'), onClick: () => handleTravelPackClick(section.kind, 'closed') },
                        lastMetric,
                      ]}
                    />
                  );
                })}
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
                    title="Purchase orders"
                    hint="Approved and in-flight purchase orders"
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
            ) : isEmsLayout ? (
              <div className="space-y-5">
                <div className={neKpiBalancedGridClass(10)}>
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
                  <EmbedKpiCard
                    label="Adoption · overall"
                    value={adoptionOverall}
                    suffix="%"
                    sub="Ever signed in ÷ app users"
                    themes={[EMBED_ADOPTION_THEME]}
                    styleIndex={0}
                    surface="white"
                  />
                  <EmbedKpiCard
                    label="Users"
                    value={usersCardCount}
                    icon={Users}
                    themes={EMBED_KPI_THEMES}
                    styleIndex={1}
                    surface="white"
                  />
                  <EmbedKpiCard
                    label="Signed in today"
                    value={signedInToday}
                    icon={UserCheck}
                    themes={EMBED_KPI_THEMES}
                    styleIndex={2}
                    surface="white"
                  />
                  <EmbedKpiCard
                    label="Adoption today"
                    value={adoptionToday}
                    suffix="%"
                    icon={Sparkles}
                    themes={[EMBED_ADOPTION_THEME]}
                    styleIndex={0}
                    surface="white"
                  />
                </div>
                <NeFinanceProcessCard
                  title="Claims"
                  hint="Amount and claim count from filtered records — click a cell to filter the table"
                  icon={Receipt}
                  styleIndex={0}
                  metrics={[
                    { label: 'Total submitted', value: amountTotals.all, format: 'inr', hint: claimsSub(kpiTotal), active: kpiFocus === 'total', onClick: () => handleKpiClick('total') },
                    { label: 'Pending review', value: amountTotals.open, format: 'inr', hint: claimsSub(kpiOpen), active: kpiFocus === 'open', onClick: () => handleKpiClick('open') },
                    { label: 'Approved', value: amountTotals.closed, format: 'inr', hint: claimsSub(kpiClosed), active: kpiFocus === 'closed', onClick: () => handleKpiClick('closed') },
                    { label: 'Rejected', value: amountTotals.rejected, format: 'inr', hint: claimsSub(kpiRejected), active: kpiFocus === 'rejected', onClick: () => handleKpiClick('rejected') },
                  ]}
                />
                <NeFinanceProcessCard
                  title="Expense claim types"
                  hint="Click a type to filter the records table"
                  icon={Wallet}
                  styleIndex={1}
                  metrics={[
                    ...EMS_CLAIM_TYPES.map((type) => {
                      const rows = kpiRecords.filter((row) => type.match.test(String(row.expense_type || '')));
                      return {
                        label: type.label,
                        value: sumRecordAmount(rows),
                        format: 'inr' as const,
                        hint: `${type.hint} · ${claimsSub(rows.length)}`,
                        active: claimTypeFocus === type.key,
                        onClick: () => setClaimTypeFocus((prev) => (prev === type.key ? null : type.key)),
                      };
                    }),
                    {
                      label: 'Total raised',
                      value: sumRecordField(kpiRecords, 'raised_amount', 'amount'),
                      format: 'inr' as const,
                      hint: 'Sum of Total raised amount from expense fields',
                    },
                    {
                      label: 'Total claimed',
                      value: sumRecordField(kpiRecords, 'claimed_amount', 'amount'),
                      format: 'inr' as const,
                      hint: 'Sum of Claimed amount from expense fields',
                    },
                  ]}
                />
              </div>
            ) : (
              <div className="space-y-5">
              <div className={neKpiBalancedGridClass(10)}>
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
                {!isP2pLayout ? (
                  <EmbedKpiCard
                    label="Adoption · overall"
                    value={adoptionOverall}
                    suffix="%"
                    sub="Ever signed in ÷ app users"
                    themes={[EMBED_ADOPTION_THEME]}
                    styleIndex={0}
                    surface="white"
                  />
                ) : (
                  <EmbedKpiCard
                    label="Users · P2P app"
                    value={usersCardCount}
                    icon={Users}
                    themes={[EMBED_ADOPTION_THEME]}
                    styleIndex={0}
                    surface="white"
                  />
                )}
                <EmbedKpiCard
                  label="Users"
                  value={usersCardCount}
                  icon={Users}
                  themes={EMBED_KPI_THEMES}
                  styleIndex={1}
                  surface="white"
                />
                <EmbedKpiCard
                  label="Signed in today"
                  value={signedInToday}
                  icon={UserCheck}
                  themes={EMBED_KPI_THEMES}
                  styleIndex={2}
                  surface="white"
                />
                <EmbedKpiCard
                  label="Adoption today"
                  value={adoptionToday}
                  suffix="%"
                  icon={Sparkles}
                  themes={[EMBED_ADOPTION_THEME]}
                  styleIndex={0}
                  surface="white"
                />
              </div>
              </div>
            )}

            {isPmLayout || isP2pLayout ? (
            <div className={neKpiBalancedGridClass(4)}>
              {!isP2pLayout ? (
                <EmbedKpiCard
                  label="Adoption · overall"
                  value={adoptionOverall}
                  suffix="%"
                  sub="Ever signed in ÷ app users"
                  themes={[EMBED_ADOPTION_THEME]}
                  styleIndex={0}
                  surface="white"
                />
              ) : (
                <EmbedKpiCard
                  label="Users · P2P app"
                  value={usersCardCount}
                  icon={Users}
                  themes={[EMBED_ADOPTION_THEME]}
                  styleIndex={0}
                  surface="white"
                />
              )}
              <EmbedKpiCard
                label="Users"
                value={usersCardCount}
                icon={Users}
                themes={EMBED_KPI_THEMES}
                styleIndex={1}
                surface="white"
              />
              <EmbedKpiCard
                label="Signed in today"
                value={signedInToday}
                icon={UserCheck}
                themes={EMBED_KPI_THEMES}
                styleIndex={2}
                surface="white"
              />
              <EmbedKpiCard
                label="Adoption today"
                value={adoptionToday}
                suffix="%"
                icon={Sparkles}
                themes={[EMBED_ADOPTION_THEME]}
                styleIndex={0}
                surface="white"
              />
            </div>
            ) : null}

            {itsmCompanyMode ? (
              <ItsmSourceBreakdown
                all={itsmSource.all}
                today={itsmSource.today}
              />
            ) : null}

            <div ref={misSectionRef}>
            <EmbedAppRecordsTable
              key={travelMode ? `tv-${travelPackFocus?.key || 'all'}-${travelPackFocus?.metric || recordsStatus}` : 'records'}
              inventory={tableInventory}
              columns={
                itsmCompanyMode
                  ? ITSM_CEO_RECORD_COLUMNS
                  : travelMode
                    ? travelColumnsForPack(travelPackFocus?.key)
                    : isEmsLayout
                      ? EMS_DASH_COLUMNS
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
              travelPackKind={travelMode ? travelPackFocus?.key || null : null}
              emsMode={isEmsLayout}
              leadWebsiteMode={leadMode}
              activityDates={activityDates}
              filterAnimating={false}
              inventoryLoading={inventoryLoading}
              onColumnScopedRowsChange={itsmCompanyMode ? handleColumnScopedRows : undefined}
            />

            <DashboardCard
              embed
              className="mt-4"
              collapsible
              open={usersOpen}
              onToggle={() => setUsersOpen((prev) => !prev)}
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
                {pagedMisUsers.map((user, index) => {
                  const open = Number(user.open ?? user.pending ?? 0);
                  const closed = Number(user.closed ?? user.completed ?? 0);
                  const rejected = Number(user.rejected || 0);
                  const login = misUserLoginDisplay(user, formatWhen);
                  const rowKey = `${compactMisName(user.user_name) || user.user_id || user.user_name}-${index}`;
                  return (
                    <MisMobileRecordCard
                      key={rowKey}
                      title={formatMisUserName(user)}
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
                    No assigned users with a sign-in and ticket count for this filter.
                  </p>
                ) : null}
                {hasMoreMisUsers ? (
                  <button
                    type="button"
                    onClick={() => setUserPage((p) => p + 1)}
                    className="inline-flex h-9 w-full items-center justify-center rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700"
                  >
                    Show more users ({displayedMisUsers.length - pagedMisUsers.length} remaining)
                  </button>
                ) : null}
              </div>
              <div className="hidden overflow-x-auto px-1 lg:block">
                <table className="w-full text-sm">
                  <thead className={NE_TYPE.tableHead}>
                    <tr>
                      <th className="whitespace-nowrap px-5 py-3.5 text-left font-semibold">User</th>
                      <th className="whitespace-nowrap px-5 py-3.5 text-left font-semibold">Last sign-in</th>
                      <th className="whitespace-nowrap px-5 py-3.5 text-right font-semibold">Open</th>
                      <th className="whitespace-nowrap px-5 py-3.5 text-right font-semibold">Closed</th>
                      <th className="whitespace-nowrap px-5 py-3.5 text-right font-semibold">Rejected</th>
                      <th className="whitespace-nowrap px-5 py-3.5 text-right font-semibold">Total</th>
                      <th className="whitespace-nowrap px-5 py-3.5 text-right font-semibold">Closure %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedMisUsers.map((user, index) => {
                      const open = Number(user.open ?? user.pending ?? 0);
                      const closed = Number(user.closed ?? user.completed ?? 0);
                      const rejected = Number(user.rejected || 0);
                      const login = misUserLoginDisplay(user, formatWhen);
                      const rowKey = `${compactMisName(user.user_name) || user.user_id || user.user_name}-${index}`;
                      return (
                        <tr key={rowKey} className="border-t border-slate-200">
                          <td className="min-w-[12rem] max-w-[18rem] whitespace-normal break-words px-5 py-3.5 font-medium text-slate-900">{formatMisUserName(user)}</td>
                          <td className="px-5 py-3.5 text-sm tabular-nums text-slate-600">
                            {login.text === '-' ? (
                              <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600 ring-1 ring-slate-200">
                                {login.text}
                              </span>
                            ) : (
                              <span className={login.signedToday ? 'font-semibold text-[#287B5D]' : undefined}>
                                {login.text}
                              </span>
                            )}
                          </td>
                          <td className="px-5 py-3.5 text-right font-semibold tabular-nums text-[#A96A20]">{open}</td>
                          <td className="px-5 py-3.5 text-right font-semibold tabular-nums text-[#287B5D]">{closed}</td>
                          <td className="px-5 py-3.5 text-right font-semibold tabular-nums text-[#B24E66]">{rejected}</td>
                          <td className="px-5 py-3.5 text-right tabular-nums">{user.total || open + closed + rejected}</td>
                          <td className="px-5 py-3.5 text-right font-semibold tabular-nums text-slate-700">
                            {closureRatioPct(open, closed)}%
                          </td>
                        </tr>
                      );
                    })}
                    {displayedMisUsers.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-5 py-8 text-center text-sm text-slate-400">
                          No assigned users with a sign-in and ticket count for this filter.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
              {hasMoreMisUsers ? (
                <div className="px-5 pb-4 pt-3">
                  <button
                    type="button"
                    onClick={() => setUserPage((p) => p + 1)}
                    className="inline-flex h-9 items-center rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Show more users ({displayedMisUsers.length - pagedMisUsers.length} remaining)
                  </button>
                </div>
              ) : null}
            </DashboardCard>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
