/**
 * Minimal in-memory TTL cache, process-local (fine for a single Node SSR
 * instance; swap for Redis if you scale to multiple instances). Purpose is
 * NOT long-lived caching — it only collapses duplicate reads that land
 * within the same short burst (e.g. several chart widgets requesting
 * overlapping date ranges on the same page load), so Odoo isn't hit once
 * per widget for data that's already in flight or just arrived.
 */

interface Entry<T> {
  value: T;
  expiresAt: number;
}

const store = new Map<string, Entry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

export async function withTtlCache<T>(
  key: string,
  ttlMs: number,
  fetcher: () => Promise<T>
): Promise<T> {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.expiresAt > now) {
    return hit.value as T;
  }

  const existingInflight = inflight.get(key);
  if (existingInflight) {
    return existingInflight as Promise<T>;
  }

  const promise = fetcher()
    .then((value) => {
      store.set(key, { value, expiresAt: Date.now() + ttlMs });
      inflight.delete(key);
      return value;
    })
    .catch((err) => {
      inflight.delete(key);
      throw err;
    });

  inflight.set(key, promise);
  return promise;
}

export function cacheKey(namespace: string, params: Record<string, unknown>): string {
  const sorted = Object.keys(params)
    .sort()
    .map((k) => `${k}=${JSON.stringify(params[k])}`)
    .join('&');
  return `${namespace}::${sorted}`;
}
