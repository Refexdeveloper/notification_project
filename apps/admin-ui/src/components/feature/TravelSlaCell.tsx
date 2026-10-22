import { travelSlaDisplay } from '@/lib/travelRecordDisplay';
import type { AppRecordRow } from '@/services/appRecordsApi';

export default function TravelSlaCell({ row }: { row: AppRecordRow }) {
  const sla = travelSlaDisplay(row);
  if (sla.state === 'none') return <>—</>;
  const tone = sla.state === 'breached'
    ? 'border-rose-200 bg-rose-50 text-rose-700'
    : 'border-emerald-200 bg-emerald-50 text-emerald-700';
  return (
    <span className="inline-flex flex-col items-end gap-0.5">
      <span className={`inline-flex rounded-md border px-1.5 py-0.5 text-[11px] font-semibold ${tone}`}>
        {sla.primary}
      </span>
      {sla.sub ? <span className="text-[11px] font-medium tabular-nums text-slate-500">{sla.sub}</span> : null}
    </span>
  );
}
