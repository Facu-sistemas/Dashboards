import { getOdooConfig } from '../env';
import { withTtlCache, cacheKey } from '../cache';
import {
  OdooError,
  type OdooDomain,
  type OdooReadGroupResult,
  type ReadGroupParams,
  type SearchReadParams,
} from './types';

/**
 * Centralized, read-only Odoo JSON-RPC client.
 *
 * Deliberately exposes only `searchRead` and `readGroup` — the two
 * query-only ORM methods this app needs. There is intentionally NO
 * `create` / `write` / `unlink` wrapper here: adding one would make it too
 * easy for a future endpoint to mutate Odoo by accident. If you ever need
 * writes, build a separate, explicitly-audited module — don't extend this
 * one.
 */

interface JsonRpcResponse<T> {
  jsonrpc: '2.0';
  id: number | string;
  result?: T;
  error?: {
    code: number;
    message: string;
    data?: { message?: string; debug?: string };
  };
}

let requestCounter = 0;

async function jsonRpcCall<T>(url: string, service: string, method: string, args: unknown[]): Promise<T> {
  const id = ++requestCounter;
  const body = {
    jsonrpc: '2.0',
    method: 'call',
    params: { service, method, args },
    id,
  };

  let res: Response;
  try {
    res = await fetch(`${url}/jsonrpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new OdooError(`Network error contacting Odoo at ${url}`, err);
  }

  if (!res.ok) {
    throw new OdooError(`Odoo HTTP error ${res.status} ${res.statusText}`);
  }

  const payload = (await res.json()) as JsonRpcResponse<T>;
  if (payload.error) {
    const detail = payload.error.data?.message ?? payload.error.message;
    throw new OdooError(`Odoo RPC error: ${detail}`, payload.error);
  }
  if (payload.result === undefined) {
    throw new OdooError('Odoo RPC returned no result');
  }
  return payload.result;
}

let uidPromise: Promise<number> | null = null;

async function getUid(): Promise<number> {
  const config = getOdooConfig();
  if (config.uid) return config.uid;

  if (!uidPromise) {
    uidPromise = jsonRpcCall<number | false>(config.url, 'common', 'authenticate', [
      config.db,
      config.userEmail,
      config.apiKey,
      {},
    ]).then((uid) => {
      if (!uid) {
        uidPromise = null;
        throw new OdooError('Odoo authentication failed: invalid DB, email, or API key');
      }
      return uid;
    });
  }
  return uidPromise;
}

async function executeKw<T>(model: string, method: 'search_read' | 'read_group' | 'search_count', args: unknown[], kwargs: Record<string, unknown>): Promise<T> {
  const config = getOdooConfig();
  const uid = await getUid();
  return jsonRpcCall<T>(config.url, 'object', 'execute_kw', [
    config.db,
    uid,
    config.apiKey,
    model,
    method,
    args,
    kwargs,
  ]);
}

function buildDomain(domain?: OdooDomain): OdooDomain {
  return domain ?? [];
}

/** Read-only `search_read`, with short-TTL de-duplication for bursty identical calls. */
export async function searchRead<T extends Record<string, unknown>>(
  params: SearchReadParams
): Promise<T[]> {
  const config = getOdooConfig();
  const key = cacheKey('search_read', params as unknown as Record<string, unknown>);
  return withTtlCache(key, config.cacheTtlMs, () =>
    executeKw<T[]>(
      params.model,
      'search_read',
      [buildDomain(params.domain)],
      {
        fields: params.fields,
        limit: params.limit,
        offset: params.offset,
        order: params.order,
      }
    )
  );
}

/**
 * Read-only `search_read`, paginated until exhausted. Use this instead of
 * `searchRead` whenever the result feeds a sum/aggregate — a plain `limit`
 * silently truncates and produces a wrong total (bit us once already with
 * an under-counted product total; don't repeat it with money figures).
 */
export async function searchReadAll<T extends Record<string, unknown>>(
  params: Omit<SearchReadParams, 'offset'>
): Promise<T[]> {
  const pageSize = params.limit && params.limit > 0 ? params.limit : 2000;
  const results: T[] = [];
  let offset = 0;

  for (;;) {
    const page = await searchRead<T>({ ...params, limit: pageSize, offset });
    results.push(...page);
    if (page.length < pageSize) break;
    offset += pageSize;
  }

  return results;
}

/** Read-only `search_count` — exact row count, unaffected by any `limit`. */
export async function searchCount(model: string, domain?: OdooDomain): Promise<number> {
  const config = getOdooConfig();
  const key = cacheKey('search_count', { model, domain });
  return withTtlCache(key, config.cacheTtlMs, () =>
    executeKw<number>(model, 'search_count', [buildDomain(domain)], {})
  );
}

/** Read-only `read_group`, for aggregated series (sums/averages per bucket). */
export async function readGroup(params: ReadGroupParams): Promise<OdooReadGroupResult[]> {
  const config = getOdooConfig();
  const key = cacheKey('read_group', params as unknown as Record<string, unknown>);
  return withTtlCache(key, config.cacheTtlMs, () =>
    executeKw<OdooReadGroupResult[]>(
      params.model,
      'read_group',
      [buildDomain(params.domain), params.fields, params.groupBy],
      {
        limit: params.limit,
        orderby: params.orderby,
        lazy: params.lazy ?? false,
      }
    )
  );
}
