import type { APIRoute } from 'astro';
import { exigirAreaRentabilidad } from '@/lib/rentabilidad/auth';
import { ApiValidationError, handleApiRoute } from '@/lib/api-helpers';
import { getFacturacionTest } from '@/lib/odoo/rentabilidad/facturacion-test';

export const prerender = false;

// GET /api/finanzas-test/facturacion?mes=2026-10&fuente=planilla|odoo — pestaña "Facturación productos" armada desde Odoo para un mes,
// contrastada línea por línea con la planilla. Sin `mes`: el último mes que tiene la planilla.
export const GET: APIRoute = async ({ url, locals }) => {
  const denegado = exigirAreaRentabilidad(locals);
  if (denegado) return denegado;
  return handleApiRoute(() => {
    const mes = url.searchParams.get('mes');
    if (mes !== null && !/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) throw new ApiValidationError('mes inválido (formato AAAA-MM)');
    const fuente = url.searchParams.get('fuente') === 'planilla' ? 'planilla' : 'odoo';
    return getFacturacionTest(mes, fuente);
  });
};
