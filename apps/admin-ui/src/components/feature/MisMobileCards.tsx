/**
 * Project Tracker-style MIS cards: table on lg+, stacked cards on mobile.
 * Display-only — same values the desktop table already shows.
 */
import { useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

export function MisMobileFieldRow({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2 py-0.5">
      <span className="shrink-0 text-slate-500">{label}</span>
      <span className="min-w-0 truncate text-right font-medium text-slate-800">{value ?? '—'}</span>
    </div>
  );
}

export function MisMobileRecordCard({
  title,
  subtitle,
  badge,
  fields,
  extraFields,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  badge?: ReactNode;
  fields: Array<{ label: string; value: ReactNode }>;
  extraFields?: Array<{ label: string; value: ReactNode }>;
}) {
  const [open, setOpen] = useState(false);
  const canExpand = Boolean(extraFields?.length);

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="w-full p-3 text-left">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-slate-800">{title}</p>
            {subtitle ? (
              <p className="mt-0.5 truncate text-[10px] leading-relaxed text-slate-500">{subtitle}</p>
            ) : null}
          </div>
          <div className="flex shrink-0 items-start gap-1.5">
            {badge}
            {canExpand ? (
              <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                aria-expanded={open}
                className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-400 transition hover:bg-slate-100 hover:text-[#3977BE]"
              >
                <ChevronDown className={`h-5 w-5 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
              </button>
            ) : null}
          </div>
        </div>
        <div className="mt-2.5 space-y-1.5 text-[11px]">
          {fields.map((field) => (
            <MisMobileFieldRow key={field.label} label={field.label} value={field.value} />
          ))}
        </div>
        {canExpand ? (
          <div className="mt-2.5 flex items-center justify-end gap-2 border-t border-slate-100 pt-2">
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="inline-flex min-h-[36px] items-center gap-1 rounded-lg px-2 text-[11px] font-semibold text-slate-600"
            >
              {open ? 'Hide' : 'Expand'}
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>
          </div>
        ) : null}
      </div>
      {open && extraFields?.length ? (
        <div className="space-y-1.5 border-t border-slate-200/80 bg-slate-50/80 px-3 py-2.5 text-[11px]">
          {extraFields.map((field) => (
            <MisMobileFieldRow key={field.label} label={field.label} value={field.value} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
