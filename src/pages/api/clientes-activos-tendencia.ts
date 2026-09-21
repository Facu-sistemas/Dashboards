import type { APIRoute } from 'astro';
import { getTendenciaMensual } from '../../lib/odoo/clientes-activos';
import { handleApiRoute } from '../../lib/api-helpers';

export const prerender = false;

// GET /api/clientes-activos-tendencia
export const GET: APIRoute = async () => {
  return handleApiRoute(() => getTendenciaMensual());
};
