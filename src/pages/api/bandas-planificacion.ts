import type { APIRoute } from 'astro';
import { z } from 'zod';
import { getBandasPlanificacion } from '../../lib/odoo/bandas';
import { handleApiRoute, ApiValidationError } from '../../lib/api-helpers';

export const prerender = false;

const querySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date debe ser YYYY-MM-DD'),
});

// GET /api/bandas-planificacion?date=2026-09-14
export const GET: APIRoute = async ({ url }) => {
  return handleApiRoute(() => {
    const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
    if (!parsed.success) {
      throw new ApiValidationError(parsed.error.issues.map((i) => i.message).join('; '));
    }
    return getBandasPlanificacion(parsed.data.date);
  });
};
