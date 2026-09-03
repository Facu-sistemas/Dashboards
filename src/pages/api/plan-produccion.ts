import type { APIRoute } from 'astro';
import { z } from 'zod';
import { getPlanProduccion } from '../../lib/odoo/plan-produccion';
import { handleApiRoute, ApiValidationError } from '../../lib/api-helpers';
import { getArgentinaTodayIso } from '../../lib/odoo/oee';

export const prerender = false;

const querySchema = z.object({
  period: z.enum(['day', 'week', 'month', 'year']).default('month'),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD')
    .optional(),
});

// GET /api/plan-produccion?period=month&date=2026-09-01
export const GET: APIRoute = async ({ url }) => {
  return handleApiRoute(() => {
    const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
    if (!parsed.success) {
      throw new ApiValidationError(parsed.error.issues.map((i) => i.message).join('; '));
    }
    return getPlanProduccion(parsed.data.period, parsed.data.date ?? getArgentinaTodayIso());
  });
};
