/**
 * Refexone / super-app embed shell.
 * Activated only when URL has embed=1 (or true/yes).
 * Normal Admin UI (no flag) is unchanged.
 */

export const EMBED_QUERY = 'embed';

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
  return next;
}

export type EmbedAppLink = {
  slug: string;
  label: string;
  applicationId: string;
  /** Full path including query for Refexone cards */
  embedPath: string;
};

/** Stable deep links for Refexone KPI cards (production). */
export function buildEmbedAppPath(
  applicationId: string,
  tab: 'dashboard' | 'records' | 'engagement' = 'dashboard',
): string {
  let id = String(applicationId || '').trim();
  // Accept full route ids like "production-IT_Service_Management_A00"
  id = id.replace(/^(production|development)-/i, '');
  return `/applications/production-${encodeURIComponent(id)}?tab=${tab}&${EMBED_QUERY}=1`;
}

/** App detail path — keeps embed=1 when already in embed mode. */
export function buildAppOpenPath(opts: {
  environment?: string;
  applicationId: string;
  tab?: 'dashboard' | 'records' | 'engagement';
  embed?: boolean;
}): string {
  const appId = String(opts.applicationId || '').trim().replace(/^(production|development)-/i, '');
  const tab = opts.tab || 'dashboard';
  if (opts.embed) return buildEmbedAppPath(appId, tab);
  const env = String(opts.environment || 'production').toLowerCase() === 'production' ? 'production' : 'development';
  return `/applications/${env}-${appId}?tab=${tab}`;
}

export function buildEmbedDashboardPath(appRouteId?: string): string {
  const q = new URLSearchParams();
  q.set(EMBED_QUERY, '1');
  if (appRouteId && appRouteId !== 'all') q.set('app', appRouteId);
  return `/dashboard?${q.toString()}`;
}
