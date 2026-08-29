import type { APIRoute } from 'astro';
import { z } from 'zod';
import { getTicketsSoporte } from '../../lib/odoo/calidad';
import { handleApiRoute, ApiValidationError } from '../../lib/api-helpers';

export const prerender = false;

const querySchema = z.object({
  range: z.enum(['all', 'this-year', 'last-12-months', 'last-6-months']).default('last-12-months'),
});

// GET /api/tickets-soporte?range=last-12-months
export const GET: APIRoute = async ({ url }) => {
  return handleApiRoute(() => {
    const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
    if (!parsed.success) {
      throw new ApiValidationError(parsed.error.issues.map((i) => i.message).join('; '));
    }
    return getTicketsSoporte(parsed.data.range);
  });
};
