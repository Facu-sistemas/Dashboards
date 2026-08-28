import type { APIRoute } from 'astro';
import { z } from 'zod';
import { getProductPriceTrend } from '../../lib/odoo/product-price-trend';
import { handleApiRoute, ApiValidationError } from '../../lib/api-helpers';

export const prerender = false;

const querySchema = z.object({
  product_id: z.coerce.number().int().positive(),
});

// GET /api/product-price-trend?product_id=31133
export const GET: APIRoute = async ({ url }) => {
  return handleApiRoute(() => {
    const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
    if (!parsed.success) {
      throw new ApiValidationError(parsed.error.issues.map((i) => i.message).join('; '));
    }
    return getProductPriceTrend(parsed.data.product_id);
  });
};
