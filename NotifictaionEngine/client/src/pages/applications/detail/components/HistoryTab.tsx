import { useMemo, useState } from 'react';
import type { KissflowApplication } from '@/mocks/applications';
import { getHistoryByAppId } from '@/mocks/executions';

interface HistoryTabProps {
  app: KissflowApplication;
}

export default function HistoryTab({ app }: HistoryTabProps) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'all' | 'delivered' | 'opened' | 'failed' | 'bounced' | 'pending'>('all');

  const list = useMemo(() => {
    return getHistoryByAppId(app.id).filter((h) => {
      const matchStatus = status === 'all' || h.status === status;
      const q = search.toLowerCase();
      const matchSearch =
        !q ||
        h.subject.toLowerCase().includes(q) ||
        h.recipient.toLowerCase().includes(q) ||
        h.templateName.toLowerCase().includes(q);
      return matchStatus && matchSearch;
    });
  }, [app.id, search, status]);

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
              onClick={() => setStatus(s)}
              className={`h-7 px-2.5 rounded-md text-xs font-medium capitalize cursor-pointer ${
                status === s ? 'bg-white shadow-sm text-foreground-900' : 'text-foreground-500'
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
        {list.map((item) => (
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
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded font-medium capitalize w-fit h-fit ${
                item.status === 'opened' || item.status === 'delivered'
                  ? 'bg-accent-50 text-accent-700'
                  : item.status === 'failed' || item.status === 'bounced'
                    ? 'bg-red-50 text-red-700'
                    : 'bg-background-100 text-foreground-600'
              }`}
            >
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
        {list.length === 0 && (
          <div className="px-4 py-10 text-center text-sm text-foreground-500">No notification history</div>
        )}
      </div>
    </div>
  );
}
