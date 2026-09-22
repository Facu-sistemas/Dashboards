import type { APIRoute } from 'astro';
import { z } from 'zod';
import { getNotasCreditoCliente } from '../../lib/odoo/clientes-activos';
import { handleApiRoute, ApiValidationError } from '../../lib/api-helpers';

export const prerender = false;

const querySchema = z.object({
  partnerId: z.coerce.number().int().positive(),
  periodo: z.enum(['30d', '3m', '6m', '9m']),
  companies: z.string().optional(),
});

// GET /api/clientes-activos-notas-credito?partnerId=123&periodo=6m&companies=1,2
export const GET: APIRoute = async ({ url }) => {
  return handleApiRoute(() => {
    const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
    if (!parsed.success) {
      throw new ApiValidationError(parsed.error.issues.map((i) => i.message).join('; '));
    }
    const companyIds = parsed.data.companies
      ? parsed.data.companies.split(',').map(Number).filter((n) => Number.isFinite(n))
      : undefined;
    return getNotasCreditoCliente(parsed.data.partnerId, parsed.data.periodo, companyIds);
  });
};
