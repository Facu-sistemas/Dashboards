import type { APIRoute } from 'astro';
import { getCarteraClientes } from '../../lib/odoo/cartera-clientes';
import { handleApiRoute } from '../../lib/api-helpers';

export const prerender = false;

// GET /api/cartera-clientes?fuente=facturas
export const GET: APIRoute = async ({ url }) => {
  return handleApiRoute(() => {
    const fuente = url.searchParams.get('fuente') === 'facturas' ? 'facturas' : 'pedidos';
    return getCarteraClientes(fuente);
  });
};
