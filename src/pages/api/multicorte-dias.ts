import type { APIRoute } from 'astro';
import { getMulticorteDias } from '../../lib/odoo/multicorte';
import { handleApiRoute } from '../../lib/api-helpers';

export const prerender = false;

// GET /api/multicorte-dias
export const GET: APIRoute = async () => {
  return handleApiRoute(() => getMulticorteDias());
};
