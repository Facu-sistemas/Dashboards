import type { APIRoute } from 'astro';
import { z } from 'zod';
import { getOeeSummary } from '../../lib/odoo/oee';
import { handleApiRoute, ApiValidationError } from '../../lib/api-helpers';

export const prerender = false;

const querySchema = z.object({
  granularity: z.enum(['day', 'week', 'month']).default('month'),
  category: z.enum(['all', 'colchones', 'living']).default('all'),
});

// GET /api/oee?granularity=month&category=all
export const GET: APIRoute = async ({ url }) => {
  return handleApiRoute(() => {
    const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
    if (!parsed.success) {
      throw new ApiValidationError(parsed.error.issues.map((i) => i.message).join('; '));
    }
    return getOeeSummary(parsed.data.granularity, parsed.data.category);
  });
};
