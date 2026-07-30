import { apiV1Fetch, isBackendApiMode } from './backendApi';

export type DashboardMetricLabels = {
  sign_in_today: string;
  sign_in_rate_overall: string;
  sign_in_rate_today: string;
  open_tickets: string;
  closed_tickets: string;
};

export type DashboardAppMetrics = {
  total_users: number;
  sign_in_today: number;
  sign_in_rate_overall: number;
  sign_in_rate_today: number;
  open_tickets: number;
  closed_tickets: number;
};

export type DashboardApplication = {
  environment: string;
  application_id: string;
  application_name: string;
  snapshot_at: string | null;
  metrics: DashboardAppMetrics;
  metric_labels: DashboardMetricLabels;
};

export type DashboardSendRow = {
  id: string;
  application_id: string;
  application_name: string;
  status: string;
  sent_at: string;
};

export type DashboardData = {
  environment: string;
  applications: DashboardApplication[];
  recent_sends: DashboardSendRow[];
  generated_at?: string;
  warning?: string;
};

export async function loadDashboard(
  environment: 'production' | 'development' = 'production',
): Promise<{ ok: boolean; data?: DashboardData; error?: string }> {
  if (!isBackendApiMode()) {
    return { ok: false, error: 'Backend API mode is not enabled' };
  }

  const res = await apiV1Fetch<DashboardData>(
    `/dashboard?environment=${encodeURIComponent(environment)}`,
  );

  if (!res.ok || !res.data) {
    return { ok: false, error: res.error || 'Failed to load dashboard' };
  }

  return { ok: true, data: res.data };
}
