import type { APIRoute } from 'astro';
import { z } from 'zod';
import { getCategoryBudgetCompliance } from '../../lib/odoo/purchase-budget';
import { handleApiRoute, ApiValidationError } from '../../lib/api-helpers';

export const prerender = false;

const querySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, 'month must be YYYY-MM'),
  category_id: z.coerce.number().int().positive().optional(),
});

// GET /api/purchase-budget?month=2026-08&category_id=35
export const GET: APIRoute = async ({ url }) => {
  return handleApiRoute(() => {
    const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
    if (!parsed.success) {
      throw new ApiValidationError(parsed.error.issues.map((i) => i.message).join('; '));
    }
    return getCategoryBudgetCompliance(parsed.data.month, parsed.data.category_id);
  });
};
