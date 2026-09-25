import type { APIRoute } from 'astro';
import { getBandasTablasOdoo } from '../../lib/odoo/bandas';
import { handleApiRoute } from '../../lib/api-helpers';

export const prerender = false;

// GET /api/bandas-tablas-odoo
export const GET: APIRoute = async () => {
  return handleApiRoute(() => getBandasTablasOdoo());
};
