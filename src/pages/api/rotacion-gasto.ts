import type { APIRoute } from 'astro';
import { z } from 'zod';
import { getEmpresas, getGastoReal, getRotacionPorCategoria } from '../../lib/odoo/rotacion-gasto';
import { handleApiRoute, jsonResponse, ApiValidationError } from '../../lib/api-helpers';

export const prerender = false;

// "1,2" → [1, 2]; vacío/ausente = todas las empresas.
const empresasSchema = z
  .string()
  .optional()
  .transform((v) => (v ? v.split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0) : undefined));

const querySchema = z.discriminatedUnion('vista', [
  z.object({ vista: z.literal('empresas') }),
  z.object({ vista: z.literal('rotacion'), empresas: empresasSchema }),
  z.object({ vista: z.literal('gasto'), criterio: z.enum(['ordenes', 'facturas']).default('ordenes'), empresas: empresasSchema }),
]);

// GET /api/rotacion-gasto?vista=empresas
// GET /api/rotacion-gasto?vista=rotacion&empresas=1,2
// GET /api/rotacion-gasto?vista=gasto&criterio=ordenes|facturas&empresas=1,2
export const GET: APIRoute = async ({ url, locals }) => {
  if (!locals.usuario?.areasPermitidas.includes('finanzas')) {
    return jsonResponse({ ok: false, error: 'No autorizado' }, { status: 403 });
  }
  return handleApiRoute(() => {
    const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
    if (!parsed.success) throw new ApiValidationError(parsed.error.issues.map((i) => i.message).join('; '));
    const q = parsed.data;
    if (q.vista === 'empresas') return getEmpresas();
    return q.vista === 'rotacion' ? getRotacionPorCategoria(q.empresas) : getGastoReal(q.criterio, q.empresas);
  });
};
