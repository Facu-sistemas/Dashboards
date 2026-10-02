import type { APIRoute } from 'astro';
import { getProduccionDetalle } from '../../lib/odoo/produccion-detalle';
import { handleApiRoute } from '../../lib/api-helpers';

export const prerender = false;

// GET /api/produccion-detalle
export const GET: APIRoute = async () => {
  return handleApiRoute(() => getProduccionDetalle());
};
