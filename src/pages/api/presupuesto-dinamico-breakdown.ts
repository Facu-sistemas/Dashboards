import type { APIRoute } from 'astro';
import { z } from 'zod';
import { getInsumoBreakdown } from '../../lib/odoo/presupuesto-dinamico';
import { getConsensoUnidades, getTcAsumido, consensoByMonthUnitMap, tcByMonthMap } from '../../lib/supabase/presupuesto-inputs';
import { handleApiRoute, ApiValidationError } from '../../lib/api-helpers';

export const prerender = false;

const querySchema = z.object({
  year: z.coerce.number().int().min(2020).max(2100),
  productId: z.coerce.number().int().positive(),
  month: z.string().regex(/^\d{4}-\d{2}$/),
});

// GET /api/presupuesto-dinamico-breakdown?year=2026&productId=123&month=2026-03
// Drill-down for a single insumo/month cell in the Categoría → Insumo table.
export const GET: APIRoute = async ({ url }) => {
  return handleApiRoute(async () => {
    const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
    if (!parsed.success) {
      throw new ApiValidationError(parsed.error.issues.map((i) => i.message).join('; '));
    }
    const { year, productId, month } = parsed.data;
    if (!month.startsWith(String(year))) {
      throw new ApiValidationError('El mes no pertenece al año solicitado');
    }
    const [consensoRows, tcRows] = await Promise.all([getConsensoUnidades(year), getTcAsumido(year)]);
    return getInsumoBreakdown(year, consensoByMonthUnitMap(consensoRows), tcByMonthMap(tcRows), productId, month);
  });
};
