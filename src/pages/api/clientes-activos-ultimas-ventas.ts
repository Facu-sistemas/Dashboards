import type { APIRoute } from 'astro';
import { getUltimasVentas } from '../../lib/odoo/clientes-activos';
import { handleApiRoute } from '../../lib/api-helpers';

export const prerender = false;

// GET /api/clientes-activos-ultimas-ventas
export const GET: APIRoute = async () => {
  return handleApiRoute(() => getUltimasVentas());
};
