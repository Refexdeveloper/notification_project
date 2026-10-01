import { useMemo, useState } from 'react';

const KPI_CHIPS = [
  { id: 'TotalLeads', label: 'Total' },
  { id: 'OpenLeads', label: 'Open' },
  { id: 'ClosedLeads', label: 'Closed' },
  { id: 'OpenedToday', label: 'Opened today' },
  { id: 'ClosedToday', label: 'Closed today' },
  { id: 'SignedInToday', label: 'Signed in today' },
  { id: 'TotalUsers', label: 'Users' },
];

const FILTER_CHIPS = [
  { id: 'CompanyName', label: 'Company / website' },
  { id: 'GroupName', label: 'Team / group' },
  { id: 'ReportDate', label: 'Report date' },
  { id: 'ReportTitle', label: 'Report title' },
];

type Props = {
  onInsert: (token: string) => void;
};

export default function ReportFilterBuilder({ onInsert }: Props) {
  const [picked, setPicked] = useState<string[]>([]);
  const preview = useMemo(
    () => picked.map((id) => `{{${id}}}`).join('  '),
    [picked],
  );

  const toggle = (id: string) => {
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    onInsert(`{{${id}}}`);
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-slate-900">Filter-based counts</h3>
      <p className="mt-1 text-xs text-slate-500">
        Pick the same filters and KPIs the dashboard uses. Each click inserts the live placeholder into the HTML.
      </p>
      <div className="mt-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Filters</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {FILTER_CHIPS.map((chip) => (
            <button
              key={chip.id}
              type="button"
              onClick={() => toggle(chip.id)}
              className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${
                picked.includes(chip.id)
                  ? 'bg-[#EAF2FF] text-[#3977BE] ring-[#D0E0F5]'
                  : 'bg-white text-slate-600 ring-slate-200'
              }`}
            >
              {chip.label}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">KPI counts</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {KPI_CHIPS.map((chip) => (
            <button
              key={chip.id}
              type="button"
              onClick={() => toggle(chip.id)}
              className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${
                picked.includes(chip.id)
                  ? 'bg-[#E8F7F1] text-[#287B5D] ring-[#CDEBD9]'
                  : 'bg-white text-slate-600 ring-slate-200'
              }`}
            >
              {chip.label}
            </button>
          ))}
        </div>
      </div>
      {preview ? (
        <p className="mt-3 break-all font-mono text-[11px] text-slate-500">{preview}</p>
      ) : null}
    </div>
  );
}
