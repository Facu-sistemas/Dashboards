import type { APIRoute } from 'astro';
import { z } from 'zod';
import { searchProductosEtiquetas } from '../../lib/odoo/etiquetas';
import { handleApiRoute, ApiValidationError } from '../../lib/api-helpers';

export const prerender = false;

const querySchema = z.object({
  q: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(15),
});

// GET /api/etiquetas-productos?q=cincha&limit=15
export const GET: APIRoute = async ({ url }) => {
  return handleApiRoute(() => {
    const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
    if (!parsed.success) {
      throw new ApiValidationError(parsed.error.issues.map((i) => i.message).join('; '));
    }
    return searchProductosEtiquetas(parsed.data.q, parsed.data.limit);
  });
};
