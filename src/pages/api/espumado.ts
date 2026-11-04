import type { APIRoute } from 'astro';
import { z } from 'zod';
import { getEspumado, getEspumadoMovimientos } from '@/lib/odoo/espumado';
import { handleApiRoute, ApiValidationError } from '@/lib/api-helpers';

export const prerender = false;

const querySchema = z.object({
  dias: z.coerce.number().int().min(1).max(90).default(30),
  producto: z.coerce.number().int().positive().optional(),
});

// GET /api/espumado?dias=30            -> resumen por tipo de block + series diarias
// GET /api/espumado?dias=30&producto=ID -> movimientos crudos de ese tipo
export const GET: APIRoute = async ({ url }) => {
  return handleApiRoute(() => {
    const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
    if (!parsed.success) {
      throw new ApiValidationError(parsed.error.issues.map((i) => i.message).join('; '));
    }
    const { dias, producto } = parsed.data;
    return producto ? getEspumadoMovimientos(producto, dias) : getEspumado(dias);
  });
};
