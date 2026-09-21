import type { APIRoute } from 'astro';
import { z } from 'zod';
import { getClientesActivos } from '../../lib/odoo/clientes-activos';
import { handleApiRoute, ApiValidationError } from '../../lib/api-helpers';

export const prerender = false;

const querySchema = z.object({
  periodo: z.enum(['30d', '3m', '6m', '9m']).default('30d'),
});

// GET /api/clientes-activos?periodo=6m
export const GET: APIRoute = async ({ url }) => {
  return handleApiRoute(() => {
    const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
    if (!parsed.success) {
      throw new ApiValidationError(parsed.error.issues.map((i) => i.message).join('; '));
    }
    return getClientesActivos(parsed.data.periodo);
  });
};
