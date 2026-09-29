import type { APIRoute } from 'astro';
import { z } from 'zod';
import { getFlujoTrace } from '../../lib/odoo/flujo-fabrica';
import { handleApiRoute, ApiValidationError } from '../../lib/api-helpers';

export const prerender = false;

const querySchema = z.object({
  orderId: z.coerce.number().int().positive(),
});

// GET /api/flujo-trazado?orderId=17791
export const GET: APIRoute = async ({ url }) => {
  return handleApiRoute(() => {
    const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
    if (!parsed.success) {
      throw new ApiValidationError(parsed.error.issues.map((i) => i.message).join('; '));
    }
    return getFlujoTrace(parsed.data.orderId);
  });
};
