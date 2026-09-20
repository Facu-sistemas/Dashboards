import type { APIRoute } from 'astro';
import { z } from 'zod';
import { getNotasCreditoCliente } from '../../lib/odoo/clientes-activos';
import { handleApiRoute, ApiValidationError } from '../../lib/api-helpers';

export const prerender = false;

const querySchema = z.object({
  partnerId: z.coerce.number().int().positive(),
  meses: z.coerce.number().pipe(z.union([z.literal(3), z.literal(6), z.literal(9)])),
});

// GET /api/clientes-activos-notas-credito?partnerId=123&meses=6
export const GET: APIRoute = async ({ url }) => {
  return handleApiRoute(() => {
    const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
    if (!parsed.success) {
      throw new ApiValidationError(parsed.error.issues.map((i) => i.message).join('; '));
    }
    return getNotasCreditoCliente(parsed.data.partnerId, parsed.data.meses);
  });
};
