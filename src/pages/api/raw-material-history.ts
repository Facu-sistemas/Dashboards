import type { APIRoute } from 'astro';
import { z } from 'zod';
import { getMaterialHistory } from '../../lib/odoo/raw-material-consumption';
import { handleApiRoute, ApiValidationError } from '../../lib/api-helpers';

export const prerender = false;

const querySchema = z.object({
  product_id: z.coerce.number().int().positive(),
});

// GET /api/raw-material-history?product_id=19
export const GET: APIRoute = async ({ url }) => {
  return handleApiRoute(() => {
    const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
    if (!parsed.success) {
      throw new ApiValidationError(parsed.error.issues.map((i) => i.message).join('; '));
    }
    return getMaterialHistory(parsed.data.product_id);
  });
};
