import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { loadApplicationRecords, type AppRecordRow } from '@/services/appRecordsApi';

type AppRef = {
  application_id: string;
  application_name?: string;
};

type Props = {
  userName: string;
  email?: string;
  /** When set, only these apps are queried (user management). */
  applications?: AppRef[];
  /** Single-app dashboard mode. */
  applicationId?: string;
  applicationName?: string;
  environment?: 'Production' | 'Development' | string;
};

type Bucket = {
  appId: string;
  appName: string;
  items: AppRecordRow[];
  openCount: number;
  closedCount: number;
  rejectedCount: number;
  error?: string;
};

function formatWhen(value: string | null | undefined): string {
  if (!value) return '';
  try {
    return new Date(value).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return '';
  }
}

function formatAmount(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '';
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
}

function primaryLine(row: AppRecordRow): string {
  return String(row.subject || row.current_step || row.entity || '').trim();
}

function metaBits(row: AppRecordRow): string[] {
  const bits: string[] = [];
  const entity = String(row.entity || '').trim();
  const step = String(row.current_step || '').trim();
  const when = formatWhen(row.created_at);
  const amount = formatAmount(row.amount);
  if (entity && entity !== primaryLine(row)) bits.push(entity);
  if (step && step !== primaryLine(row) && step !== entity) bits.push(step);
  if (when) bits.push(when);
  if (amount) bits.push(amount);
  return bits;
}

/**
 * Expanded panel: compact work list for a user (assigned or requester).
 * Shows request id + title + a few key fields — no status chips, no horizontal scroll.
 */
export default function UserWorkExpandPanel({
  userName,
  email,
  applications,
  applicationId,
  applicationName,
  environment = 'Production',
}: Props) {
  const [loading, setLoading] = useState(true);
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const apps: AppRef[] = applicationId
      ? [{ application_id: applicationId, application_name: applicationName || applicationId }]
      : (applications || []).filter((a) => a.application_id);

    if (!apps.length || !userName) {
      setLoading(false);
      setBuckets([]);
      return;
    }

    setLoading(true);
    setError('');

    void (async () => {
      const limited = apps.slice(0, 5);
      const next: Bucket[] = [];
      for (const app of limited) {
        try {
          const byAssigned = await loadApplicationRecords({
            applicationId: app.application_id,
            environment,
            assigned: userName,
            limit: 40,
            offset: 0,
          });
          let items = byAssigned.ok ? byAssigned.data.items || [] : [];
          if (!items.length) {
            const byRequester = await loadApplicationRecords({
              applicationId: app.application_id,
              environment,
              requester: userName,
              limit: 40,
              offset: 0,
            });
            items = byRequester.ok ? byRequester.data.items || [] : [];
            if (!byAssigned.ok && !byRequester.ok) {
              next.push({
                appId: app.application_id,
                appName: app.application_name || app.application_id,
                items: [],
                openCount: 0,
                closedCount: 0,
                rejectedCount: 0,
                error: byAssigned.ok === false ? byAssigned.error : (byRequester as { error?: string }).error,
              });
              continue;
            }
          }
          const needle = userName.toLowerCase();
          const emailNeedle = String(email || '').toLowerCase();
          const filtered = items.filter((r) => {
            const a = String(r.assigned_to || '').toLowerCase();
            const req = String(r.requested_by || '').toLowerCase();
            return (
              a.includes(needle) ||
              req.includes(needle) ||
              (emailNeedle && (a.includes(emailNeedle) || req.includes(emailNeedle)))
            );
          });
          const useRows = filtered.length ? filtered : items;
          const open = useRows.filter((r) => String(r.status || '').toLowerCase() === 'open');
          const closed = useRows.filter((r) => String(r.status || '').toLowerCase() === 'closed');
          const rejected = useRows.filter((r) => String(r.status || '').toLowerCase() === 'rejected');
          // Prefer open items first, then recent closed — keep list short.
          const ordered = [...open, ...rejected, ...closed].slice(0, 10);
          next.push({
            appId: app.application_id,
            appName: app.application_name || app.application_id,
            items: ordered,
            openCount: open.length,
            closedCount: closed.length,
            rejectedCount: rejected.length,
          });
        } catch (err) {
          next.push({
            appId: app.application_id,
            appName: app.application_name || app.application_id,
            items: [],
            openCount: 0,
            closedCount: 0,
            rejectedCount: 0,
            error: err instanceof Error ? err.message : 'Failed to load',
          });
        }
      }
      if (!cancelled) {
        setBuckets(next);
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userName, email, applicationId, applicationName, environment, applications]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-4 py-3 text-xs text-slate-500">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-[#3977BE]" />
        Loading work items…
      </div>
    );
  }

  if (error) {
    return <div className="px-4 py-3 text-xs text-[#B24E66]">{error}</div>;
  }

  if (!buckets.length) {
    return <div className="px-4 py-3 text-xs text-slate-500">No applications linked for detail view.</div>;
  }

  return (
    <div className="overflow-hidden bg-[#F7F9FC] px-3 py-2.5 sm:px-4">
      {buckets.map((b) => (
        <div key={b.appId} className="overflow-hidden rounded-xl border border-[#E6EBF2] bg-white">
          <div className="flex items-center justify-between gap-3 border-b border-[#EEF2F7] px-3 py-2">
            <p className="min-w-0 truncate text-xs font-semibold text-slate-800">{b.appName}</p>
            <p className="shrink-0 text-[10px] tabular-nums text-slate-500">
              {b.openCount} open · {b.closedCount} closed
              {b.rejectedCount ? ` · ${b.rejectedCount} rejected` : ''}
            </p>
          </div>
          {b.error ? (
            <p className="px-3 py-2 text-[11px] text-[#B24E66]">{b.error}</p>
          ) : b.items.length === 0 ? (
            <p className="px-3 py-2.5 text-[11px] text-slate-400">No work items for this user.</p>
          ) : (
            <ul className="divide-y divide-[#EEF2F7]">
              {b.items.map((row) => {
                const title = primaryLine(row);
                const bits = metaBits(row);
                return (
                  <li key={row.id} className="px-3 py-2">
                    <div className="flex min-w-0 items-start gap-2.5">
                      <span className="mt-0.5 shrink-0 rounded-md bg-[#EEF3FA] px-1.5 py-0.5 font-mono text-[10px] font-semibold leading-none text-slate-700 ring-1 ring-[#D7E2EF]">
                        {row.request_id || row.id || '—'}
                      </span>
                      <div className="min-w-0 flex-1 overflow-hidden">
                        <p className="truncate text-[12px] font-medium leading-snug text-slate-800">
                          {title || 'Untitled request'}
                        </p>
                        {bits.length ? (
                          <p className="mt-0.5 truncate text-[10px] leading-snug text-slate-500">
                            {bits.join(' · ')}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}
