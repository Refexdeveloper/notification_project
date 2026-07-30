import Layout from '@/components/feature/Layout';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { History, Search, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { GlassCard } from '@/components/ui/GlassCard';
import { apiFetch } from '@/services/api';

type LogStatus = 'sent' | 'failed';

type EmailLogRow = {
  id: number;
  recipient: string;
  subject: string;
  status: LogStatus;
  error_message?: string | null;
  sent_at: string;
  entity_type?: string | null;
  entity_id?: string | null;
};

type FilterKey = 'all' | 'delivered' | 'failed';

function uiStatus(status: LogStatus): 'delivered' | 'failed' {
  return status === 'sent' ? 'delivered' : 'failed';
}

function sourceLabel(row: EmailLogRow): string {
  if (row.entity_type === 'EmailScheduler') return 'Scheduled send';
  if (row.entity_type === 'SMTPConfig' || row.entity_type === 'SmtpTest') return 'SMTP test';
  if (row.entity_type) return row.entity_type;
  return 'Email';
}

export default function HistoryPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<FilterKey>('all');
  const [items, setItems] = useState<EmailLogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const res = await apiFetch<{ total: number; items: EmailLogRow[] }>('/api/email-logs?limit=100');
    if (!res.ok) {
      setError(res.error || 'Failed to load sent history');
      setItems([]);
      setTotal(0);
    } else {
      setItems(Array.isArray(res.data?.items) ? res.data.items : []);
      setTotal(Number(res.data?.total) || 0);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const list = useMemo(() => {
    return items.filter((h) => {
      const ui = uiStatus(h.status);
      const matchStatus = status === 'all' || ui === status;
      const q = search.toLowerCase();
      const matchSearch =
        !q ||
        (h.subject || '').toLowerCase().includes(q) ||
        (h.recipient || '').toLowerCase().includes(q) ||
        (h.error_message || '').toLowerCase().includes(q);
      return matchStatus && matchSearch;
    });
  }, [items, search, status]);

  return (
    <Layout breadcrumbs={[{ label: 'Applications', path: '/applications' }, { label: 'Sent history' }]}>
      <div className="mb-7 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="page-title">Sent history</h1>
          <p className="page-subtitle">
            See what went out, to whom, and whether it was delivered.
            {!loading && total > 0 ? ` ${total} log${total === 1 ? '' : 's'} on server.` : ''}
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
            placeholder="Search subject or recipient…"
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
          description="Fetching delivery logs from the server."
        />
      ) : list.length === 0 ? (
        <EmptyState
          variant="activity"
          title="No messages yet"
          description="Once you send or schedule notifications, delivery history will appear here."
          primaryLabel="Go to applications"
          onPrimary={() => navigate('/applications')}
        />
      ) : (
        <GlassCard className="overflow-hidden p-0">
          {list.map((item) => {
            const ui = uiStatus(item.status);
            return (
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
                <span className={ui === 'failed' ? 'chip-danger capitalize' : 'chip-success capitalize'}>
                  {ui}
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
            );
          })}
        </GlassCard>
      )}
    </Layout>
  );
}
