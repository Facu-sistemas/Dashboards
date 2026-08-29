import type { APIRoute } from 'astro';
import { z } from 'zod';
import { getRecetaListones } from '../../lib/odoo/carpinteria';
import { handleApiRoute, ApiValidationError } from '../../lib/api-helpers';

export const prerender = false;

const querySchema = z.object({
  modelo: z.string().trim().min(1).max(200),
});

// GET /api/carpinteria-receta?modelo=BENETON%202CPO
export const GET: APIRoute = async ({ url }) => {
  return handleApiRoute(() => {
    const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
    if (!parsed.success) {
      throw new ApiValidationError(parsed.error.issues.map((i) => i.message).join('; '));
    }
    return getRecetaListones(parsed.data.modelo);
  });
};
