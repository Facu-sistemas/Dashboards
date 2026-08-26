import type { APIRoute } from 'astro';
import { z } from 'zod';
import { getMonthlyComplianceTrend } from '../../lib/odoo/purchase-budget';
import { handleApiRoute, ApiValidationError } from '../../lib/api-helpers';

export const prerender = false;

const querySchema = z.object({
  months: z.coerce.number().int().min(2).max(24).default(6),
  category_id: z.coerce.number().int().positive().optional(),
});

// GET /api/purchase-budget-trend?months=6&category_id=35
export const GET: APIRoute = async ({ url }) => {
  return handleApiRoute(() => {
    const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
    if (!parsed.success) {
      throw new ApiValidationError(parsed.error.issues.map((i) => i.message).join('; '));
    }
    return getMonthlyComplianceTrend(parsed.data.months, parsed.data.category_id);
  });
};
