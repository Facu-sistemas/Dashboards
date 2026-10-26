import type { APIRoute } from 'astro';
import { getRrhhQuincena } from '@/lib/odoo/rrhh-quincena';
import { handleApiRoute, ApiValidationError } from '@/lib/api-helpers';

export const prerender = false;

// GET /api/rrhh-quincena?desde=YYYY-MM-DD&hasta=YYYY-MM-DD
export const GET: APIRoute = async ({ url }) => {
  return handleApiRoute(() => {
    const desde = url.searchParams.get('desde');
    const hasta = url.searchParams.get('hasta');
    if (!desde || !hasta) throw new ApiValidationError('Faltan los parámetros desde y hasta');
    return getRrhhQuincena(desde, hasta);
  });
};
