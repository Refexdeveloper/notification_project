import { displayDashCount } from '@/lib/dashboardEmpty';
import { NE_TYPE } from '@/lib/neDashType';
import {
  ITSM_SOURCE_CHANNELS,
  sourceChannelTotal,
  sourceCountsFromBreakdown,
  type SourceBreakdownRow,
} from '@/lib/itsmSourceBreakdown';

function SourcePanel({
  title,
  subtitle,
  accent,
  rows,
}: {
  title: string;
  subtitle: string;
  accent: string;
  rows?: SourceBreakdownRow[] | null;
}) {
  const counts = sourceCountsFromBreakdown(rows);
  const total = sourceChannelTotal(counts);
  return (
    <div className="ne-list-card overflow-hidden rounded-2xl border border-white/80 bg-white p-4 shadow-[0_8px_24px_-12px_rgba(15,23,42,0.12)] sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
            {title}
          </p>
          <p className={`mt-0.5 ${NE_TYPE.meta}`}>{subtitle}</p>
        </div>
        <p className="text-xl font-extrabold tabular-nums tracking-tight text-slate-900 sm:text-2xl">
          {displayDashCount(total).toLocaleString('en-IN')}
        </p>
      </div>
      <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-slate-100">
        {ITSM_SOURCE_CHANNELS.map((channel) => {
          const n = counts[channel.id];
          const width = total > 0 ? (n / total) * 100 : 0;
          if (width <= 0) return null;
          return (
            <span
              key={channel.id}
              className="h-full"
              style={{ width: `${width}%`, background: channel.tone }}
              title={`${channel.id} ${n.toLocaleString('en-IN')}`}
            />
          );
        })}
        {total === 0 ? (
          <span className="h-full w-full" style={{ background: accent, opacity: 0.25 }} />
        ) : null}
      </div>
      <ul className="mt-3 space-y-2">
        {ITSM_SOURCE_CHANNELS.map((channel) => {
          const n = counts[channel.id];
          const pct = total > 0 ? Math.round((n / total) * 1000) / 10 : 0;
          return (
            <li key={channel.id} className="flex items-center gap-2 text-sm">
              <i className="h-2 w-2 shrink-0 rounded-full" style={{ background: channel.tone }} />
              <span className="min-w-0 flex-1 truncate font-medium text-slate-600">{channel.id}</span>
              <span className="tabular-nums font-semibold text-slate-800">
                {displayDashCount(n).toLocaleString('en-IN')}
              </span>
              <span className="w-12 text-right tabular-nums text-slate-400">
                {pct.toLocaleString('en-IN', { maximumFractionDigits: 1 })}%
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default function ItsmSourceBreakdown({
  all,
  today,
}: {
  all?: SourceBreakdownRow[] | null;
  today?: SourceBreakdownRow[] | null;
}) {
  return (
    <div className="space-y-2">
      <div>
        <p className={NE_TYPE.sectionTitle}>
          Ticket source
        </p>
        <p className={`mt-0.5 ${NE_TYPE.meta}`}>
          How tickets arrived — All tickets vs Today open tickets
        </p>
      </div>
      <div className="grid grid-cols-1 items-stretch gap-2.5 sm:gap-4 md:grid-cols-2 md:gap-5">
        <SourcePanel
          title="All tickets — by source"
          subtitle="All tickets"
          accent="#2B5AED"
          rows={all}
        />
        <SourcePanel
          title="Today open tickets — by source"
          subtitle="Opened today by source"
          accent="#F97316"
          rows={today}
        />
      </div>
    </div>
  );
}
