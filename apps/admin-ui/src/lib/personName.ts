/** Shared person-name rules (mirror backend dashboardDisplay.js). */

const KISSFLOW_ID_RE = /^[A-Za-z]{2}-[\w-]{6,}$/;
const NON_HUMAN_NAME_RE =
  /^(it\s*helpdesk|it\s*agents?|it\s*admin|help\s*desk|power\s*bi|system|bot|lead\s*bot|lead\s*tracker(\s*app)?|tracker\s*app|service\s*account|noreply|no-reply|sa-[\w-]+|kf[_-]|user[_-]?\d+$)/i;

const ITSM_PERSON_ALIASES: Record<string, string> = {
  'it manager': 'Sakthivel',
  'it manager refex': 'Sakthivel',
  'it head': 'Mugesh',
};

export function normalizeItsmPersonLabel(name: string | null | undefined): string {
  const text = String(name || '').trim();
  if (!text) return '';
  const key = text.toLowerCase().replace(/\./g, ' ').replace(/\s+/g, ' ').trim();
  return ITSM_PERSON_ALIASES[key] || text;
}

export function compactMisName(name: string | null | undefined): string {
  const parts = String(name || '').trim().toLowerCase()
    .replace(/\./g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  while (parts.length > 1 && parts[parts.length - 1].length === 1) parts.pop();
  return parts.join('');
}

export function looksLikeKissflowUserId(value: string | null | undefined): boolean {
  const s = String(value || '').trim();
  if (!s) return false;
  if (/^sa-/i.test(s)) return true;
  if (/^kf[_-]/i.test(s)) return true;
  if (KISSFLOW_ID_RE.test(s)) return true;
  return false;
}

export function isPlaceholderPersonName(name: string | null | undefined): boolean {
  const n = String(name || '').trim();
  if (!n) return true;
  if (n === '-' || n === '—' || n === '–' || n === '−') return true;
  if (/^(unknown|n\/a|na|none|null|undefined)$/i.test(n)) return true;
  return false;
}

export function isDisplayablePersonName(name: string | null | undefined, userId?: string | null): boolean {
  const n = String(name || '').trim();
  const id = String(userId || '').trim();
  if (!n) return false;
  if (isPlaceholderPersonName(n)) return false;
  if (looksLikeKissflowUserId(n)) return false;
  if (n === id && looksLikeKissflowUserId(id)) return false;
  if (NON_HUMAN_NAME_RE.test(n)) return false;
  if (!/[A-Za-z]{2,}/.test(n)) return false;
  return true;
}

export function resolvePersonDisplayName(
  name: string | null | undefined,
  email: string | null | undefined,
  userId?: string | null,
): string | null {
  for (const candidate of [name, email]) {
    const text = normalizeItsmPersonLabel(String(candidate || '').trim());
    if (text && isDisplayablePersonName(text, userId)) return text;
  }
  return null;
}
