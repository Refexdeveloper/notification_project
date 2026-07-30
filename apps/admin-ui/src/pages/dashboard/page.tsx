import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, History, LayoutDashboard, RefreshCw } from 'lucide-react';
import Layout from '@/components/feature/Layout';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { GlassCard } from '@/components/ui/GlassCard';
import { isBackendApiMode } from '@/services/backendApi';
import { loadDashboard, type DashboardApplication, type DashboardSendRow } from '@/services/dashboardApi';
import { staggerContainer, fadeUpItem, springSoft } from '@/lib/motion';

function formatWhen(value: string | null | undefined): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-IN', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function statusChip(status: string): string {
  if (status === 'delivered' || status === 'completed') return 'chip-success capitalize';
  if (status === 'failed') return 'chip-danger capitalize';
  return 'chip-warn capitalize';
}

function MetricTile({
  label,
  value,
  accent = 'default',
}: {
  label: string;
  value: string | number;
  accent?: 'default' | 'green' | 'blue' | 'amber';
}) {
  const valueClass =
    accent === 'green'
      ? 'text-[#1a8c5c]'
      : accent === 'blue'
        ? 'text-[#5b7ba3]'
        : accent === 'amber'
          ? 'text-[#b45309]'
          : 'text-foreground-950';

  return (
    <div className="rounded-xl border border-background-200/80 bg-white px-3 py-3 min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-foreground-400 truncate">{label}</p>
      <p className={`text-xl font-heading font-semibold mt-1 tabular-nums ${valueClass}`}>{value}</p>
    </div>
  );
}

function AppMetricsPanel({ app, onOpen }: { app: DashboardApplication; onOpen: () => void }) {
  const m = app.metrics;
  const labels = app.metric_labels;

  return (
    <motion.div variants={fadeUpItem} transition={springSoft} className="surface p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-heading font-semibold text-foreground-950 truncate">
            {app.application_name}
          </h3>
          <p className="text-xs text-foreground-500 mt-0.5">
            {m.total_users} users
            {app.snapshot_at ? ` · Snapshot ${formatWhen(app.snapshot_at)}` : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={onOpen}
          className="text-xs font-semibold text-primary-700 inline-flex items-center gap-1 cursor-pointer shrink-0"
        >
          Open app
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-2.5">
        <MetricTile label={labels.sign_in_today} value={m.sign_in_today} accent="green" />
        <MetricTile label={labels.sign_in_rate_overall} value={`${m.sign_in_rate_overall}%`} accent="blue" />
        <MetricTile label={labels.sign_in_rate_today} value={`${m.sign_in_rate_today}%`} accent="green" />
        <MetricTile label={labels.open_tickets} value={m.open_tickets} accent="amber" />
        <MetricTile label={labels.closed_tickets} value={m.closed_tickets} accent="green" />
      </div>
    </motion.div>
  );
}

function SendRow({ row }: { row: DashboardSendRow }) {
  return (
    <div className="px-4 py-3 border-b border-background-100 last:border-0 flex items-center gap-3">
      <span className="icon-well shrink-0">
        <History className="w-4 h-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-foreground-900 truncate">{row.application_name}</p>
        <p className="text-xs text-foreground-500 mt-0.5">Scheduled report send</p>
      </div>
      <span className={statusChip(row.status)}>{row.status}</span>
      <span className="text-xs text-foreground-500 whitespace-nowrap">{formatWhen(row.sent_at)}</span>
    </div>
  );
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const backendMode = isBackendApiMode();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [applications, setApplications] = useState<DashboardApplication[]>([]);
  const [recentSends, setRecentSends] = useState<DashboardSendRow[]>([]);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const result = await loadDashboard('production');
    if (!result.ok || !result.data) {
      setError(result.error || 'Could not load dashboard');
      setApplications([]);
      setRecentSends([]);
    } else {
      setApplications(result.data.applications);
      setRecentSends(result.data.recent_sends);
      setGeneratedAt(result.data.generated_at || null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!backendMode) {
    return (
      <Layout breadcrumbs={[{ label: 'Dashboard' }]}>
        <EmptyState
          variant="activity"
          title="Dashboard requires backend mode"
          description="Switch to PostgreSQL backend-api mode to view live engagement metrics."
          primaryLabel="Go to applications"
          onPrimary={() => navigate('/applications')}
        />
      </Layout>
    );
  }

  return (
    <Layout breadcrumbs={[{ label: 'Dashboard' }]}>
      <div className="mb-7 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <LayoutDashboard className="w-5 h-5 text-primary-600" />
            <h1 className="page-title">Dashboard</h1>
          </div>
          <p className="page-subtitle">
            Live engagement metrics and recent report sends across all applications.
            {generatedAt ? ` Updated ${formatWhen(generatedAt)}.` : ''}
          </p>
        </div>
        <Button variant="secondary" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {error ? (
        <EmptyState
          variant="activity"
          title="Could not load dashboard"
          description={error}
          primaryLabel="Retry"
          onPrimary={() => void load()}
        />
      ) : loading && applications.length === 0 ? (
        <EmptyState variant="activity" title="Loading dashboard…" description="Fetching metrics from PostgreSQL." />
      ) : (
        <div className="space-y-6">
          <motion.section
            variants={staggerContainer}
            initial="hidden"
            animate="show"
            className="space-y-4"
          >
            <h2 className="text-sm font-heading font-semibold text-foreground-800">Application metrics</h2>
            {applications.length === 0 ? (
              <div className="surface p-6 text-sm text-foreground-500">No registered applications yet.</div>
            ) : (
              applications.map((app) => (
                <AppMetricsPanel
                  key={`${app.environment}-${app.application_id}`}
                  app={app}
                  onOpen={() => navigate(`/applications/${app.environment}-${app.application_id}`)}
                />
              ))
            )}
          </motion.section>

          <section>
            <div className="flex items-center justify-between gap-3 mb-3">
              <h2 className="text-sm font-heading font-semibold text-foreground-800">Recent sends</h2>
              <button
                type="button"
                onClick={() => navigate('/history')}
                className="text-xs font-semibold text-primary-700 cursor-pointer"
              >
                View all
              </button>
            </div>
            <GlassCard className="overflow-hidden p-0">
              {recentSends.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-foreground-500">
                  No scheduled report sends logged yet.
                </div>
              ) : (
                recentSends.map((row) => <SendRow key={row.id} row={row} />)
              )}
            </GlassCard>
          </section>
        </div>
      )}
    </Layout>
  );
}
