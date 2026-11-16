import type { APIRoute } from 'astro';
import { getRrhhNovedades } from '@/lib/odoo/rrhh-novedades';
import { handleApiRoute, ApiValidationError } from '@/lib/api-helpers';

export const prerender = false;

// GET /api/rrhh-novedades?desde=YYYY-MM-DD&hasta=YYYY-MM-DD — solo lectura.
export const GET: APIRoute = async ({ url }) => {
  return handleApiRoute(() => {
    const desde = url.searchParams.get('desde');
    const hasta = url.searchParams.get('hasta');
    if (!desde || !hasta) throw new ApiValidationError('Faltan los parámetros desde y hasta');
    return getRrhhNovedades(desde, hasta);
  });
};
