import type { APIRoute } from 'astro';
import { z } from 'zod';
import { findFlujoOrdersForProduct } from '../../lib/odoo/flujo-fabrica';
import { handleApiRoute, ApiValidationError } from '../../lib/api-helpers';

export const prerender = false;

const querySchema = z.object({
  productId: z.coerce.number().int().positive(),
  limit: z.coerce.number().int().min(1).max(20).default(8),
});

// GET /api/flujo-ordenes?productId=9344&limit=8
export const GET: APIRoute = async ({ url }) => {
  return handleApiRoute(() => {
    const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
    if (!parsed.success) {
      throw new ApiValidationError(parsed.error.issues.map((i) => i.message).join('; '));
    }
    return findFlujoOrdersForProduct(parsed.data.productId, parsed.data.limit);
  });
};
