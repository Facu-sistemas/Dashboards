import type { APIRoute } from 'astro';
import { z } from 'zod';
import { getFueraDeAlcance } from '../../lib/odoo/presupuesto-dinamico';
import { handleApiRoute, ApiValidationError } from '../../lib/api-helpers';

export const prerender = false;

const querySchema = z.object({
  year: z.coerce.number().int().min(2020).max(2100),
});

// GET /api/presupuesto-dinamico-fuera-de-alcance?year=2026
export const GET: APIRoute = async ({ url }) => {
  return handleApiRoute(() => {
    const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
    if (!parsed.success) {
      throw new ApiValidationError(parsed.error.issues.map((i) => i.message).join('; '));
    }
    return getFueraDeAlcance(parsed.data.year);
  });
};
