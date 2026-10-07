import type { APIRoute } from 'astro';
import { getLineaDias } from '../../lib/odoo/linea-resorte';
import { handleApiRoute } from '../../lib/api-helpers';

export const prerender = false;

// GET /api/linea-dias
export const GET: APIRoute = async () => {
  return handleApiRoute(() => getLineaDias());
};
