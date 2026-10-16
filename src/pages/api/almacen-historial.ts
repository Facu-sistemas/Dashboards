import type { APIRoute } from 'astro';
import { getHistorialMovimientos, HISTORIAL_RANGOS, type HistorialRango } from '@/lib/odoo/almacen';
import { ApiValidationError, handleApiRoute } from '@/lib/api-helpers';

export const prerender = false;

// GET /api/almacen-historial?rango=hoy|7d|30d|12m
export const GET: APIRoute = async ({ url }) => {
  return handleApiRoute(async () => {
    const rango = (url.searchParams.get('rango') ?? '7d') as HistorialRango;
    if (!HISTORIAL_RANGOS.includes(rango)) throw new ApiValidationError('rango inválido');
    return getHistorialMovimientos(rango);
  });
};
