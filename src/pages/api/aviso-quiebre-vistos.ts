import type { APIRoute } from 'astro';
import { ApiValidationError, handleApiRoute, jsonResponse } from '@/lib/api-helpers';
import { marcarVisto, quitarVisto } from '@/lib/supabase/aviso-quiebre';

export const prerender = false;

// POST /api/aviso-quiebre-vistos — { version, sku, visto: boolean, nota?: string }. Cada persona marca lo suyo.
export const POST: APIRoute = async ({ locals, request }) => {
  const u = locals.usuario;
  if (!u || !u.areasPermitidas.includes('compras')) return jsonResponse({ ok: false, error: 'Sin permiso' }, { status: 403 });
  return handleApiRoute(async () => {
    const b = await request.json().catch(() => null);
    if (!b || typeof b.version !== 'string' || typeof b.sku !== 'string' || !b.sku || typeof b.visto !== 'boolean') throw new ApiValidationError('Datos inválidos');
    if (b.visto) await marcarVisto(b.version, b.sku, u.username, String(b.nota ?? '').slice(0, 140));
    else await quitarVisto(b.version, b.sku, u.username);
    return { guardado: true };
  });
};
