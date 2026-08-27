import type { APIRoute } from 'astro';
import { z } from 'zod';
import { getFacturacionTrend } from '../../lib/odoo/facturacion';
import { handleApiRoute, ApiValidationError } from '../../lib/api-helpers';

export const prerender = false;

const querySchema = z.object({
  months: z.coerce.number().int().min(2).max(24).default(12),
});

// GET /api/facturacion-trend?months=12
export const GET: APIRoute = async ({ url }) => {
  return handleApiRoute(() => {
    const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
    if (!parsed.success) {
      throw new ApiValidationError(parsed.error.issues.map((i) => i.message).join('; '));
    }
    return getFacturacionTrend(parsed.data.months);
  });
};
