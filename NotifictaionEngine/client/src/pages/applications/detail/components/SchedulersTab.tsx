import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarClock, Plus } from 'lucide-react';
import type { KissflowApplication } from '@/mocks/applications';
import {
  createScheduler,
  describeCadence,
  getSchedulersByAppId,
} from '@/stores/reportSchedulers';
import { getTemplatesByAppId } from '@/stores/reportTemplates';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';

interface SchedulersTabProps {
  app: KissflowApplication;
}

export default function SchedulersTab({ app }: SchedulersTabProps) {
  const navigate = useNavigate();
  const [tick, setTick] = useState(0);
  const list = useMemo(() => {
    void tick;
    return getSchedulersByAppId(app.id);
  }, [app.id, tick]);

  const handleCreate = () => {
    const templates = getTemplatesByAppId(app.id);
    const published = templates.find((t) => t.status === 'published') || templates[0];
    if (!published) {
      navigate(`/applications/${app.id}?tab=templates`);
      return;
    }
    const sch = createScheduler({
      applicationId: app.id,
      name: `${app.displayName || app.name} schedule`,
      templateId: published.id,
      templateName: published.name,
      cadence: { type: 'daily', time: '09:00' },
    });
    setTick((n) => n + 1);
    navigate(`/schedulers/${sch.id}`);
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-4">
        <p className="text-sm text-foreground-500">
          Bind a template for this app to a cadence and recipients.
        </p>
        <Button size="sm" onClick={handleCreate} leftIcon={<Plus className="w-4 h-4" />}>
          New schedule
        </Button>
      </div>

      {list.length === 0 ? (
        <EmptyState
          variant="schedules"
          title="No schedules for this app"
          description="Publish an HTML template first, then schedule it to chosen people."
          primaryLabel="New schedule"
          onPrimary={handleCreate}
        />
      ) : (
        <div className="space-y-2">
          {list.map((sch) => (
            <button
              key={sch.id}
              type="button"
              onClick={() => navigate(`/schedulers/${sch.id}`)}
              className="surface w-full p-4 text-left flex items-center gap-3 hover:border-primary-300/70 cursor-pointer"
            >
              <span className="icon-well">
                <CalendarClock className="w-4 h-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-semibold text-foreground-900 truncate">{sch.name}</h4>
                  <span
                    className={
                      sch.status === 'active'
                        ? 'chip-success'
                        : sch.status === 'paused'
                          ? 'chip-warn'
                          : 'chip-muted'
                    }
                  >
                    {sch.status}
                  </span>
                </div>
                <p className="text-xs text-foreground-500 mt-0.5">
                  {describeCadence(sch.cadence)} · {sch.templateName} · {sch.recipients.length} recipients
                </p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
