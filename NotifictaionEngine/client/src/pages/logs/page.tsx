import Layout from '@/components/feature/Layout';
import { executions } from '@/mocks/executions';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Activity, ChevronDown, Search } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { GlassCard } from '@/components/ui/GlassCard';

export default function LogsPage() {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const list = useMemo(() => {
    const q = search.toLowerCase();
    return executions.filter(
      (e) =>
        !q ||
        e.id.toLowerCase().includes(q) ||
        e.schedulerName.toLowerCase().includes(q) ||
        e.templateName.toLowerCase().includes(q) ||
        (e.errorMessage || '').toLowerCase().includes(q),
    );
  }, [search]);

  return (
    <Layout breadcrumbs={[{ label: 'Applications', path: '/applications' }, { label: 'Activity' }]}>
      <div className="mb-7 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="page-title">Activity</h1>
          <p className="page-subtitle">Timeline of runs, successes, and errors.</p>
        </div>
        <Button variant="secondary" onClick={() => navigate('/applications')}>
          Browse applications
        </Button>
      </div>

      <div className="max-w-sm mb-5">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search activity…"
          leftSlot={<Search className="w-4 h-4" />}
        />
      </div>

      {list.length === 0 ? (
        <EmptyState
          variant="activity"
          title="No activity yet"
          description="When schedules run or sends complete, you'll see a polished timeline of every event here."
          primaryLabel="Go to applications"
          onPrimary={() => navigate('/applications')}
        />
      ) : (
        <div className="relative space-y-3 pl-4">
          <div className="absolute left-[7px] top-2 bottom-2 w-px bg-gradient-to-b from-primary-200 via-primary-100 to-transparent" />
          {list.map((exec) => (
            <div
              key={exec.id}
              className="relative"
            >
              <span
                className={`absolute -left-4 top-5 w-3.5 h-3.5 rounded-full border-2 border-white shadow ${
                  exec.status === 'success'
                    ? 'bg-accent-500'
                    : exec.status === 'failed'
                      ? 'bg-red-500'
                      : 'bg-secondary-500'
                }`}
              />
              <GlassCard className="ml-4 overflow-hidden p-0">
                <button
                  type="button"
                  onClick={() => setExpanded(expanded === exec.id ? null : exec.id)}
                  className="w-full px-4 py-3.5 flex items-center gap-3 text-left hover:bg-background-50/80 cursor-pointer"
                >
                  <span className="icon-well shrink-0">
                    <Activity className="w-4 h-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-foreground-900 truncate">{exec.schedulerName}</p>
                    <p className="text-xs text-foreground-400 truncate">
                      {exec.id} · {exec.templateName}
                    </p>
                  </div>
                  <span
                    className={
                      exec.status === 'success'
                        ? 'chip-success capitalize'
                        : exec.status === 'failed'
                          ? 'chip-danger capitalize'
                          : 'chip-warn capitalize'
                    }
                  >
                    {exec.status}
                  </span>
                  <ChevronDown
                    className={`w-4 h-4 text-foreground-400 transition-transform ${expanded === exec.id ? 'rotate-180' : ''}`}
                  />
                </button>
                {expanded === exec.id && (
                  <div className="overflow-hidden border-t border-background-100 px-4 py-3 text-xs text-foreground-600 space-y-1">
                    <p>Recipients: {exec.recipients.join(', ') || '—'}</p>
                    <p>Started: {new Date(exec.startedAt).toLocaleString()}</p>
                    {exec.errorMessage && <p className="text-red-600 font-medium">{exec.errorMessage}</p>}
                  </div>
                )}
              </GlassCard>
            </div>
          ))}
        </div>
      )}
    </Layout>
  );
}
