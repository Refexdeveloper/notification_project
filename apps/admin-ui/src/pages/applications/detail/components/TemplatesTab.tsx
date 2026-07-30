import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mail, Plus } from 'lucide-react';
import type { KissflowApplication } from '@/mocks/applications';
import { getTemplatesByAppId } from '@/stores/reportTemplates';
import { createTemplate } from '@/stores/reportTemplates';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';

interface TemplatesTabProps {
  app: KissflowApplication;
}

export default function TemplatesTab({ app }: TemplatesTabProps) {
  const navigate = useNavigate();
  const [tick, setTick] = useState(0);
  const list = useMemo(() => {
    void tick;
    return getTemplatesByAppId(app.id);
  }, [app.id, tick]);

  const handleCreate = () => {
    const tpl = createTemplate({
      applicationId: app.id,
      name: `${app.displayName || app.name} report`,
      description: `HTML report for ${app.displayName || app.name}`,
    });
    setTick((n) => n + 1);
    navigate(`/templates/${tpl.id}`);
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-4">
        <p className="text-sm text-foreground-500">
          HTML report designs for this app only — create several, publish the best.
        </p>
        <Button size="sm" onClick={handleCreate} leftIcon={<Plus className="w-4 h-4" />}>
          New template
        </Button>
      </div>

      {list.length === 0 ? (
        <EmptyState
          variant="templates"
          title="No templates for this app"
          description="Design an HTML email report. You can make multiple versions and choose one in Schedules."
          primaryLabel="Create template"
          onPrimary={handleCreate}
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {list.map((tpl) => (
            <button
              key={tpl.id}
              type="button"
              onClick={() => navigate(`/templates/${tpl.id}`)}
              className="surface p-4 text-left hover:border-primary-300/70 cursor-pointer"
            >
              <div className="flex items-start gap-3">
                <span className="icon-well">
                  <Mail className="w-4 h-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h4 className="text-sm font-semibold text-foreground-900 truncate">{tpl.name}</h4>
                    <span
                      className={
                        tpl.status === 'published'
                          ? 'chip-success'
                          : tpl.status === 'draft'
                            ? 'chip-warn'
                            : 'chip-muted'
                      }
                    >
                      {tpl.status}
                    </span>
                  </div>
                  <p className="text-xs text-foreground-500 mt-0.5 line-clamp-2">
                    {tpl.description || tpl.subject}
                  </p>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
