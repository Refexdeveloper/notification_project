import Layout from '@/components/feature/Layout';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { History, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { GlassCard } from '@/components/ui/GlassCard';
import { apiFetch } from '@/services/api';
import { isBackendApiMode } from '@/services/backendApi';
import { loadGlobalDeliveryHistory, type SendHistoryRow } from '@/services/historyApi';

type FilterKey = 'all' | 'delivered' | 'failed' | 'pending';

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
  if (status === 'delivered') return 'chip-success capitalize';
  if (status === 'failed') return 'chip-danger capitalize';
  return 'chip-warn capitalize';
}

export default function HistoryPage() {
  const navigate = useNavigate();
  const backendMode = isBackendApiMode();
  const [status, setStatus] = useState<FilterKey>('all');
  const [items, setItems] = useState<SendHistoryRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    setWarning('');

    if (backendMode) {
      const result = await loadGlobalDeliveryHistory('production');
      if (result.error) {
        setError(result.error);
        setItems([]);
        setTotal(0);
      } else {
        setItems(result.items);
        setTotal(result.total);
        setWarning(result.warning || '');
      }
      setLoading(false);
      return;
    }

    const res = await apiFetch<{ total: number; items: Array<{
      id: number;
      recipient: string;
      subject: string;
      status: 'sent' | 'failed';
      sent_at: string;
    }> }>('/api/email-logs?limit=100');
    if (!res.ok) {
      setError(res.error || 'Failed to load sent history');
      setItems([]);
      setTotal(0);
    } else {
      setItems(
        (Array.isArray(res.data?.items) ? res.data.items : []).map((row) => ({
          id: String(row.id),
          application_name: row.subject || 'Email',
          status: row.status === 'sent' ? 'delivered' : 'failed',
          sent_at: row.sent_at,
        })),
      );
      setTotal(Number(res.data?.total) || 0);
    }
    setLoading(false);
  }, [backendMode]);

  useEffect(() => {
    void load();
  }, [load]);

  const list = useMemo(() => {
    return items.filter((h) => status === 'all' || h.status === status);
  }, [items, status]);

  return (
    <Layout breadcrumbs={[{ label: 'Dashboard', path: '/dashboard' }, { label: 'Sent history' }]}>
      <div className="mb-7 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="page-title">Sent history</h1>
          <p className="page-subtitle">
            Which application sent a scheduled report and when.
            {!loading && total > 0 ? ` ${total} send${total === 1 ? '' : 's'}.` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button variant="secondary" onClick={() => navigate('/dashboard')}>
            Dashboard
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <div className="flex items-center glass rounded-[14px] p-1 flex-wrap">
          {(['all', 'delivered', 'failed', 'pending'] as FilterKey[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatus(s)}
              className={`h-8 px-3 rounded-[10px] text-xs font-semibold capitalize cursor-pointer transition-colors ${
                status === s ? 'bg-primary-600 text-white' : 'text-foreground-600 hover:bg-background-50'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {warning && !error && (
        <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          {warning}
        </div>
      )}

      {error ? (
        <EmptyState
          variant="activity"
          title="Could not load history"
          description={error}
          primaryLabel="Retry"
          onPrimary={() => void load()}
        />
      ) : loading && items.length === 0 ? (
        <EmptyState variant="activity" title="Loading…" description="Fetching send history." />
      ) : list.length === 0 ? (
        <EmptyState
          variant="activity"
          title="No sends yet"
          description="Scheduled report runs will appear here after the pipeline completes a send."
          primaryLabel="Go to dashboard"
          onPrimary={() => navigate('/dashboard')}
        />
      ) : (
        <GlassCard className="overflow-hidden p-0">
          <div className="hidden md:grid grid-cols-[1.4fr_100px_180px] gap-2 px-5 py-2.5 border-b border-background-100 text-[11px] font-medium text-foreground-400 uppercase tracking-wide">
            <span>Application</span>
            <span>Status</span>
            <span>Sent at</span>
          </div>
          {list.map((item) => (
            <div
              key={item.id}
              className="grid grid-cols-1 md:grid-cols-[1.4fr_100px_180px] gap-1 md:gap-2 px-5 py-3.5 border-b border-background-100 last:border-0 hover:bg-background-50/80 items-center"
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className="icon-well shrink-0 md:hidden">
                  <History className="w-4 h-4" />
                </span>
                <p className="text-sm font-semibold text-foreground-900 truncate">{item.application_name}</p>
              </div>
              <span className={`${statusChip(item.status)} w-fit`}>{item.status}</span>
              <span className="text-xs text-foreground-500 whitespace-nowrap">{formatWhen(item.sent_at)}</span>
            </div>
          ))}
        </GlassCard>
      )}
    </Layout>
  );
}
