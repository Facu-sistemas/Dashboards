import { useQuery, type QueryKey } from '@tanstack/react-query';
import type { ApiEnvelope } from './types';

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { Accept: 'application/json' } });
  const body = (await res.json()) as ApiEnvelope<T>;
  if (!res.ok || !body.ok || body.data === undefined) {
    throw new Error(body.error ?? `Request to ${path} failed`);
  }
  return body.data;
}

/** Shared fetch-on-filter-change hook backing every table/chart in the dashboard. */
export function useApiQuery<T>(queryKey: QueryKey, path: string, options?: { enabled?: boolean }) {
  return useQuery<T>({
    queryKey,
    queryFn: () => fetchJson<T>(path),
    placeholderData: (prev) => prev,
    enabled: options?.enabled ?? true,
  });
}
