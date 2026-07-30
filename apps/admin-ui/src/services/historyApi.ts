import type { KissflowApplication } from '@/mocks/applications';
import { apiV1Fetch, isBackendApiMode } from './backendApi';

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
  items: BackendHistoryItem[];
  snapshotCount: number;
  reportCount: number;
  error?: string;
  warning?: string;
};

function toDbEnvironment(environment: KissflowApplication['environment']): string {
  return environment === 'Production' ? 'production' : 'development';
}

export async function loadGlobalDeliveryHistory(
  environment: 'production' | 'development' = 'production',
): Promise<HistoryLoadResult & { total: number }> {
  if (!isBackendApiMode()) {
    return { items: [], snapshotCount: 0, reportCount: 0, total: 0 };
  }

  const path = `/history?environment=${encodeURIComponent(environment)}&limit=200`;
  const res = await apiV1Fetch<{
    items: Array<{
      id: string;
      recipient: string;
      subject: string;
      status: string;
      error_message?: string | null;
      sent_at: string;
      application_name?: string;
      entity_type?: string;
    }>;
    total: number;
    warning?: string;
  }>(path);

  if (!res.ok || !res.data) {
    return {
      items: [],
      snapshotCount: 0,
      reportCount: 0,
      total: 0,
      error: res.error || 'Failed to load delivery history',
    };
  }

  const items: BackendHistoryItem[] = res.data.items.map((row) => ({
    id: row.id,
    kind: 'report' as const,
    title: row.subject,
    subtitle: row.application_name || row.recipient,
    process_id: '',
    process_name: null,
    status: row.status,
    raw_status: row.status,
    occurred_at: row.sent_at,
    detail: row.recipient,
    error_message: row.error_message,
  }));

  return {
    items,
    snapshotCount: 0,
    reportCount: items.length,
    total: res.data.total,
    warning: res.data.warning,
  };
}

export async function loadHistoryFromBackend(app: KissflowApplication): Promise<HistoryLoadResult> {
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
