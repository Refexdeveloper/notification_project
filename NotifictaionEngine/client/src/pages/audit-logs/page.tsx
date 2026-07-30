import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, ShieldCheck } from 'lucide-react';
import Layout from '@/components/feature/Layout';
import { apiFetch } from '@/services/api';
import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { EmptyState } from '@/components/ui/EmptyState';

type AuditItem = {
  id: number;
  action: string;
  entity_type?: string | null;
  entity_id?: string | null;
  details?: unknown;
  ip_address?: string | null;
  created_at?: string;
  createdAt?: string;
  user?: { id: number; name: string; email: string } | null;
};

export default function AuditLogsPage() {
  const [items, setItems] = useState<AuditItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const res = await apiFetch<{ total: number; items: AuditItem[] }>('/api/audit-logs?limit=100');
    setLoading(false);
    if (!res.ok) {
      setError(res.error || 'Could not load audit trail');
      return;
    }
    setTotal(res.data.total || 0);
    setItems(Array.isArray(res.data.items) ? res.data.items : []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Layout breadcrumbs={[{ label: 'Home', path: '/applications' }, { label: 'Audit trail' }]}>
      <div className="mb-7 flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h1 className="page-title">Audit trail</h1>
          <p className="page-subtitle">Who changed users, SMTP, and other configuration.</p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => void load()} leftIcon={<RefreshCw className="w-3.5 h-3.5" />}>
          Refresh
        </Button>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-[14px] bg-red-50 border border-red-200 text-sm text-red-800 font-medium">
          {error}
        </div>
      )}

      <GlassCard className="overflow-hidden p-0">
        <div className="px-5 py-4 border-b border-background-200/70 flex items-center gap-3">
          <span className="icon-well">
            <ShieldCheck className="w-4 h-4" />
          </span>
          <div>
            <h3 className="text-base font-heading font-semibold text-foreground-950">Recent activity</h3>
            <p className="text-xs text-foreground-500">{total} recorded event{total === 1 ? '' : 's'}</p>
          </div>
        </div>

        {loading ? (
          <div className="px-5 py-14 text-center text-sm text-foreground-500">Loading…</div>
        ) : items.length === 0 ? (
          <div className="p-4">
            <EmptyState
              variant="generic"
              title="No audit events yet"
              description="Sign-ins, user changes, and SMTP updates will appear here."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-background-100 bg-background-50/80">
                  <th className="px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-foreground-400">When</th>
                  <th className="px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-foreground-400">Who</th>
                  <th className="px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-foreground-400">Action</th>
                  <th className="px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-foreground-400">Entity</th>
                  <th className="px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-foreground-400">Details</th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => {
                  const when = row.created_at || row.createdAt;
                  return (
                    <tr key={row.id} className="border-b border-background-100/80 last:border-0">
                      <td className="px-5 py-3 text-xs text-foreground-600 whitespace-nowrap">
                        {when
                          ? new Date(when).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
                          : '—'}
                      </td>
                      <td className="px-5 py-3 text-sm text-foreground-800">
                        {row.user?.name || 'System'}
                        {row.user?.email ? (
                          <span className="block text-[11px] text-foreground-400">{row.user.email}</span>
                        ) : null}
                      </td>
                      <td className="px-5 py-3">
                        <span className="chip-muted font-mono text-[11px]">{row.action}</span>
                      </td>
                      <td className="px-5 py-3 text-xs text-foreground-600">
                        {row.entity_type || '—'}
                        {row.entity_id ? (
                          <span className="text-foreground-400"> · {row.entity_id}</span>
                        ) : null}
                      </td>
                      <td className="px-5 py-3 text-[11px] text-foreground-500 font-mono max-w-[240px] truncate">
                        {row.details == null
                          ? '—'
                          : typeof row.details === 'string'
                            ? row.details
                            : JSON.stringify(row.details)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </GlassCard>
    </Layout>
  );
}
