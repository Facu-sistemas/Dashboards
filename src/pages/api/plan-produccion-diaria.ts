import type { APIRoute } from 'astro';
import { z } from 'zod';
import { getPlanProduccionDiaria } from '../../lib/odoo/plan-produccion';
import { handleApiRoute, ApiValidationError } from '../../lib/api-helpers';
import { getArgentinaTodayIso } from '../../lib/odoo/oee';

export const prerender = false;

const querySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD')
    .optional(),
});

// GET /api/plan-produccion-diaria?date=2026-08-15
export const GET: APIRoute = async ({ url }) => {
  return handleApiRoute(() => {
    const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
    if (!parsed.success) {
      throw new ApiValidationError(parsed.error.issues.map((i) => i.message).join('; '));
    }
    return getPlanProduccionDiaria(parsed.data.date ?? getArgentinaTodayIso());
  });
};
