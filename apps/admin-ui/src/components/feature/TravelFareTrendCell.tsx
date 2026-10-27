import {
  fareTrendFilterLabel,
  resolveTravelFareTrendDisplay,
  type TravelFareTrendKind,
} from '@/lib/travelRecordDisplay';

const TREND_COLOR: Record<TravelFareTrendKind, string> = {
  Up: '#EF4444',
  Down: '#16A34A',
  Flat: '#9CA3AF',
};

function TrendMark({ kind, color }: { kind: TravelFareTrendKind; color: string }) {
  if (kind === 'Flat') {
    return (
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden className="shrink-0">
        <rect x="1" y="1" width="8" height="8" rx="1" fill={color} />
      </svg>
    );
  }
  const down = kind === 'Down';
  return (
    <svg width="14" height="12" viewBox="0 0 14 12" aria-hidden className="shrink-0">
      <path
        d={down ? 'M7 11.2 L0.8 1.4 H13.2 Z' : 'M7 0.8 L13.2 10.6 H0.8 Z'}
        fill={color}
      />
    </svg>
  );
}

export default function TravelFareTrendCell({
  trend,
  deviationPct,
}: {
  trend?: unknown;
  deviationPct?: unknown;
}) {
  const display = resolveTravelFareTrendDisplay(trend, deviationPct);
  if (!display) return <>—</>;
  const { kind, pct } = display;
  const color = TREND_COLOR[kind];
  return (
    <span
      className="inline-flex items-center justify-end gap-1"
      title={fareTrendFilterLabel(kind, deviationPct)}
    >
      <TrendMark kind={kind} color={color} />
      <span className="tabular-nums text-[12px] font-semibold leading-none" style={{ color }}>
        {pct}
      </span>
    </span>
  );
}
