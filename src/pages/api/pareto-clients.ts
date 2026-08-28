import type { APIRoute } from 'astro';
import { z } from 'zod';
import { getParetoClients } from '../../lib/odoo/pareto-clients';
import { handleApiRoute, ApiValidationError } from '../../lib/api-helpers';

export const prerender = false;

const querySchema = z.object({
  range: z.enum(['all', 'this-year', 'last-12-months', 'last-6-months']).default('all'),
});

// GET /api/pareto-clients?range=last-12-months
export const GET: APIRoute = async ({ url }) => {
  return handleApiRoute(() => {
    const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
    if (!parsed.success) {
      throw new ApiValidationError(parsed.error.issues.map((i) => i.message).join('; '));
    }
    return getParetoClients(parsed.data.range);
  });
};
