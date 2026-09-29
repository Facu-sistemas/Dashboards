import type { APIRoute } from 'astro';
import { z } from 'zod';
import { getFlujoSimulation } from '../../lib/odoo/flujo-fabrica';
import { handleApiRoute, ApiValidationError } from '../../lib/api-helpers';

export const prerender = false;

const querySchema = z.object({
  productId: z.coerce.number().int().positive(),
});

// GET /api/flujo-simulacion?productId=9344
export const GET: APIRoute = async ({ url }) => {
  return handleApiRoute(() => {
    const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
    if (!parsed.success) {
      throw new ApiValidationError(parsed.error.issues.map((i) => i.message).join('; '));
    }
    return getFlujoSimulation(parsed.data.productId);
  });
};
