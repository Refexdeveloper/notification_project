import { useMemo, useState } from 'react';
import type { KissflowApplication } from '@/mocks/applications';
import { getExecutionsByAppId, type ExecutionStatus } from '@/mocks/executions';

interface ExecutionsTabProps {
  app: KissflowApplication;
}

const statusStyle: Record<ExecutionStatus, string> = {
  success: 'bg-accent-50 text-accent-700',
  failed: 'bg-red-50 text-red-700',
  running: 'bg-primary-50 text-primary-700',
  queued: 'bg-background-100 text-foreground-600',
  retrying: 'bg-amber-50 text-amber-700',
};

export default function ExecutionsTab({ app }: ExecutionsTabProps) {
  const [status, setStatus] = useState<'all' | ExecutionStatus>('all');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const list = useMemo(() => {
    return getExecutionsByAppId(app.id).filter((e) => {
      const matchStatus = status === 'all' || e.status === status;
      const q = search.toLowerCase();
      const matchSearch =
        !q ||
        e.schedulerName.toLowerCase().includes(q) ||
        e.templateName.toLowerCase().includes(q) ||
        e.resourceName.toLowerCase().includes(q) ||
        e.id.toLowerCase().includes(q);
      return matchStatus && matchSearch;
    });
  }, [app.id, status, search]);

  return (
    <div>
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-sm text-foreground-400"></i>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search executions..."
            className="w-full h-9 pl-9 pr-3 text-sm rounded-lg border border-background-300/60 outline-none focus:border-primary-300"
          />
        </div>
        <div className="flex items-center bg-background-100 rounded-lg p-0.5 flex-wrap">
          {(['all', 'success', 'failed', 'retrying', 'running', 'queued'] as const).map((s) => (
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
        <div className="grid grid-cols-[1fr_120px_100px_90px_40px] gap-2 px-4 py-2.5 border-b border-background-200/70 text-[11px] font-medium text-foreground-400 uppercase tracking-wide">
          <span>Execution</span>
          <span>Status</span>
          <span>Duration</span>
          <span>Started</span>
          <span />
        </div>
        {list.map((exec) => (
          <div key={exec.id} className="border-b border-background-100 last:border-0">
            <button
              onClick={() => setExpanded(expanded === exec.id ? null : exec.id)}
              className="w-full grid grid-cols-[1fr_120px_100px_90px_40px] gap-2 px-4 py-3 text-left hover:bg-background-50 cursor-pointer items-center"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground-900 truncate">{exec.schedulerName}</p>
                <p className="text-[11px] text-foreground-400 truncate">
                  {exec.id} · {exec.templateName} · {exec.resourceName}
                </p>
              </div>
              <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium capitalize w-fit ${statusStyle[exec.status]}`}>
                {exec.status}
              </span>
              <span className="text-xs text-foreground-600">
                {exec.durationMs != null ? `${(exec.durationMs / 1000).toFixed(1)}s` : '—'}
              </span>
              <span className="text-[11px] text-foreground-400">
                {new Date(exec.startedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
              </span>
              <i className={`ri-arrow-down-s-line text-foreground-400 transition-transform ${expanded === exec.id ? 'rotate-180' : ''}`}></i>
            </button>
            {expanded === exec.id && (
              <div className="px-4 pb-3 bg-background-50/80">
                <div className="rounded-lg border border-background-200/70 bg-white p-3 text-xs space-y-2">
                  <div className="flex justify-between gap-4">
                    <span className="text-foreground-500">Recipients</span>
                    <span className="text-foreground-800 text-right">{exec.recipients.join(', ')}</span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-foreground-500">Retries</span>
                    <span className="text-foreground-800">{exec.retryCount}</span>
                  </div>
                  {exec.errorMessage && (
                    <div className="mt-2 p-2.5 rounded-md bg-red-50 border border-red-100 text-red-700 font-mono text-[11px]">
                      {exec.errorMessage}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
        {list.length === 0 && (
          <div className="px-4 py-10 text-center text-sm text-foreground-500">No executions found</div>
        )}
      </div>
    </div>
  );
}
