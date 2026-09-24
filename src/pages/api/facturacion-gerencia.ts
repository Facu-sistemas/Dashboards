import type { APIRoute } from 'astro';
import { getFacturacionGerencia } from '../../lib/odoo/facturacion-gerencia';
import { handleApiRoute } from '../../lib/api-helpers';

export const prerender = false;

// GET /api/facturacion-gerencia
export const GET: APIRoute = async () => {
  return handleApiRoute(() => getFacturacionGerencia());
};
