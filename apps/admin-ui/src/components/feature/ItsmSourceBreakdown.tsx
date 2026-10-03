import { displayDashCount } from '@/lib/dashboardEmpty';
import {
  ITSM_SOURCE_CHANNELS,
  sourceChannelTotal,
  sourceCountsFromBreakdown,
  type SourceBreakdownRow,
} from '@/lib/itsmSourceBreakdown';

function SourcePanel({
  title,
  subtitle,
  headerBg,
  headerColor,
  rows,
}: {
  title: string;
  subtitle: string;
  headerBg: string;
  headerColor: string;
  rows?: SourceBreakdownRow[] | null;
}) {
  const counts = sourceCountsFromBreakdown(rows);
  const total = sourceChannelTotal(counts);
  return (
    <div className="overflow-hidden rounded-xl border border-slate-100 bg-white shadow-[0_4px_18px_rgba(112,144,176,0.12)]">
      <div className="px-3.5 py-3" style={{ background: headerBg }}>
        <p className="text-[11px] font-bold uppercase tracking-[0.4px]" style={{ color: headerColor }}>
          {title}
        </p>
        <p className="mt-0.5 text-[11px] text-slate-500">
          {subtitle}
          {' · '}
          <span className="font-semibold text-slate-900">{displayDashCount(total)}</span>
        </p>
      </div>
      <table className="w-full text-sm">
        <tbody>
          {ITSM_SOURCE_CHANNELS.map((channel, index) => (
            <tr key={channel.id} className={index % 2 === 1 ? 'bg-slate-50/80' : 'bg-white'}>
              <td className="px-3.5 py-2.5 text-[12px] text-slate-700">
                <span
                  className="mr-2 inline-block h-2 w-2 rounded-full"
                  style={{ background: channel.tone }}
                />
                {channel.id}
              </td>
              <td className="px-3.5 py-2.5 text-right text-[13px] font-bold tabular-nums text-slate-900">
                {displayDashCount(counts[channel.id])}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {counts.Other > 0 ? (
        <p className="border-t border-slate-100 px-3.5 py-2 text-[11px] text-slate-400">
          Other / unmapped · <span className="font-semibold text-slate-600">{displayDashCount(counts.Other)}</span>
        </p>
      ) : null}
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
        <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-slate-400 sm:text-[11px] sm:tracking-[0.14em]">
          Ticket source
        </p>
        <p className="mt-0.5 text-[11px] text-slate-400">
          How tickets arrived — All tickets vs Today open tickets
        </p>
      </div>
      <div className="grid grid-cols-1 items-stretch gap-2.5 sm:gap-4 md:grid-cols-2 md:gap-5">
        <SourcePanel
          title="All tickets"
          subtitle="By source"
          headerBg="#f1f5f9"
          headerColor="#475569"
          rows={all}
        />
        <SourcePanel
          title="Today open tickets"
          subtitle="Opened today by source"
          headerBg="#fff7ed"
          headerColor="#9a7a3a"
          rows={today}
        />
      </div>
    </div>
  );
}
