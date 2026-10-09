import { AlignLeft, FileText } from 'lucide-react';
import type { ReactNode } from 'react';

export type MisExpandTile = {
  label: string;
  value?: ReactNode;
};

const RICH_TEXT_LABELS = new Set(['Description', 'Summary', 'Subject', 'Purpose']);
const RICH_TEXT_ICONS: Record<string, typeof FileText> = {
  Description: AlignLeft,
  Summary: FileText,
  Subject: FileText,
  Purpose: FileText,
};

function tileText(value: ReactNode): string {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
  return '';
}

export function visibleMisTiles(tiles: MisExpandTile[]): MisExpandTile[] {
  return (tiles || []).filter((tile) => {
    const text = tileText(tile.value);
    if (text) return text !== '—';
    return tile.value != null && tile.value !== '';
  });
}

export function hasVisibleMisTiles(tiles: MisExpandTile[]): boolean {
  return visibleMisTiles(tiles).length > 0;
}

function MisRichTextSections({ blocks }: { blocks: MisExpandTile[] }) {
  if (!blocks.length) return null;
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.05),0_4px_16px_rgba(15,23,42,0.04)]">
      {blocks.map((block, index) => {
        const Icon = RICH_TEXT_ICONS[block.label] || FileText;
        return (
          <section key={block.label} className={index > 0 ? 'border-t border-slate-100' : ''}>
            <header className="flex items-center gap-2 border-b border-slate-100 bg-gradient-to-r from-[#f0fdfa]/80 to-white px-4 py-2.5">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#0d9488]/10 text-[#0d9488]">
                <Icon className="h-3.5 w-3.5" strokeWidth={2} />
              </span>
              <p className="text-xs font-bold uppercase tracking-[0.08em] text-slate-600">{block.label}</p>
            </header>
            <div className="px-4 py-3.5 sm:px-5 sm:py-4">
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{block.value}</p>
            </div>
          </section>
        );
      })}
    </div>
  );
}

function MisMetaGrid({ tiles }: { tiles: MisExpandTile[] }) {
  if (!tiles.length) return null;
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white p-3 shadow-[0_1px_3px_rgba(15,23,42,0.05),0_4px_16px_rgba(15,23,42,0.04)] sm:p-4">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {tiles.map((tile) => (
          <div
            key={tile.label}
            className="min-w-0 rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2.5 transition-colors hover:border-[#99f6e4]/60 hover:bg-[#f0fdfa]/40"
          >
            <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400 sm:text-xs">{tile.label}</p>
            <p className="mt-1 break-words text-sm font-semibold text-slate-800">{tile.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export function MisRecordExpandPanel({
  tiles,
  banner,
  inset = false,
}: {
  tiles: MisExpandTile[];
  banner?: ReactNode;
  inset?: boolean;
}) {
  const visible = visibleMisTiles(tiles);
  const rich = visible.filter((tile) => RICH_TEXT_LABELS.has(tile.label));
  const meta = visible.filter((tile) => !RICH_TEXT_LABELS.has(tile.label));
  const body = !visible.length && !banner ? (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-slate-200/90 bg-white px-4 py-10 text-center shadow-[0_1px_3px_rgba(15,23,42,0.05),0_4px_16px_rgba(15,23,42,0.04)]">
      <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
        <FileText className="h-5 w-5" />
      </span>
      <p className="mt-3 text-sm font-medium text-slate-600">No details available</p>
      <p className="mt-0.5 text-xs text-slate-400">This request has no overview content yet.</p>
    </div>
  ) : (
    <div className="space-y-3">
      {banner ? (
        <div className={inset ? '-mx-3 -mt-4 sm:-mx-4 sm:-mt-5' : '-mx-3 -mt-4 sm:-mx-5 sm:-mt-5'}>
          {banner}
        </div>
      ) : null}
      {rich.length ? <MisRichTextSections blocks={rich} /> : null}
      {meta.length ? <MisMetaGrid tiles={meta} /> : null}
    </div>
  );

  if (inset) {
    return <div className="px-3 py-4 sm:px-4 sm:py-5">{body}</div>;
  }

  return (
    <div className="relative border-t border-[#0d9488]/12 bg-gradient-to-b from-[#f0fdfa]/50 via-[#f8fafc] to-white px-3 py-4 sm:px-5 sm:py-5">
      <span
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#0d9488]/35 to-transparent"
        aria-hidden
      />
      {body}
    </div>
  );
}
