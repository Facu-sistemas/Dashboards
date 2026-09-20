import type { APIRoute } from 'astro';
import { z } from 'zod';
import { getClientesActivos } from '../../lib/odoo/clientes-activos';
import { handleApiRoute, ApiValidationError } from '../../lib/api-helpers';

export const prerender = false;

const querySchema = z.object({
  meses: z.coerce.number().pipe(z.union([z.literal(3), z.literal(6), z.literal(9)])).default(3),
});

// GET /api/clientes-activos?meses=6
export const GET: APIRoute = async ({ url }) => {
  return handleApiRoute(() => {
    const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
    if (!parsed.success) {
      throw new ApiValidationError(parsed.error.issues.map((i) => i.message).join('; '));
    }
    return getClientesActivos(parsed.data.meses);
  });
};
