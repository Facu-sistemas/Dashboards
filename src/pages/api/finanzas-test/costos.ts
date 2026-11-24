import type { APIRoute } from 'astro';
import { exigirAreaRentabilidad } from '@/lib/rentabilidad/auth';
import { handleApiRoute } from '@/lib/api-helpers';
import { getCostosTest } from '@/lib/odoo/rentabilidad/costos-test';

export const prerender = false;

// GET /api/finanzas-test/costos — pestaña "Costos" de la planilla armada desde Odoo, contrastada contra la planilla.
export const GET: APIRoute = async ({ locals }) => {
  const denegado = exigirAreaRentabilidad(locals);
  if (denegado) return denegado;
  return handleApiRoute(() => getCostosTest());
};
