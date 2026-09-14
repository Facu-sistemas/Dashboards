import type { APIRoute } from 'astro';
import { z } from 'zod';
import { getPresupuestoDinamicoData } from '../../lib/odoo/presupuesto-dinamico';
import { getConsensoUnidades, getTcAsumido, consensoByMonthUnitMap, tcByMonthMap } from '../../lib/supabase/presupuesto-inputs';
import { handleApiRoute, ApiValidationError } from '../../lib/api-helpers';

export const prerender = false;

const querySchema = z.object({
  year: z.coerce.number().int().min(2020).max(2100),
});

// GET /api/presupuesto-dinamico-resumen?year=2026
export const GET: APIRoute = async ({ url }) => {
  return handleApiRoute(async () => {
    const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
    if (!parsed.success) {
      throw new ApiValidationError(parsed.error.issues.map((i) => i.message).join('; '));
    }
    const { year } = parsed.data;
    const [consensoRows, tcRows] = await Promise.all([getConsensoUnidades(year), getTcAsumido(year)]);
    return getPresupuestoDinamicoData(year, consensoByMonthUnitMap(consensoRows), tcByMonthMap(tcRows));
  });
};
