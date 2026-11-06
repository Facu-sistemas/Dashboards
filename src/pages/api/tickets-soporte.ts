import type { APIRoute } from 'astro';
import { z } from 'zod';
import { getTicketsSoporte } from '@/lib/odoo/calidad';
import { handleApiRoute, ApiValidationError } from '@/lib/api-helpers';

export const prerender = false;

const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (YYYY-MM-DD)');
const querySchema = z.object({ desde: fecha, hasta: fecha });

// GET /api/tickets-soporte?desde=2026-11-01&hasta=2026-11-30  (fechas inclusivas, día argentino)
export const GET: APIRoute = async ({ url }) => {
  return handleApiRoute(() => {
    const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
    if (!parsed.success) {
      throw new ApiValidationError(parsed.error.issues.map((i) => i.message).join('; '));
    }
    if (parsed.data.desde > parsed.data.hasta) throw new ApiValidationError('"desde" no puede ser posterior a "hasta".');
    return getTicketsSoporte(parsed.data.desde, parsed.data.hasta);
  });
};
