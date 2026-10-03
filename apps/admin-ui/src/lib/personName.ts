/** Shared person-name rules (mirror backend dashboardDisplay.js). */

const KISSFLOW_ID_RE = /^[A-Za-z]{2}-[\w-]{6,}$/;
const NON_HUMAN_NAME_RE =
  /^(it\s*helpdesk|it\s*agents?|it\s*admin|help\s*desk|power\s*bi|system|bot|lead\s*bot|lead\s*tracker(\s*app)?|tracker\s*app|service\s*account|noreply|no-reply|sa-[\w-]+|kf[_-]|user[_-]?\d+$)/i;

const ITSM_PERSON_ALIASES: Record<string, string> = {
  'it manager': 'Sakthivel',
  'it manager refex': 'Sakthivel',
  'it manager approval': 'Sakthivel',
  'first approver - it manager': 'Sakthivel',
  'first approver it manager': 'Sakthivel',
  'it head': 'Mugesh',
  'it head refex': 'Mugesh',
  'it head approval': 'Mugesh',
  'final approver - it head': 'Mugesh',
  'final approver it head': 'Mugesh',
  // Kissflow / older cache sometimes stored this person as the word Inactive.
  inactive: 'Deepan Duraisamy',
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
  if (/^(unknown|n\/a|na|none|null|undefined|inactive)$/i.test(n)) return true;
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

/** Dedupe requester/assignee labels that differ only by spacing, case, or a trailing initial. */
export function uniquePersonLabels(names: Array<string | null | undefined>): string[] {
  const byKey = new Map<string, string>();
  for (const raw of names) {
    const label = normalizeItsmPersonLabel(String(raw || '').trim());
    if (!isDisplayablePersonName(label)) continue;
    const key = compactMisName(label);
    if (!key) continue;
    const prev = byKey.get(key);
    if (!prev || label.length > prev.length) byKey.set(key, label);
  }
  return [...byKey.values()].sort((a, b) => a.localeCompare(b));
}

export function personLabelMatches(value: string | null | undefined, selected: string | null | undefined): boolean {
  const want = compactMisName(selected);
  const have = compactMisName(value);
  if (want && have) return have === want || have.includes(want) || want.includes(have);
  const sel = String(selected || '').trim().toLowerCase();
  if (!sel) return true;
  return String(value || '').toLowerCase().includes(sel);
}
