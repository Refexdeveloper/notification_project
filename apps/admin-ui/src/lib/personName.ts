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

const PERSON_KEY_ALIASES: Record<string, string> = {
  balarajuilaiveni: 'balarajuilaveni',
  kotipatchava: 'koteswararaopatchava',
};

/** Collapse spelling / spacing variants so one person is one filter option. */
export function personDedupeKey(name: string | null | undefined): string {
  const compact = compactMisName(name);
  if (!compact) return '';
  const aliased = PERSON_KEY_ALIASES[compact] || compact;
  return aliased.replace(/ilaiveni/g, 'ilaveni');
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
    const key = personDedupeKey(label);
    if (!key) continue;
    const prev = byKey.get(key);
    if (!prev || label.length > prev.length) byKey.set(key, label);
  }
  return [...byKey.values()].sort((a, b) => a.localeCompare(b));
}

export function personLabelMatches(value: string | null | undefined, selected: string | null | undefined): boolean {
  const want = personDedupeKey(selected);
  const have = personDedupeKey(value);
  if (want && have) return have === want || have.includes(want) || want.includes(have);
  const sel = String(selected || '').trim().toLowerCase();
  if (!sel) return true;
  return String(value || '').toLowerCase().includes(sel);
}

/** Mohamed Aasik → MA, Arun Kumar → AK, Gowtham → GW. Same as aasik_ITSM newceo. */
export function getPersonInitials(name: string | null | undefined): string {
  const label = String(name || '').trim();
  if (!label || label === '—' || label === '-') return '';
  const parts = label.split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.length > 1) {
    return parts.map((part) => getPersonInitials(part)).filter(Boolean).join(', ');
  }
  const words = label.split(/\s+/).filter(Boolean);
  if (!words.length) return '';
  if (words.length === 1) {
    const token = words[0].replace(/[^A-Za-z]/g, '');
    if (!token) return words[0].slice(0, 2).toUpperCase();
    const first = token.charAt(0);
    const nextConsonant = token.slice(1).split('').find((ch) => !/[aeiou]/i.test(ch));
    if (nextConsonant) return `${first}${nextConsonant}`.toUpperCase();
    return token.slice(0, 2).toUpperCase();
  }
  const first = words[0].replace(/[^A-Za-z]/g, '').charAt(0);
  const last = words[words.length - 1].replace(/[^A-Za-z]/g, '').charAt(0);
  return `${first}${last}`.toUpperCase();
}

export function splitPersonNames(name: string | null | undefined): string[] {
  return String(name || '')
    .trim()
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part && part !== '—' && part !== '-');
}

const MIS_AVATAR_TONES = [
  { bg: 'bg-teal-100', text: 'text-teal-800' },
  { bg: 'bg-sky-100', text: 'text-sky-800' },
  { bg: 'bg-violet-100', text: 'text-violet-800' },
  { bg: 'bg-amber-100', text: 'text-amber-800' },
  { bg: 'bg-rose-100', text: 'text-rose-800' },
  { bg: 'bg-emerald-100', text: 'text-emerald-800' },
  { bg: 'bg-indigo-100', text: 'text-indigo-800' },
  { bg: 'bg-orange-100', text: 'text-orange-800' },
  { bg: 'bg-fuchsia-100', text: 'text-fuchsia-800' },
  { bg: 'bg-cyan-100', text: 'text-cyan-800' },
] as const;

export function getPersonAvatarTone(name: string | null | undefined): { bg: string; text: string } {
  const label = String(name || '').trim().toLowerCase();
  if (!label) return MIS_AVATAR_TONES[0];
  let hash = 0;
  for (let i = 0; i < label.length; i += 1) {
    hash = ((hash << 5) - hash) + label.charCodeAt(i);
    hash |= 0;
  }
  return MIS_AVATAR_TONES[Math.abs(hash) % MIS_AVATAR_TONES.length];
}
