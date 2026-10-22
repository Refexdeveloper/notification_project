import type { LucideIcon } from 'lucide-react';
import EmbedKpiCard, { EMBED_KPI_THEMES, NE_KPI_GRID_CLASS } from '@/components/feature/EmbedKpiCard';
import type { NeAppKind } from '@/lib/neKpiIcons';
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
  appKind?: NeAppKind;
};

/**
 * Travel / Expense full-row pack — section header + EmbedKpiCard 4-up.
 * Same cards as the top KPI row (embed + main). Click / amount / filter props stay on the caller.
 */
export default function NeFinanceProcessCard({
  title,
  hint,
  icon: Icon,
  styleIndex = 0,
  metrics,
  appKind,
}: Props) {
  const theme = EMBED_KPI_THEMES[styleIndex % EMBED_KPI_THEMES.length];
  const packTotal = /^total/i.test(String(metrics[0]?.label || ''))
    ? Number(metrics[0]?.value)
    : undefined;
  const shareOf = Number.isFinite(packTotal) && (packTotal || 0) > 0 ? packTotal : undefined;

  return (
    <section className="ne-finance-pack space-y-2.5">
      <div className="flex items-center justify-between gap-3">
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

      <div className={NE_KPI_GRID_CLASS}>
        {metrics.map((metric, index) => (
          <EmbedKpiCard
            key={metric.label}
            label={metric.label}
            value={metric.value}
            sub={metric.hint}
            valueFormat={metric.format === 'inr' ? 'inr' : 'count'}
            styleIndex={index}
            active={metric.active}
            onClick={metric.onClick}
            shareOf={shareOf}
            appKind={appKind}
            iconContext={title}
          />
        ))}
      </div>
    </section>
  );
}
