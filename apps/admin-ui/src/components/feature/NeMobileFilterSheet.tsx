/**
 * Mobile filter bottom sheet — same layout as aasik_ITSM ITMisMobileFilterSheet.
 * Responsive chrome only; callers keep their existing filter values/handlers.
 */
import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Filter, X } from 'lucide-react';

export function NeMobileFiltersButton({
  count = 0,
  onClick,
  className = '',
}: {
  count?: number;
  onClick?: () => void;
  className?: string;
}) {
  const active = Number(count) > 0;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-xl border px-3 text-xs font-semibold transition ${
        active
          ? 'border-[#3977BE]/40 bg-[#EAF2FF] text-[#3977BE]'
          : 'border-slate-200 bg-white text-slate-700'
      } ${className}`}
    >
      <Filter className="h-3.5 w-3.5 shrink-0" aria-hidden />
      Filters{active ? ` (${count})` : ''}
    </button>
  );
}

export function NeMobileActiveFilterChips({
  chips = [],
}: {
  chips?: Array<{ key: string; label: string; onRemove?: () => void }>;
}) {
  if (!chips.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          onClick={chip.onRemove}
          className="inline-flex max-w-full items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-700"
        >
          <span className="truncate">{chip.label}</span>
          <X className="h-3 w-3 shrink-0 text-slate-400" aria-hidden />
        </button>
      ))}
    </div>
  );
}

export function NeMobileFilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex w-full flex-col gap-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      {children}
    </label>
  );
}

export default function NeMobileFilterSheet({
  open,
  title = 'Filters',
  onClose,
  onClear,
  onApply,
  children,
}: {
  open: boolean;
  title?: string;
  onClose?: () => void;
  onClear?: () => void;
  onApply?: () => void;
  children?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-[10000] lg:hidden" role="dialog" aria-modal="true" aria-label={title}>
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/40"
        aria-label="Close filters"
        onClick={onClose}
      />
      <div className="absolute inset-x-0 bottom-0 flex max-h-[min(88vh,640px)] flex-col overflow-hidden rounded-t-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-900">{title}</p>
            <p className="text-[11px] font-medium text-slate-500">Tap Apply to update the view</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-50"
            aria-label="Close"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-3">
          {children}
        </div>

        <div className="flex shrink-0 gap-2 border-t border-slate-100 bg-white px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={onClear}
            className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-700"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={onApply}
            className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-xl bg-[#3977BE] text-sm font-semibold text-white shadow-sm"
          >
            Apply
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
