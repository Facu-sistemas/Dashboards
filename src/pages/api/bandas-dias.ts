import type { APIRoute } from 'astro';
import { getBandasDias } from '../../lib/odoo/bandas';
import { handleApiRoute } from '../../lib/api-helpers';

export const prerender = false;

// GET /api/bandas-dias
export const GET: APIRoute = async () => {
  return handleApiRoute(() => getBandasDias());
};
