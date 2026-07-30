import { useEffect, useMemo, useState } from 'react';
import type { KissflowApplication } from '@/mocks/applications';
import { getHistoryByAppId } from '@/mocks/executions';
import { isBackendApiMode } from '@/services/backendApi';
import { loadHistoryFromBackend, type BackendHistoryItem } from '@/services/historyApi';

interface HistoryTabProps {
  app: KissflowApplication;
}

type LegacyStatus = 'all' | 'delivered' | 'opened' | 'failed' | 'bounced' | 'pending';
type BackendStatus = 'all' | 'completed' | 'partial' | 'failed' | 'running';

function statusClass(status: string): string {
  if (status === 'completed' || status === 'delivered' || status === 'opened') {
    return 'bg-accent-50 text-accent-700';
  }
  if (status === 'failed' || status === 'bounced') {
    return 'bg-red-50 text-red-700';
  }
  return 'bg-background-100 text-foreground-600';
}

export default function HistoryTab({ app }: HistoryTabProps) {
  const backendMode = isBackendApiMode();
  const [search, setSearch] = useState('');
  const [legacyStatus, setLegacyStatus] = useState<LegacyStatus>('all');
  const [backendStatus, setBackendStatus] = useState<BackendStatus>('all');
  const [loading, setLoading] = useState(backendMode);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [backendItems, setBackendItems] = useState<BackendHistoryItem[]>([]);
  const [snapshotCount, setSnapshotCount] = useState(0);
  const [reportCount, setReportCount] = useState(0);

  useEffect(() => {
    if (!backendMode) return;
    let cancelled = false;
    setLoading(true);
    loadHistoryFromBackend(app).then((result) => {
      if (cancelled) return;
      setBackendItems(result.items);
      setSnapshotCount(result.snapshotCount);
      setReportCount(result.reportCount);
      setLoadError(result.error || null);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [app, backendMode]);

  const legacyList = useMemo(() => {
    return getHistoryByAppId(app.id).filter((h) => {
      const matchStatus = legacyStatus === 'all' || h.status === legacyStatus;
      const q = search.toLowerCase();
      const matchSearch =
        !q ||
        h.subject.toLowerCase().includes(q) ||
        h.recipient.toLowerCase().includes(q) ||
        h.templateName.toLowerCase().includes(q);
      return matchStatus && matchSearch;
    });
  }, [app.id, search, legacyStatus]);

  const backendList = useMemo(() => {
    return backendItems.filter((item) => {
      const matchStatus = backendStatus === 'all' || item.status === backendStatus;
      const q = search.toLowerCase();
      const matchSearch =
        !q ||
        item.title.toLowerCase().includes(q) ||
        item.subtitle.toLowerCase().includes(q) ||
        item.process_id.toLowerCase().includes(q) ||
        item.detail.toLowerCase().includes(q);
      return matchStatus && matchSearch;
    });
  }, [backendItems, search, backendStatus]);

  if (backendMode) {
    return (
      <div>
        <p className="text-sm text-foreground-500 mb-4">
          Ingestion snapshot runs from PostgreSQL
          {reportCount > 0 ? ` · ${reportCount} email report run(s)` : ''}
          {snapshotCount > 0 ? ` · ${snapshotCount} ingestion run(s)` : ''}
        </p>

        {loadError && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {loadError}
          </div>
        )}

        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <div className="relative flex-1 max-w-sm">
            <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-sm text-foreground-400"></i>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search run id, process..."
              className="w-full h-9 pl-9 pr-3 text-sm rounded-lg border border-background-300/60 outline-none focus:border-primary-300"
            />
          </div>
          <div className="flex items-center bg-background-100 rounded-lg p-0.5 flex-wrap">
            {(
              [
                ['all', 'All'],
                ['completed', 'Completed'],
                ['partial', 'Partial'],
                ['failed', 'Failed'],
                ['running', 'Running'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setBackendStatus(value)}
                className={`h-7 px-2.5 rounded-md text-xs font-medium cursor-pointer ${
                  backendStatus === value ? 'bg-white shadow-sm text-foreground-900' : 'text-foreground-500'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="bg-white border border-background-300/60 rounded-xl overflow-hidden">
          <div className="hidden md:grid grid-cols-[1.4fr_1fr_100px_90px_120px] gap-2 px-4 py-2.5 border-b border-background-200/70 text-[11px] font-medium text-foreground-400 uppercase tracking-wide">
            <span>Run</span>
            <span>Records</span>
            <span>Type</span>
            <span>Status</span>
            <span>When</span>
          </div>
          {loading ? (
            <div className="px-4 py-10 text-center text-sm text-foreground-500">Loading history…</div>
          ) : (
            backendList.map((item) => (
              <div
                key={item.id}
                className="grid grid-cols-1 md:grid-cols-[1.4fr_1fr_100px_90px_120px] gap-1 md:gap-2 px-4 py-3 border-b border-background-100 last:border-0 hover:bg-background-50"
              >
                <div className="min-w-0">
                  <p className="text-sm text-foreground-900 truncate">{item.title}</p>
                  <p className="text-[11px] text-foreground-400 truncate">{item.subtitle}</p>
                </div>
                <p className="text-xs text-foreground-600 truncate">{item.detail}</p>
                <p className="text-xs text-foreground-500 capitalize">{item.kind}</p>
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium capitalize w-fit h-fit ${statusClass(item.status)}`}>
                  {item.status}
                </span>
                <p className="text-[11px] text-foreground-400">
                  {new Date(item.occurred_at).toLocaleString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </p>
              </div>
            ))
          )}
          {!loading && backendList.length === 0 && (
            <div className="px-4 py-10 text-center text-sm text-foreground-500">No ingestion or delivery history yet</div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-sm text-foreground-400"></i>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by subject, recipient..."
            className="w-full h-9 pl-9 pr-3 text-sm rounded-lg border border-background-300/60 outline-none focus:border-primary-300"
          />
        </div>
        <div className="flex items-center bg-background-100 rounded-lg p-0.5 flex-wrap">
          {(['all', 'delivered', 'opened', 'failed', 'bounced', 'pending'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setLegacyStatus(s)}
              className={`h-7 px-2.5 rounded-md text-xs font-medium capitalize cursor-pointer ${
                legacyStatus === s ? 'bg-white shadow-sm text-foreground-900' : 'text-foreground-500'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white border border-background-300/60 rounded-xl overflow-hidden">
        <div className="hidden md:grid grid-cols-[1.4fr_1fr_100px_90px_120px] gap-2 px-4 py-2.5 border-b border-background-200/70 text-[11px] font-medium text-foreground-400 uppercase tracking-wide">
          <span>Subject</span>
          <span>Recipient</span>
          <span>Channel</span>
          <span>Status</span>
          <span>Sent</span>
        </div>
        {legacyList.map((item) => (
          <div
            key={item.id}
            className="grid grid-cols-1 md:grid-cols-[1.4fr_1fr_100px_90px_120px] gap-1 md:gap-2 px-4 py-3 border-b border-background-100 last:border-0 hover:bg-background-50"
          >
            <div className="min-w-0">
              <p className="text-sm text-foreground-900 truncate">{item.subject}</p>
              <p className="text-[11px] text-foreground-400">{item.templateName}</p>
            </div>
            <p className="text-xs text-foreground-600 truncate">{item.recipient}</p>
            <p className="text-xs text-foreground-500 capitalize">{item.channel.replace('_', ' ')}</p>
            <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium capitalize w-fit h-fit ${statusClass(item.status)}`}>
              {item.status}
            </span>
            <p className="text-[11px] text-foreground-400">
              {new Date(item.sentAt).toLocaleString('en-US', {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </p>
          </div>
        ))}
        {legacyList.length === 0 && (
          <div className="px-4 py-10 text-center text-sm text-foreground-500">No notification history</div>
        )}
      </div>
    </div>
  );
}
