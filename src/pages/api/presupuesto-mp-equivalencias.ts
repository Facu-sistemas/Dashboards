import type { APIRoute } from 'astro';
import { ApiValidationError, handleApiRoute, jsonResponse } from '@/lib/api-helpers';
import { getBaseInsumos } from '@/lib/odoo/base-insumos';
import { guardarEquivalencia } from '@/lib/supabase/presupuesto-mp-equivalencias';

export const prerender = false;

type UsuarioMin = { username: string; rol: string; areasPermitidas: string[] } | undefined;
const editarCompras = (u: UsuarioMin) => !!u && u.areasPermitidas.includes('compras') && (u.rol === 'dev' || u.username.trim().toLowerCase() === 'marly');

// POST /api/presupuesto-mp-equivalencias  { sku, productId }  — productId: número de Odoo, 0 = "ya no existe", null = borrar. Solo editores.
export const POST: APIRoute = async ({ locals, request }) => {
  if (!editarCompras(locals.usuario)) return jsonResponse({ ok: false, error: 'No tenés permiso' }, { status: 403 });
  return handleApiRoute(async () => {
    const b = (await request.json().catch(() => null)) as { sku?: unknown; productId?: unknown } | null;
    const sku = typeof b?.sku === 'string' ? b.sku.trim() : '';
    if (!sku || sku.length > 300) throw new ApiValidationError('SKU inválido');
    const pid = b?.productId;
    if (pid !== null && !(typeof pid === 'number' && Number.isInteger(pid) && pid >= 0)) throw new ApiValidationError('Producto inválido');
    if (typeof pid === 'number' && pid > 0) {
      const { insumos } = await getBaseInsumos();
      if (!insumos.some((i) => i.productId === pid)) throw new ApiValidationError('Ese producto no está en la base de insumos de Odoo');
    }
    await guardarEquivalencia(sku, pid as number | null, locals.usuario!.username);
    return { guardado: true };
  });
};
