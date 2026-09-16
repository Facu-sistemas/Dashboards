import type { APIRoute } from 'astro';
import { z } from 'zod';
import { getMulticorteDemanda, getMulticorteBaseTecnica } from '../../lib/odoo/multicorte';
import { procesarOptimizacion } from '../../lib/multicorte-calc';
import { handleApiRoute, ApiValidationError } from '../../lib/api-helpers';

export const prerender = false;

const querySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'date debe ser YYYY-MM-DD')
    .optional(),
});

// GET /api/multicorte-plan?date=2026-09-16 — demanda pendiente (mrp.production,
// opcionalmente acotada a un día de planificación) + base técnica
// (Medidas_multicorte), ambas en vivo desde Odoo, optimizadas en el server.
export const GET: APIRoute = async ({ url }) => {
  return handleApiRoute(async () => {
    const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
    if (!parsed.success) {
      throw new ApiValidationError(parsed.error.issues.map((i) => i.message).join('; '));
    }
    const [demanda, baseTecnica] = await Promise.all([getMulticorteDemanda(parsed.data.date), getMulticorteBaseTecnica()]);
    return procesarOptimizacion(demanda, baseTecnica.placas, baseTecnica.blocks);
  });
};
