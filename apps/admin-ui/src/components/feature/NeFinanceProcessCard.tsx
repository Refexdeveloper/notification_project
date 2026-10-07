import type { LucideIcon } from 'lucide-react';
import { EMBED_KPI_THEMES } from '@/components/feature/EmbedKpiCard';
import { formatInr, formatInrExact } from '@/lib/dashboardEmpty';
import { NE_TYPE } from '@/lib/neDashType';

export type FinancePackMetric = {
  label: string;
  value: number;
  format?: 'count' | 'inr';
  hint?: string;
  active?: boolean;
  onClick?: () => void;
};

type Props = {
  title: string;
  hint?: string;
  icon: LucideIcon;
  styleIndex?: number;
  metrics: FinancePackMetric[];
  facts?: string[];
};

function metricText(metric: FinancePackMetric): string {
  if (metric.format === 'inr') return formatInr(metric.value);
  return Number(metric.value || 0).toLocaleString('en-IN');
}

/**
 * Full-width Travel / Expense process card — title + every related metric packed inside.
 * Click handlers stay optional so Open/Closed/Today filters are unchanged.
 */
export default function NeFinanceProcessCard({
  title,
  hint,
  icon: Icon,
  styleIndex = 0,
  metrics,
  facts = [],
}: Props) {
  const theme = EMBED_KPI_THEMES[styleIndex % EMBED_KPI_THEMES.length];
  const cols = Math.min(4, Math.max(2, metrics.length));

  return (
    <article
      className="ne-kpi-card ne-finance-pack overflow-hidden rounded-2xl border bg-white"
      style={{
        borderColor: theme.border,
        boxShadow: '0 10px 28px -14px rgba(15,23,42,0.16)',
      }}
    >
      <div
        className="flex items-center justify-between gap-3 border-b px-4 py-3 sm:px-5"
        style={{
          background: `linear-gradient(90deg, ${theme.bg} 0%, #ffffff 62%)`,
          borderColor: theme.border,
        }}
      >
        <div className="min-w-0">
          <p className={NE_TYPE.sectionTitle}>{title}</p>
          {hint ? <p className={`mt-0.5 ${NE_TYPE.meta}`}>{hint}</p> : null}
        </div>
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white shadow-sm"
          style={{ backgroundColor: `${theme.iconBg}8c` }}
        >
          <Icon className="h-4.5 w-4.5" strokeWidth={2.25} />
        </div>
      </div>

      <div
        className={`grid grid-cols-2 ${
          cols === 3 ? 'lg:grid-cols-3' : cols >= 4 ? 'lg:grid-cols-4' : 'lg:grid-cols-2'
        }`}
      >
        {metrics.map((metric, index) => {
          const interactive = Boolean(metric.onClick);
          const color = EMBED_KPI_THEMES[index % EMBED_KPI_THEMES.length].value;
          return (
            <button
              key={metric.label}
              type="button"
              disabled={!interactive}
              onClick={metric.onClick}
              className={`min-w-0 border-t px-4 py-3.5 text-left sm:px-5 ${
                interactive ? 'cursor-pointer hover:bg-slate-50/80' : 'cursor-default'
              } ${metric.active ? 'bg-[#EAF2FF] ring-2 ring-inset ring-[#1E88E5]/35' : ''}`}
              style={{ borderColor: theme.border }}
            >
              <p className={NE_TYPE.kpiLabel}>{metric.label}</p>
              <p
                className={`mt-1.5 ${NE_TYPE.kpiValue}`}
                style={{ color }}
                title={metric.format === 'inr' ? formatInrExact(metric.value) : undefined}
              >
                {metricText(metric)}
              </p>
              {metric.hint ? <p className={NE_TYPE.kpiSub}>{metric.hint}</p> : null}
            </button>
          );
        })}
      </div>

      {facts.length ? (
        <div
          className="flex flex-wrap gap-1.5 border-t px-4 py-2.5 sm:px-5"
          style={{ borderColor: theme.border, background: theme.bg }}
        >
          {facts.map((fact) => (
            <span
              key={fact}
              className={`rounded-full bg-white/80 px-2.5 py-1 ${NE_TYPE.meta} ring-1 ring-slate-200/80`}
            >
              {fact}
            </span>
          ))}
        </div>
      ) : null}
    </article>
  );
}
