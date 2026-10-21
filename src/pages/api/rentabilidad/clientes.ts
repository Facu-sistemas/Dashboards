import type { APIRoute } from 'astro';
import { exigirAreaRentabilidad } from '@/lib/rentabilidad/auth';
import { handleApiRoute, ApiValidationError } from '@/lib/api-helpers';
import { getClienteDetalle, getClientes, parseFiltros } from '@/lib/odoo/rentabilidad/consultas';

export const prerender = false;

// GET /api/rentabilidad/clientes?anio=2026&mesIni=1&mesFin=3&categoria=Sillon[&detalle=<clienteId>]
// Sin `detalle`: ranking de clientes. Con `detalle`: productos de ese cliente en el período.
export const GET: APIRoute = async ({ url, locals }) => {
  const denegado = exigirAreaRentabilidad(locals);
  if (denegado) return denegado;

  return handleApiRoute(() => {
    const filtros = parseFiltros(url.searchParams);
    const detalle = url.searchParams.get('detalle');
    if (detalle !== null) {
      const id = Number(detalle);
      if (!Number.isInteger(id) || id < 0) throw new ApiValidationError('detalle inválido');
      return getClienteDetalle(filtros, id);
    }
    return getClientes(filtros);
  });
};
