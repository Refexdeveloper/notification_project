import Layout from '@/components/feature/Layout';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { History, Search, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { GlassCard } from '@/components/ui/GlassCard';
import { apiFetch } from '@/services/api';
import { isBackendApiMode } from '@/services/backendApi';
import { loadGlobalDeliveryHistory } from '@/services/historyApi';

type LogStatus = 'sent' | 'failed';

type HistoryRow = {
  id: string;
  recipient: string;
  subject: string;
  status: 'delivered' | 'failed' | 'pending';
  error_message?: string | null;
  sent_at: string;
  entity_type?: string | null;
  entity_id?: string | null;
  application_name?: string;
};

type FilterKey = 'all' | 'delivered' | 'failed';

function sourceLabel(row: HistoryRow): string {
  if (row.entity_type === 'EmailScheduler' || row.entity_type === 'ReportSchedule') {
    return 'Scheduled send';
  }
  if (row.entity_type === 'SMTPConfig' || row.entity_type === 'SmtpTest') return 'SMTP test';
  if (row.application_name) return row.application_name;
  if (row.entity_type) return row.entity_type;
  return 'Email';
}

export default function HistoryPage() {
  const navigate = useNavigate();
  const backendMode = isBackendApiMode();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<FilterKey>('all');
  const [items, setItems] = useState<HistoryRow[]>([]);
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
        setItems(
          result.items.map((row) => ({
            id: row.id,
            recipient: row.detail || '—',
            subject: row.title,
            status:
              row.status === 'delivered'
                ? 'delivered'
                : row.status === 'failed'
                  ? 'failed'
                  : 'pending',
            error_message: row.error_message,
            sent_at: row.occurred_at,
            entity_type: 'ReportSchedule',
            application_name: row.subtitle,
          })),
        );
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
      status: LogStatus;
      error_message?: string | null;
      sent_at: string;
      entity_type?: string | null;
      entity_id?: string | null;
    }> }>('/api/email-logs?limit=100');
    if (!res.ok) {
      setError(res.error || 'Failed to load sent history');
      setItems([]);
      setTotal(0);
    } else {
      setItems(
        (Array.isArray(res.data?.items) ? res.data.items : []).map((row) => ({
          id: String(row.id),
          recipient: row.recipient,
          subject: row.subject,
          status: row.status === 'sent' ? 'delivered' : 'failed',
          error_message: row.error_message,
          sent_at: row.sent_at,
          entity_type: row.entity_type,
          entity_id: row.entity_id ? String(row.entity_id) : null,
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
    return items.filter((h) => {
      const matchStatus = status === 'all' || h.status === status;
      const q = search.toLowerCase();
      const matchSearch =
        !q ||
        (h.subject || '').toLowerCase().includes(q) ||
        (h.recipient || '').toLowerCase().includes(q) ||
        (h.error_message || '').toLowerCase().includes(q) ||
        (h.application_name || '').toLowerCase().includes(q);
      return matchStatus && matchSearch;
    });
  }, [items, search, status]);

  return (
    <Layout breadcrumbs={[{ label: 'Applications', path: '/applications' }, { label: 'Sent history' }]}>
      <div className="mb-7 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="page-title">Sent history</h1>
          <p className="page-subtitle">
            {backendMode
              ? 'Report delivery runs from PostgreSQL across all applications.'
              : 'See what went out, to whom, and whether it was delivered.'}
            {!loading && total > 0 ? ` ${total} record${total === 1 ? '' : 's'}.` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button variant="secondary" onClick={() => navigate('/applications')}>
            Browse applications
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <div className="flex-1 max-w-sm">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search subject, app, or recipient…"
            leftSlot={<Search className="w-4 h-4" />}
          />
        </div>
        <div className="flex items-center glass rounded-[14px] p-1 flex-wrap">
          {(['all', 'delivered', 'failed'] as FilterKey[]).map((s) => (
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
        <EmptyState
          variant="activity"
          title="Loading…"
          description="Fetching delivery history."
        />
      ) : list.length === 0 ? (
        <EmptyState
          variant="activity"
          title="No messages yet"
          description={
            backendMode
              ? 'Scheduled report runs will appear here after the pipeline logs deliveries to PostgreSQL.'
              : 'Once you send or schedule notifications, delivery history will appear here.'
          }
          primaryLabel="Go to applications"
          onPrimary={() => navigate('/applications')}
        />
      ) : (
        <GlassCard className="overflow-hidden p-0">
          {list.map((item) => (
            <div
              key={item.id}
              className="px-5 py-3.5 border-b border-background-100 last:border-0 flex items-center gap-4 hover:bg-background-50/80"
            >
              <span className="icon-well shrink-0">
                <History className="w-4 h-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-foreground-900 truncate">
                  {item.subject || '(no subject)'}
                </p>
                <p className="text-xs text-foreground-500 mt-0.5 truncate">
                  {sourceLabel(item)} · {item.recipient}
                </p>
                {item.error_message ? (
                  <p className="text-xs text-danger-600 mt-1 truncate">{item.error_message}</p>
                ) : null}
              </div>
              <span className="chip-muted capitalize">email</span>
              <span
                className={
                  item.status === 'failed'
                    ? 'chip-danger capitalize'
                    : item.status === 'pending'
                      ? 'chip-warn capitalize'
                      : 'chip-success capitalize'
                }
              >
                {item.status}
              </span>
              <span className="text-xs text-foreground-400 whitespace-nowrap">
                {item.sent_at
                  ? new Date(item.sent_at).toLocaleString('en-IN', {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })
                  : '—'}
              </span>
            </div>
          ))}
        </GlassCard>
      )}
    </Layout>
  );
}
