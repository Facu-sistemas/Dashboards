import type { APIRoute } from 'astro';
import { getVerticalDias } from '../../lib/odoo/vertical';
import { handleApiRoute } from '../../lib/api-helpers';

export const prerender = false;

// GET /api/vertical-dias
export const GET: APIRoute = async () => {
  return handleApiRoute(() => getVerticalDias());
};
