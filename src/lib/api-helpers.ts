import { OdooError } from './odoo/types';

export class ApiValidationError extends Error {}

export function jsonResponse(data: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      // Read-only, refresh-driven data: never let intermediaries cache
      // a stale snapshot behind the user's back.
      'Cache-Control': 'no-store',
      ...init?.headers,
    },
  });
}

export async function handleApiRoute(fn: () => Promise<unknown>): Promise<Response> {
  try {
    const data = await fn();
    return jsonResponse({ ok: true, data });
  } catch (err) {
    if (err instanceof ApiValidationError) {
      return jsonResponse({ ok: false, error: err.message }, { status: 400 });
    }
    if (err instanceof OdooError) {
      console.error('[odoo]', err.message, err.cause ?? '');
      return jsonResponse({ ok: false, error: 'Upstream Odoo request failed' }, { status: 502 });
    }
    console.error('[api] unexpected error', err);
    return jsonResponse({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}
