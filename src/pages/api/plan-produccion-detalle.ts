import type { APIRoute } from 'astro';
import { z } from 'zod';
import { getPlanProduccionDetalle } from '../../lib/odoo/plan-produccion-detalle';
import { handleApiRoute, ApiValidationError } from '../../lib/api-helpers';
import { getArgentinaTodayIso } from '../../lib/odoo/oee';

export const prerender = false;

const querySchema = z.object({
  familia: z.enum(['living', 'colchones']).default('living'),
  period: z.enum(['week', 'month', 'year']).default('month'),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD')
    .optional(),
});

// GET /api/plan-produccion-detalle?familia=living&period=month&date=2026-09-01
export const GET: APIRoute = async ({ url }) => {
  return handleApiRoute(() => {
    const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
    if (!parsed.success) {
      throw new ApiValidationError(parsed.error.issues.map((i) => i.message).join('; '));
    }
    return getPlanProduccionDetalle(parsed.data.familia, parsed.data.period, parsed.data.date ?? getArgentinaTodayIso());
  });
};
