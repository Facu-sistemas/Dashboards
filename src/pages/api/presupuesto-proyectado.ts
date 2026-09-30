import type { APIRoute } from 'astro';
import { z } from 'zod';
import { getPresupuestoProyectado, LINEAS } from '../../lib/odoo/presupuesto-proyectado';
import { getEtiquetasLinea, setEtiquetaLinea } from '../../lib/supabase/presupuesto-mp-linea';
import { handleApiRoute, jsonResponse, ApiValidationError } from '../../lib/api-helpers';

export const prerender = false;

function requireComprasAccess(context: { locals: App.Locals }): Response | null {
  if (!context.locals.usuario?.areasPermitidas.includes('finanzas')) {
    return jsonResponse({ ok: false, error: 'No autorizado' }, { status: 403 });
  }
  return null;
}

// GET /api/presupuesto-proyectado — presupuesto de compras por insumo y mes.
export const GET: APIRoute = async (context) => {
  const denied = requireComprasAccess(context);
  if (denied) return denied;
  return handleApiRoute(async () => {
    const etiquetas = await getEtiquetasLinea();
    return getPresupuestoProyectado(etiquetas ?? new Map(), etiquetas !== null);
  });
};

const bodySchema = z.object({
  productId: z.number().int().positive(),
  linea: z.enum(LINEAS as [string, ...string[]]).nullable(),
});

// POST /api/presupuesto-proyectado — etiqueta manual de línea para un insumo (null = volver a la sugerida).
export const POST: APIRoute = async (context) => {
  const denied = requireComprasAccess(context);
  if (denied) return denied;
  return handleApiRoute(async () => {
    const parsed = bodySchema.safeParse(await context.request.json().catch(() => null));
    if (!parsed.success) throw new ApiValidationError(parsed.error.issues.map((i) => i.message).join('; '));
    await setEtiquetaLinea(parsed.data.productId, parsed.data.linea as never, context.locals.usuario!.username);
    return { ok: true };
  });
};
