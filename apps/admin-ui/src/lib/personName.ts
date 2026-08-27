/** Shared person-name rules (mirror backend dashboardDisplay.js). */

const KISSFLOW_ID_RE = /^[A-Za-z]{2}-[\w-]{6,}$/;
const NON_HUMAN_NAME_RE =
  /^(it\s*helpdesk|help\s*desk|power\s*bi|system|bot|lead\s*bot|lead\s*tracker(\s*app)?|tracker\s*app|service\s*account|noreply|no-reply|sa-[\w-]+|kf[_-]|user[_-]?\d+$)/i;

export function looksLikeKissflowUserId(value: string | null | undefined): boolean {
  const s = String(value || '').trim();
  if (!s) return false;
  if (/^sa-/i.test(s)) return true;
  if (/^kf[_-]/i.test(s)) return true;
  if (KISSFLOW_ID_RE.test(s)) return true;
  return false;
}

export function isDisplayablePersonName(name: string | null | undefined, userId?: string | null): boolean {
  const n = String(name || '').trim();
  const id = String(userId || '').trim();
  if (!n) return false;
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
    const text = String(candidate || '').trim();
    if (text && isDisplayablePersonName(text, userId)) return text;
  }
  return null;
}
