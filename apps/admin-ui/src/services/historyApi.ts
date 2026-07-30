import type { KissflowApplication } from '@/mocks/applications';
import { resolveBackendApplicationId } from '@/services/applicationsApi';
import { apiV1Fetch, isBackendApiMode } from './backendApi';

export type SendHistoryRow = {
  id: string;
  application_id?: string;
  application_name: string;
  status: 'delivered' | 'failed' | 'pending';
  sent_at: string;
  error_message?: string | null;
};

export type HistoryItemKind = 'snapshot' | 'report';

export type BackendHistoryItem = {
  id: string;
  kind: HistoryItemKind;
  title: string;
  subtitle: string;
  process_id: string;
  process_name: string | null;
  status: string;
  raw_status: string;
  occurred_at: string;
  detail: string;
  item_record_count?: number;
  user_record_count?: number;
  assignment_record_count?: number;
  unresolved_role_count?: number;
  error_message?: string | null;
};

export type HistoryListResponse = {
  items: BackendHistoryItem[];
  count: number;
  snapshot_count: number;
  report_count: number;
  environment?: string;
  application_id?: string;
  warning?: string;
  hint?: string;
};

export type HistoryLoadResult = {
  items: SendHistoryRow[];
  total: number;
  error?: string;
  warning?: string;
};

function toDbEnvironment(environment: KissflowApplication['environment']): string {
  return environment === 'Production' ? 'production' : 'development';
}

function mapSendRow(row: {
  id: string;
  application_id?: string;
  application_name?: string;
  status: string;
  sent_at: string | null;
  error_message?: string | null;
}): SendHistoryRow {
  const status =
    row.status === 'delivered' ? 'delivered' : row.status === 'failed' ? 'failed' : 'pending';
  return {
    id: row.id,
    application_id: row.application_id,
    application_name: row.application_name || row.application_id || '—',
    status,
    sent_at: row.sent_at || new Date(0).toISOString(),
    error_message: row.error_message,
  };
}

export async function loadGlobalDeliveryHistory(
  environment: 'production' | 'development' = 'production',
): Promise<HistoryLoadResult> {
  if (!isBackendApiMode()) {
    return { items: [], total: 0 };
  }

  const path = `/history?environment=${encodeURIComponent(environment)}&limit=200&_=${Date.now()}`;
  const res = await apiV1Fetch<{
    items: Array<{
      id: string;
      report_run_id?: string;
      application_id?: string;
      application_name?: string;
      status: string;
      sent_at: string | null;
      error_message?: string | null;
    }>;
    total: number;
    warning?: string;
  }>(path, { cache: 'no-store' });

  if (!res.ok || !res.data) {
    return {
      items: [],
      total: 0,
      error: res.error || 'Failed to load delivery history',
    };
  }

  const items = res.data.items.map(mapSendRow);

  return {
    items,
    total: res.data.total,
    warning: res.data.warning,
  };
}

export async function loadSendHistoryFromBackend(app: KissflowApplication): Promise<HistoryLoadResult> {
  if (!isBackendApiMode()) {
    return { items: [], total: 0 };
  }

  const environment = toDbEnvironment(app.environment);
  const applicationId = resolveBackendApplicationId(app);
  const path = `/applications/${encodeURIComponent(applicationId)}/history?environment=${encodeURIComponent(environment)}&sends_only=true`;
  const res = await apiV1Fetch<HistoryListResponse>(path);

  if (!res.ok || !res.data) {
    return {
      items: [],
      total: 0,
      error: res.error || 'Failed to load history',
    };
  }

  const appName = app.displayName || app.name;
  const items: SendHistoryRow[] = res.data.items
    .filter((item) => item.kind === 'report')
    .map((item) => ({
      id: item.id,
      application_name: appName,
      status:
        item.status === 'delivered'
          ? 'delivered'
          : item.status === 'failed'
            ? 'failed'
            : 'pending',
      sent_at: item.occurred_at,
      error_message: item.error_message,
    }));

  return {
    items,
    total: items.length,
    warning: res.data.warning || res.data.hint,
  };
}

/** @deprecated Use loadSendHistoryFromBackend for simplified send log. */
export async function loadHistoryFromBackend(app: KissflowApplication): Promise<{
  items: BackendHistoryItem[];
  snapshotCount: number;
  reportCount: number;
  error?: string;
  warning?: string;
}> {
  if (!isBackendApiMode()) {
    return { items: [], snapshotCount: 0, reportCount: 0 };
  }

  const environment = toDbEnvironment(app.environment);
  const path = `/applications/${encodeURIComponent(app.appId)}/history?environment=${encodeURIComponent(environment)}`;
  const res = await apiV1Fetch<HistoryListResponse>(path);

  if (!res.ok || !res.data) {
    return {
      items: [],
      snapshotCount: 0,
      reportCount: 0,
      error: res.error || 'Failed to load history',
    };
  }

  return {
    items: res.data.items,
    snapshotCount: res.data.snapshot_count,
    reportCount: res.data.report_count,
    warning: res.data.warning || res.data.hint,
  };
}
