import type { APIRoute } from 'astro';
import { getCreditoClientes } from '../../lib/odoo/credito-clientes';
import { handleApiRoute } from '../../lib/api-helpers';

export const prerender = false;

// GET /api/credito-clientes
export const GET: APIRoute = async () => {
  return handleApiRoute(() => getCreditoClientes());
};
