import type { APIRoute } from 'astro';
import { getProduccionGerencia } from '../../lib/odoo/produccion-gerencia';
import { handleApiRoute } from '../../lib/api-helpers';

export const prerender = false;

// GET /api/produccion-gerencia
export const GET: APIRoute = async () => {
  return handleApiRoute(() => getProduccionGerencia());
};
