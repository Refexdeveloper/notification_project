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
