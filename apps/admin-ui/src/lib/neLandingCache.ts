/** Dual session + local storage so localhost / embed / main land from the last good snapshot. */

export function neCacheRead(key: string): string | null {
  try {
    const session = sessionStorage.getItem(key);
    if (session) return session;
  } catch {
    /* ignore */
  }
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function neCacheWrite(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    /* ignore quota / private mode */
  }
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore quota / private mode */
  }
}

export function neCacheRemove(key: string): void {
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* ignore */
  }
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function neCacheForEach(prefix: string, visit: (key: string, raw: string) => void): void {
  const seen = new Set<string>();
  for (const store of [sessionStorage, localStorage]) {
    try {
      for (let i = 0; i < store.length; i += 1) {
        const key = store.key(i);
        if (!key || !key.startsWith(prefix) || seen.has(key)) continue;
        const raw = store.getItem(key);
        if (!raw) continue;
        seen.add(key);
        visit(key, raw);
      }
    } catch {
      /* ignore */
    }
  }
}
