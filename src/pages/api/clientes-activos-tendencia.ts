import type { APIRoute } from 'astro';
import { getTendenciaMensual } from '../../lib/odoo/clientes-activos';
import { handleApiRoute } from '../../lib/api-helpers';

export const prerender = false;

// GET /api/clientes-activos-tendencia?todasNC=true
export const GET: APIRoute = async ({ url }) => {
  return handleApiRoute(() => getTendenciaMensual(url.searchParams.get('todasNC') === 'true'));
};
