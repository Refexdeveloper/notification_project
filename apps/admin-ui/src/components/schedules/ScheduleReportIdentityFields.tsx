import type { KissflowApplication } from '@/mocks/applications';
import type { ReportTemplate } from '@/stores/reportTemplates';
import { LEAD_TRACKER_SALES_GROUPS } from '@/services/leadReport';

export type ScheduleReportIdentityValue = {
  templateId: string;
  templateName: string;
  processId: string;
  websiteFilter: string;
  userGroupFilter: string;
  subject: string;
};

interface ScheduleReportIdentityFieldsProps {
  app: KissflowApplication;
  templates: ReportTemplate[];
  value: ScheduleReportIdentityValue;
  onChange: (next: ScheduleReportIdentityValue) => void;
  disabled?: boolean;
}

function isLeadTrackerApp(app: KissflowApplication): boolean {
  const id = (app.appId || app.id || '').toLowerCase();
  const name = (app.displayName || app.name || '').toLowerCase();
  return id.includes('lead') || name.includes('lead tracker');
}

export default function ScheduleReportIdentityFields({
  app,
  templates,
  value,
  onChange,
  disabled = false,
}: ScheduleReportIdentityFieldsProps) {
  const processOptions = (app.processIds || []).filter(Boolean);
  const showLeadTrackerFilters = isLeadTrackerApp(app);

  const selectTemplate = (templateId: string) => {
    const tpl = templates.find((t) => t.id === templateId);
    onChange({
      ...value,
      templateId,
      templateName: tpl?.name || value.templateName,
      subject: tpl?.subject || tpl?.name || value.subject,
    });
  };

  return (
    <div className="rounded-lg border border-primary-200/70 bg-primary-50/40 px-4 py-4 space-y-3">
      <div>
        <h4 className="text-xs font-semibold text-foreground-900 uppercase tracking-wide">Report to send</h4>
        <p className="text-[11px] text-foreground-500 mt-0.5">
          Identifies which HTML template and process this schedule delivers. Required when multiple templates exist.
        </p>
      </div>

      <div>
        <label className="block text-xs font-semibold text-foreground-700 mb-1.5">HTML template</label>
        <select
          value={value.templateId}
          onChange={(e) => selectTemplate(e.target.value)}
          disabled={disabled}
          className="field-input w-full disabled:opacity-60"
        >
          {templates.length === 0 && <option value="">No templates — create one in Templates tab</option>}
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} ({t.status})
            </option>
          ))}
        </select>
        {value.templateId && (
          <p className="text-[11px] text-foreground-400 mt-1 font-mono truncate">Template ID: {value.templateId}</p>
        )}
      </div>

      <div>
        <label className="block text-xs font-semibold text-foreground-700 mb-1.5">Kissflow process</label>
        {processOptions.length > 0 ? (
          <select
            value={value.processId}
            onChange={(e) => onChange({ ...value, processId: e.target.value })}
            disabled={disabled}
            className="field-input w-full disabled:opacity-60 font-mono text-xs"
          >
            <option value="">— Select process —</option>
            {processOptions.map((pid) => (
              <option key={pid} value={pid}>
                {pid}
              </option>
            ))}
          </select>
        ) : (
          <input
            value={value.processId}
            onChange={(e) => onChange({ ...value, processId: e.target.value })}
            disabled={disabled}
            placeholder="e.g. Lead_tracker_1_A00"
            className="field-input w-full font-mono text-xs disabled:opacity-60"
          />
        )}
        <p className="text-[11px] text-foreground-400 mt-1">
          Process used to fetch report data when the schedule runs.
        </p>
      </div>

      <div>
        <label className="block text-xs font-semibold text-foreground-700 mb-1.5">Email subject</label>
        <input
          value={value.subject}
          onChange={(e) => onChange({ ...value, subject: e.target.value })}
          disabled={disabled}
          placeholder="Report subject line"
          className="field-input w-full text-sm disabled:opacity-60"
        />
      </div>

      {showLeadTrackerFilters && (
        <>
          <div>
            <label className="block text-xs font-semibold text-foreground-700 mb-1.5">
              Sales team (Kissflow group)
            </label>
            <select
              value={value.userGroupFilter}
              onChange={(e) => {
                const group = e.target.value;
                const match = LEAD_TRACKER_SALES_GROUPS.find((g) => g.groupName === group);
                onChange({
                  ...value,
                  userGroupFilter: group,
                  websiteFilter: match?.websiteFilter || value.websiteFilter,
                });
              }}
              disabled={disabled}
              className="field-input w-full disabled:opacity-60"
            >
              <option value="">— Select sales team —</option>
              {LEAD_TRACKER_SALES_GROUPS.map((g) => (
                <option key={g.slug} value={g.groupName}>
                  {g.groupName}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-foreground-700 mb-1.5">Website filter</label>
            <input
              value={value.websiteFilter}
              onChange={(e) => onChange({ ...value, websiteFilter: e.target.value })}
              disabled={disabled}
              placeholder="e.g. Refex Mobility"
              className="field-input w-full text-sm disabled:opacity-60"
            />
            <p className="text-[11px] text-foreground-400 mt-1">
              Filters leads by Website field before grouping by sales person.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
