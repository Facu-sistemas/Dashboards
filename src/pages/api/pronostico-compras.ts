import type { APIRoute } from 'astro';
import { getPronosticoCompras } from '../../lib/odoo/pronostico-compras';
import { handleApiRoute, jsonResponse } from '../../lib/api-helpers';

export const prerender = false;

// GET /api/pronostico-compras — avisos de compra de materia prima + reporte mensual pronóstico / consumo / compras.
export const GET: APIRoute = async ({ locals }) => {
  if (!locals.usuario?.areasPermitidas.includes('test')) {
    return jsonResponse({ ok: false, error: 'No autorizado' }, { status: 403 });
  }
  return handleApiRoute(() => getPronosticoCompras());
};
