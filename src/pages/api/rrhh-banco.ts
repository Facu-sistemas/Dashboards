import type { APIRoute } from 'astro';
import { getRrhhBanco } from '@/lib/odoo/rrhh-banco';
import { handleApiRoute, ApiValidationError } from '@/lib/api-helpers';

export const prerender = false;

// GET /api/rrhh-banco?desde=YYYY-MM-DD&hasta=YYYY-MM-DD — movimientos del banco de horas. Solo lectura.
export const GET: APIRoute = async ({ url }) => {
  return handleApiRoute(() => {
    const desde = url.searchParams.get('desde');
    const hasta = url.searchParams.get('hasta');
    if (!desde || !hasta) throw new ApiValidationError('Faltan los parámetros desde y hasta');
    return getRrhhBanco(desde, hasta);
  });
};
