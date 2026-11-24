import type { APIRoute } from 'astro';
import { exigirAreaRentabilidad } from '@/lib/rentabilidad/auth';
import { handleApiRoute } from '@/lib/api-helpers';
import { getCostosProductosTest } from '@/lib/odoo/rentabilidad/costos-productos-test';

export const prerender = false;

// GET /api/finanzas-test/costos-productos?fuente=planilla|odoo — pestaña "COSTOS PRODUCTOS" calculada desde Odoo, contrastada con la planilla.
export const GET: APIRoute = async ({ url, locals }) => {
  const denegado = exigirAreaRentabilidad(locals);
  if (denegado) return denegado;
  const fuente = url.searchParams.get('fuente') === 'planilla' ? 'planilla' : 'odoo';
  return handleApiRoute(() => getCostosProductosTest(fuente));
};
