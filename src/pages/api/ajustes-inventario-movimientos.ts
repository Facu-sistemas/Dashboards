import type { APIRoute } from 'astro';
import { getAjusteMovimientos } from '@/lib/odoo/ajustes-inventario';
import { ApiValidationError, handleApiRoute } from '@/lib/api-helpers';

export const prerender = false;

// GET /api/ajustes-inventario-movimientos?year=2026&mes=2026-07&productId=123
// Drill-down de la fila de un producto en el detalle por mes de Ajustes de inventario:
// todas las capas de Valoración que suman su Cant. neta / $ neto de ese mes.
export const GET: APIRoute = async ({ url }) => {
  return handleApiRoute(() => {
    const rawYear = url.searchParams.get('year');
    const year = rawYear ? Number(rawYear) : NaN;
    if (!Number.isInteger(year) || year < 2020 || year > 2100) throw new ApiValidationError('year inválido');
    const mes = url.searchParams.get('mes');
    if (!mes || !/^\d{4}-\d{2}$/.test(mes)) throw new ApiValidationError('mes inválido');
    const rawProd = url.searchParams.get('productId');
    const productId = rawProd ? Number(rawProd) : NaN;
    if (!Number.isInteger(productId)) throw new ApiValidationError('productId inválido');
    return getAjusteMovimientos(year, mes, productId);
  });
};
