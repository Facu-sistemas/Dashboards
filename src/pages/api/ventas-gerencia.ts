import type { APIRoute } from 'astro';
import { getVentasGerencia } from '../../lib/odoo/ventas-gerencia';
import { handleApiRoute } from '../../lib/api-helpers';

export const prerender = false;

// GET /api/ventas-gerencia
export const GET: APIRoute = async () => {
  return handleApiRoute(() => getVentasGerencia());
};
