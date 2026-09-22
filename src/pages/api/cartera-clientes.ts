import type { APIRoute } from 'astro';
import { getCarteraClientes } from '../../lib/odoo/cartera-clientes';
import { handleApiRoute } from '../../lib/api-helpers';

export const prerender = false;

// GET /api/cartera-clientes
export const GET: APIRoute = async () => {
  return handleApiRoute(() => getCarteraClientes());
};
