import type { APIRoute } from 'astro';
import { currentYear, getAjustesInventario } from '@/lib/odoo/ajustes-inventario';
import { ApiValidationError, handleApiRoute } from '@/lib/api-helpers';

export const prerender = false;

// GET /api/ajustes-inventario?year=2026[&categoria=...][&productId=...]
export const GET: APIRoute = async ({ url }) => {
  return handleApiRoute(() => {
    const raw = url.searchParams.get('year');
    const year = raw ? Number(raw) : currentYear();
    if (!Number.isInteger(year) || year < 2020 || year > 2100) throw new ApiValidationError('year inválido');
    const categoria = url.searchParams.get('categoria') || undefined;
    const rawProd = url.searchParams.get('productId');
    const productId = rawProd ? Number(rawProd) : undefined;
    if (productId !== undefined && !Number.isInteger(productId)) throw new ApiValidationError('productId inválido');
    return getAjustesInventario(year, { categoria, productId });
  });
};
