import type { APIRoute } from 'astro';
import { getUltimosMovimientos } from '../../lib/odoo/almacen';
import { handleApiRoute } from '../../lib/api-helpers';

export const prerender = false;

// GET /api/almacen-movimientos
export const GET: APIRoute = async () => {
  return handleApiRoute(() => getUltimosMovimientos());
};
