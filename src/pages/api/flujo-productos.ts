import type { APIRoute } from 'astro';
import { z } from 'zod';
import { searchFlujoProducts } from '../../lib/odoo/flujo-fabrica';
import { handleApiRoute, ApiValidationError } from '../../lib/api-helpers';

export const prerender = false;

const querySchema = z.object({
  q: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

// GET /api/flujo-productos?q=aero&limit=20
export const GET: APIRoute = async ({ url }) => {
  return handleApiRoute(() => {
    const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
    if (!parsed.success) {
      throw new ApiValidationError(parsed.error.issues.map((i) => i.message).join('; '));
    }
    return searchFlujoProducts(parsed.data.q, parsed.data.limit);
  });
};
