import type { APIRoute } from 'astro';
import { getTendenciaMensual } from '../../lib/odoo/clientes-activos';
import { handleApiRoute } from '../../lib/api-helpers';

export const prerender = false;

// GET /api/clientes-activos-tendencia?todasNC=true&companies=1,2&fuente=facturas
export const GET: APIRoute = async ({ url }) => {
  return handleApiRoute(() => {
    const companiesParam = url.searchParams.get('companies');
    const companyIds = companiesParam
      ? companiesParam.split(',').map(Number).filter((n) => Number.isFinite(n))
      : undefined;
    const fuente = url.searchParams.get('fuente') === 'facturas' ? 'facturas' : 'pedidos';
    return getTendenciaMensual(url.searchParams.get('todasNC') === 'true', companyIds, fuente);
  });
};
