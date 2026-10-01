import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Filter } from 'lucide-react';

type ValueFilterProps = {
  label: string;
  value?: string;
  options: string[];
  onChange: (next: string) => void;
};

type DateFilterProps = {
  label: string;
  from?: string;
  to?: string;
  onFromChange: (next: string) => void;
  onToChange: (next: string) => void;
  onClear: () => void;
};

function FilterButton({
  label,
  active,
  open,
  onToggle,
}: {
  label: string;
  active: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      title={`Filter ${label}`}
      aria-label={`Filter ${label}`}
      aria-expanded={open}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded transition ${
        active
          ? 'bg-[#2B5AED]/15 text-[#2B5AED]'
          : 'text-slate-400 hover:bg-slate-200/70 hover:text-slate-600'
      }`}
    >
      <Filter className="h-3 w-3" strokeWidth={2.25} />
    </button>
  );
}

function useDismiss(open: boolean, onClose: () => void) {
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (rootRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open, onClose]);
  return { rootRef, panelRef };
}

function useFixedPanelStyle(rootRef: RefObject<HTMLDivElement | null>, open: boolean, minWidth = '11rem') {
  const [style, setStyle] = useState<CSSProperties | null>(null);
  useEffect(() => {
    if (!open || !rootRef.current) {
      setStyle(null);
      return undefined;
    }
    const update = () => {
      if (!rootRef.current) return;
      const rect = rootRef.current.getBoundingClientRect();
      setStyle({
        position: 'fixed',
        top: rect.bottom + 4,
        left: Math.max(8, Math.min(rect.left, window.innerWidth - 200)),
        minWidth,
        maxWidth: '18rem',
        zIndex: 10000,
      });
    };
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [open, rootRef, minWidth]);
  return style;
}

function FilterDropdownPanel({
  open,
  rootRef,
  panelRef,
  minWidth,
  children,
}: {
  open: boolean;
  rootRef: RefObject<HTMLDivElement | null>;
  panelRef: RefObject<HTMLDivElement | null>;
  minWidth?: string;
  children: ReactNode;
}) {
  const style = useFixedPanelStyle(rootRef, open, minWidth);
  if (!open || !style || typeof document === 'undefined') return null;
  return createPortal(
    <div
      ref={panelRef}
      style={style}
      className="flex max-h-64 flex-col overflow-y-auto overflow-x-hidden whitespace-normal rounded-lg border border-slate-200 bg-white p-1.5 shadow-lg"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {children}
    </div>,
    document.body,
  );
}

export function RecordsColumnHeaderFilter({ label, value = '', options, onChange }: ValueFilterProps) {
  const [open, setOpen] = useState(false);
  const active = Boolean(value && value !== 'all');
  const { rootRef, panelRef } = useDismiss(open, () => setOpen(false));

  return (
    <div ref={rootRef} className="relative z-20 inline-flex max-w-full items-center gap-1">
      <span className="cursor-pointer" onClick={() => setOpen((v) => !v)}>{label}</span>
      <FilterButton label={label} active={active} open={open} onToggle={() => setOpen((v) => !v)} />
      <FilterDropdownPanel open={open} rootRef={rootRef} panelRef={panelRef}>
        <button
          type="button"
          className={`mb-0.5 block w-full rounded-md px-2 py-1.5 text-left text-[11px] font-semibold ${
            !active ? 'bg-slate-50 text-slate-800' : 'text-slate-600 hover:bg-slate-50'
          }`}
          onMouseDown={(e) => {
            e.preventDefault();
            onChange('');
            setOpen(false);
          }}
        >
          All
        </button>
        {options.length ? options.slice(0, 120).map((opt) => (
          <button
            key={opt}
            type="button"
            className={`block w-full rounded-md px-2 py-1.5 text-left text-[11px] ${
              value === opt ? 'bg-[#EEF5FF] font-semibold text-[#2B5AED]' : 'text-slate-700 hover:bg-slate-50'
            }`}
            onMouseDown={(e) => {
              e.preventDefault();
              onChange(opt);
              setOpen(false);
            }}
          >
            {opt}
          </button>
        )) : (
          <p className="px-2 py-1 text-[11px] text-slate-400">No values</p>
        )}
        {active ? (
          <button
            type="button"
            className="mt-1 block w-full rounded-md px-2 py-1.5 text-left text-[11px] font-semibold text-slate-500 hover:bg-slate-50"
            onMouseDown={(e) => {
              e.preventDefault();
              onChange('');
              setOpen(false);
            }}
          >
            Clear filter
          </button>
        ) : null}
      </FilterDropdownPanel>
    </div>
  );
}

export function RecordsColumnDateFilter({
  label,
  from = '',
  to = '',
  onFromChange,
  onToChange,
  onClear,
}: DateFilterProps) {
  const [open, setOpen] = useState(false);
  const active = Boolean(from || to);
  const { rootRef, panelRef } = useDismiss(open, () => setOpen(false));

  return (
    <div ref={rootRef} className="relative z-20 inline-flex max-w-full items-center gap-1">
      <span className="cursor-pointer" onClick={() => setOpen((v) => !v)}>{label}</span>
      <FilterButton label={label} active={active} open={open} onToggle={() => setOpen((v) => !v)} />
      <FilterDropdownPanel open={open} rootRef={rootRef} panelRef={panelRef} minWidth="13rem">
        <label className="flex flex-col gap-1 text-[11px] font-semibold text-slate-500">
          From
          <input
            type="date"
            value={from || ''}
            onChange={(e) => onFromChange(e.target.value)}
            className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-xs font-medium text-slate-700 outline-none focus:border-[#2B5AED]"
          />
        </label>
        <label className="mt-2 flex flex-col gap-1 text-[11px] font-semibold text-slate-500">
          To
          <input
            type="date"
            value={to || ''}
            onChange={(e) => onToChange(e.target.value)}
            className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-xs font-medium text-slate-700 outline-none focus:border-[#2B5AED]"
          />
        </label>
        {active ? (
          <button
            type="button"
            className="mt-2 block w-full rounded-md px-2 py-1.5 text-left text-[11px] font-semibold text-slate-500 hover:bg-slate-50"
            onMouseDown={(e) => {
              e.preventDefault();
              onClear();
              setOpen(false);
            }}
          >
            Clear date filter
          </button>
        ) : null}
      </FilterDropdownPanel>
    </div>
  );
}

export function isDateRecordColumn(colId: string): boolean {
  return /(_at|_date)$/i.test(colId) || /^(created|closed|completed)(_at|_date)?$/i.test(colId);
}
