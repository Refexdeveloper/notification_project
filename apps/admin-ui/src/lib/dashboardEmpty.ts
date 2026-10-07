/** Dashboard empty cells — never show em dash / hyphen placeholders. */

export function isBlankDash(value: unknown): boolean {
  const s = String(value ?? '').trim();
  return !s || s === '—' || s === '-' || s.toLowerCase() === 'null' || s.toLowerCase() === 'undefined';
}

export function displayDashText(value: unknown, fallback = 'Unknown'): string {
  if (isBlankDash(value)) return fallback;
  return String(value).trim();
}

export function displayDashCount(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

const LAKH = 1_00_000;
const CRORE = 1_00_00_000;

function trimIndianUnit(n: number): string {
  const rounded = Math.round(n * 100) / 100;
  if (Number.isInteger(rounded)) return String(rounded);
  return String(Number(rounded.toFixed(2)));
}

/** Full rupees with Indian grouping — hover / title text. */
export function formatInrExact(n: number | null | undefined): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return '₹0';
  const sign = v < 0 ? '-' : '';
  return `${sign}₹${Math.round(Math.abs(v)).toLocaleString('en-IN')}`;
}

/** Compact INR: crores / lakhs above those thresholds, else Indian grouping. */
export function formatInr(n: number | null | undefined): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return '₹0';
  const sign = v < 0 ? '-' : '';
  const abs = Math.abs(v);
  if (abs >= CRORE) return `${sign}₹${trimIndianUnit(abs / CRORE)} Cr`;
  if (abs >= LAKH) return `${sign}₹${trimIndianUnit(abs / LAKH)} L`;
  return `${sign}₹${Math.round(abs).toLocaleString('en-IN')}`;
}

export function displayPersonCell(value: unknown): string {
  if (isBlankDash(value)) return '—';
  const text = String(value).trim();
  if (/^(unknown|n\/a|na|none)$/i.test(text)) return '—';
  return text;
}

export function displayWhen(value: string | null | undefined): string {
  if (!value || isBlankDash(value)) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return 'Unknown';
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
