import type { APIRoute } from 'astro';
import { z } from 'zod';
import { searchModelosCarpinteria } from '../../lib/odoo/carpinteria';
import { handleApiRoute, ApiValidationError } from '../../lib/api-helpers';

export const prerender = false;

const querySchema = z.object({
  q: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

// GET /api/carpinteria-modelos?q=aero&limit=20&offset=0
export const GET: APIRoute = async ({ url }) => {
  return handleApiRoute(() => {
    const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
    if (!parsed.success) {
      throw new ApiValidationError(parsed.error.issues.map((i) => i.message).join('; '));
    }
    return searchModelosCarpinteria(parsed.data.q, parsed.data.limit, parsed.data.offset);
  });
};
