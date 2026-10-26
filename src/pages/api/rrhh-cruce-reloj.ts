import type { APIRoute } from 'astro';
import { getRrhhCruceReloj } from '@/lib/rrhh-cruce-reloj';
import { handleApiRoute, ApiValidationError } from '@/lib/api-helpers';

export const prerender = false;

// GET /api/rrhh-cruce-reloj?desde=YYYY-MM-DD&hasta=YYYY-MM-DD
export const GET: APIRoute = async ({ url }) => {
  return handleApiRoute(() => {
    const desde = url.searchParams.get('desde');
    const hasta = url.searchParams.get('hasta');
    if (!desde || !hasta) throw new ApiValidationError('Faltan los parámetros desde y hasta');
    return getRrhhCruceReloj(desde, hasta);
  });
};
