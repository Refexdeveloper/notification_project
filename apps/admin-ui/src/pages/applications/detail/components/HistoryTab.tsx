import { useCallback, useEffect, useMemo, useState } from 'react';
import type { KissflowApplication } from '@/mocks/applications';
import { RefreshCw } from 'lucide-react';
import { getHistoryByAppId } from '@/mocks/executions';
import { isBackendApiMode } from '@/services/backendApi';
import { loadSendHistoryFromBackend, type SendHistoryRow } from '@/services/historyApi';

interface HistoryTabProps {
  app: KissflowApplication;
}

type LegacyStatus = 'all' | 'delivered' | 'opened' | 'failed' | 'bounced' | 'pending';
type SendStatus = 'all' | 'delivered' | 'failed' | 'pending';

function formatWhen(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  const time = date.toLocaleString('en-IN', { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return `Today, ${time}`;
  return date.toLocaleString('en-IN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function statusClass(status: string): string {
  if (status === 'delivered' || status === 'completed' || status === 'opened') {
    return 'bg-accent-50 text-accent-700';
  }
  if (status === 'failed' || status === 'bounced') {
    return 'bg-red-50 text-red-700';
  }
  return 'bg-background-100 text-foreground-600';
}

export default function HistoryTab({ app }: HistoryTabProps) {
  const backendMode = isBackendApiMode();
  const [legacyStatus, setLegacyStatus] = useState<LegacyStatus>('all');
  const [sendStatus, setSendStatus] = useState<SendStatus>('all');
  const [loading, setLoading] = useState(backendMode);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sendItems, setSendItems] = useState<SendHistoryRow[]>([]);

  const loadSends = useCallback(async () => {
    if (!backendMode) return;
    setLoading(true);
    setLoadError(null);
    const result = await loadSendHistoryFromBackend(app);
    setSendItems(result.items);
    setLoadError(result.error || null);
    setLoading(false);
  }, [app, backendMode]);

  useEffect(() => {
    void loadSends();
  }, [loadSends]);

  const legacyList = useMemo(() => {
    return getHistoryByAppId(app.id).filter((h) => legacyStatus === 'all' || h.status === legacyStatus);
  }, [app.id, legacyStatus]);

  const backendList = useMemo(() => {
    return sendItems.filter((item) => sendStatus === 'all' || item.status === sendStatus);
  }, [sendItems, sendStatus]);

  if (backendMode) {
    return (
      <div>
        <p className="text-sm text-foreground-500 mb-4">
          Scheduled report sends for {app.displayName || app.name} — application and send time only.
        </p>

        {loadError && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {loadError}
          </div>
        )}

        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <button
            type="button"
            onClick={() => void loadSends()}
            disabled={loading}
            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-background-300/60 bg-white px-2.5 text-xs font-medium text-foreground-600 cursor-pointer hover:bg-background-50 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <div className="flex items-center bg-background-100 rounded-lg p-0.5 flex-wrap">
            {(
              [
                ['all', 'All'],
                ['delivered', 'Delivered'],
                ['failed', 'Failed'],
                ['pending', 'Pending'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setSendStatus(value)}
                className={`h-7 px-2.5 rounded-md text-xs font-medium cursor-pointer ${
                  sendStatus === value ? 'bg-white shadow-sm text-foreground-900' : 'text-foreground-500'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="bg-white border border-background-300/60 rounded-xl overflow-hidden">
          <div className="hidden md:grid grid-cols-[1fr_100px_140px] gap-2 px-4 py-2.5 border-b border-background-200/70 text-[11px] font-medium text-foreground-400 uppercase tracking-wide">
            <span>Application</span>
            <span>Status</span>
            <span>Sent at</span>
          </div>
          {loading ? (
            <div className="px-4 py-10 text-center text-sm text-foreground-500">Loading history…</div>
          ) : (
            backendList.map((item) => (
              <div
                key={item.id}
                className="grid grid-cols-1 md:grid-cols-[1fr_100px_140px] gap-1 md:gap-2 px-4 py-3 border-b border-background-100 last:border-0 hover:bg-background-50 items-center"
              >
                <p className="text-sm text-foreground-900 truncate">{item.application_name}</p>
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium capitalize w-fit h-fit ${statusClass(item.status)}`}>
                  {item.status}
                </span>
                <p className="text-[11px] text-foreground-500">{formatWhen(item.sent_at)}</p>
              </div>
            ))
          )}
          {!loading && backendList.length === 0 && (
            <div className="px-4 py-10 text-center text-sm text-foreground-500">No scheduled sends yet</div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-4 flex-wrap">
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
            <p className="text-[11px] text-foreground-400">{formatWhen(item.sentAt)}</p>
          </div>
        ))}
        {legacyList.length === 0 && (
          <div className="px-4 py-10 text-center text-sm text-foreground-500">No notification history</div>
        )}
      </div>
    </div>
  );
}
