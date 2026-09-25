/**
 * Refexone / super-app embed shell.
 * Activated only when URL has embed=1 (or true/yes).
 *
 * Dashboard content (filters, KPIs, APIs, cache) is shared with normal URLs.
 * Embed only changes chrome: sidebar, header, breadcrumbs, return_to navigation.
 */

export const EMBED_QUERY = 'embed';
/** Refexone parent URL — browser Back returns here instead of Admin UI history. */
export const RETURN_TO_QUERY = 'return_to';
/** Logged-in Refex One user (passed on embed deep link). */
export const EMBED_USER_NAME_QUERY = 'user_name';
export const EMBED_USER_TITLE_QUERY = 'user_title';
/** Default when Refexone omits return_to on embed links. */
export const DEFAULT_EMBED_RETURN_URL = 'https://refexone.com/launcher';

const RETURN_TO_ALT = 'refexone_return';

export function isEmbedParam(value: string | null | undefined): boolean {
  const v = String(value || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

export function readEmbedFromSearch(search: string | URLSearchParams): boolean {
  const params = typeof search === 'string' ? new URLSearchParams(search.startsWith('?') ? search.slice(1) : search) : search;
  return isEmbedParam(params.get(EMBED_QUERY));
}

/** Keep embed (+ optional app) when changing tab / filters. */
export function withEmbedParams(
  current: URLSearchParams,
  patch: Record<string, string | null | undefined>,
): URLSearchParams {
  const next = new URLSearchParams(current);
  for (const [key, value] of Object.entries(patch)) {
    if (value == null || value === '') next.delete(key);
    else next.set(key, value);
  }
  if (readEmbedFromSearch(current) && !next.get(EMBED_QUERY)) {
    next.set(EMBED_QUERY, '1');
  }
  // Preserve return URL when navigating tabs/filters inside embed.
  if (readEmbedFromSearch(current)) {
    for (const key of [RETURN_TO_QUERY, RETURN_TO_ALT, EMBED_USER_NAME_QUERY, EMBED_USER_TITLE_QUERY]) {
      const v = current.get(key);
      if (v && !next.get(key)) next.set(key, v);
    }
  }
  return next;
}

export type EmbedUserIdentity = { name: string; title: string };

/** Adrenalin TITLE is Mr./Mrs.; hide those so the job title can show instead. */
const HONORIFIC_TITLE_RE = /^(mr|mrs|ms|miss|dr|sir|madam|mx)\.?$/i;

export function isHonorificTitle(value: string | null | undefined): boolean {
  return HONORIFIC_TITLE_RE.test(String(value || '').trim());
}

function asSearchParams(search: string | URLSearchParams): URLSearchParams {
  return typeof search === 'string'
    ? new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
    : search;
}

/** Copy user_name / user_title from the current embed URL (not fallback defaults). */
export function copyEmbedUserParams(
  from: string | URLSearchParams,
  to: URLSearchParams,
): void {
  const params = asSearchParams(from);
  const name = params.get(EMBED_USER_NAME_QUERY)?.trim();
  const title = params.get(EMBED_USER_TITLE_QUERY)?.trim();
  if (name) to.set(EMBED_USER_NAME_QUERY, name);
  if (title) to.set(EMBED_USER_TITLE_QUERY, title);
}

/** Refex One passes user_name / user_title on embed links. Empty when those params are missing — never invent a person. */
export function readEmbedUserIdentity(search: string | URLSearchParams): EmbedUserIdentity {
  const params = asSearchParams(search);
  const name = params.get(EMBED_USER_NAME_QUERY)?.trim() || '';
  const rawTitle = params.get(EMBED_USER_TITLE_QUERY)?.trim() || '';
  const title = rawTitle && !isHonorificTitle(rawTitle) ? rawTitle : '';
  return { name, title };
}

const EMBED_IDENTITY_STORAGE_KEY = 'refex:embed-identity';

function rememberEmbedIdentity(identity: EmbedUserIdentity): void {
  if (typeof window === 'undefined' || !identity.name) return;
  try {
    sessionStorage.setItem(EMBED_IDENTITY_STORAGE_KEY, JSON.stringify(identity));
  } catch {
    /* ignore quota / private mode */
  }
}

function readRememberedEmbedIdentity(): EmbedUserIdentity {
  if (typeof window === 'undefined') return { name: '', title: '' };
  try {
    const raw = sessionStorage.getItem(EMBED_IDENTITY_STORAGE_KEY);
    if (!raw) return { name: '', title: '' };
    const parsed = JSON.parse(raw) as { name?: unknown; title?: unknown };
    const name = String(parsed?.name || '').trim();
    const rawTitle = String(parsed?.title || '').trim();
    const title = rawTitle && !isHonorificTitle(rawTitle) ? rawTitle : '';
    return { name, title };
  } catch {
    return { name: '', title: '' };
  }
}

/** URL identity first (Refex One), then last embed identity, then Admin UI session. Never invent a person. */
export function resolveDashboardIdentity(
  search: string | URLSearchParams,
  sessionUser?: { name?: string | null } | null,
): EmbedUserIdentity {
  const fromUrl = readEmbedUserIdentity(search);
  if (fromUrl.name) {
    rememberEmbedIdentity(fromUrl);
    return fromUrl;
  }
  if (readEmbedFromSearch(search)) {
    const remembered = readRememberedEmbedIdentity();
    if (remembered.name) return remembered;
    // Embed without Refex One user_name must not show the Admin UI bootstrap account.
    return { name: '', title: '' };
  }
  return {
    name: String(sessionUser?.name || '').trim(),
    title: '',
  };
}

/** Parent app URL for Back navigation (Refexone). Must be https? absolute URL. */
export function readEmbedReturnUrl(search: string | URLSearchParams): string | null {
  const params =
    typeof search === 'string'
      ? new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
      : search;
  const raw = params.get(RETURN_TO_QUERY) || params.get(RETURN_TO_ALT);
  if (!raw?.trim()) return null;
  try {
    const url = new URL(decodeURIComponent(raw.trim()));
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.href;
  } catch {
    return null;
  }
}

/** Embed Back target — explicit return_to or Refexone launcher default. */
export function resolveEmbedReturnUrl(search: string | URLSearchParams): string {
  return readEmbedReturnUrl(search) || DEFAULT_EMBED_RETURN_URL;
}

export function buildEmbedAppPath(
  applicationId: string,
  tab: 'dashboard' | 'records' | 'engagement' = 'dashboard',
  returnTo?: string | null,
  fromSearch?: string | URLSearchParams | null,
): string {
  let id = String(applicationId || '').trim();
  id = id.replace(/^(production|development)-/i, '');
  const q = new URLSearchParams({ tab, [EMBED_QUERY]: '1' });
  q.set(RETURN_TO_QUERY, returnTo || DEFAULT_EMBED_RETURN_URL);
  if (fromSearch) copyEmbedUserParams(fromSearch, q);
  return `/applications/production-${encodeURIComponent(id)}?${q.toString()}`;
}

/** @deprecated use buildEmbedAppPath — kept for callers without return_to */
export function buildEmbedAppPathLegacy(
  applicationId: string,
  tab: 'dashboard' | 'records' | 'engagement' = 'dashboard',
): string {
  return buildEmbedAppPath(applicationId, tab);
}

export function buildAppOpenPath(opts: {
  environment?: string;
  applicationId: string;
  tab?: 'dashboard' | 'records' | 'engagement';
  embed?: boolean;
  fromSearch?: string | URLSearchParams | null;
}): string {
  const appId = String(opts.applicationId || '').trim().replace(/^(production|development)-/i, '');
  const tab = opts.tab || 'dashboard';
  if (opts.embed) {
    const returnTo = opts.fromSearch ? readEmbedReturnUrl(opts.fromSearch) : null;
    return buildEmbedAppPath(appId, tab, returnTo, opts.fromSearch);
  }
  const env = String(opts.environment || 'production').toLowerCase() === 'production' ? 'production' : 'development';
  return `/applications/${env}-${appId}?tab=${tab}`;
}

export function buildEmbedDashboardPath(
  appRouteId?: string,
  returnTo?: string | null,
  fromSearch?: string | URLSearchParams | null,
): string {
  const q = new URLSearchParams();
  q.set(EMBED_QUERY, '1');
  q.set(RETURN_TO_QUERY, returnTo || DEFAULT_EMBED_RETURN_URL);
  if (appRouteId && appRouteId !== 'all') q.set('app', appRouteId);
  if (fromSearch) copyEmbedUserParams(fromSearch, q);
  return `/dashboard?${q.toString()}`;
}

export type EmbedAppLink = {
  slug: string;
  label: string;
  applicationId: string;
  /** Full path including query for Refexone cards */
  embedPath: string;
};
