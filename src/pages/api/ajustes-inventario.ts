import type { APIRoute } from 'astro';
import { currentYear, getAjustesInventario } from '@/lib/odoo/ajustes-inventario';
import { ApiValidationError, handleApiRoute } from '@/lib/api-helpers';

export const prerender = false;

// GET /api/ajustes-inventario?year=2026
export const GET: APIRoute = async ({ url }) => {
  return handleApiRoute(() => {
    const raw = url.searchParams.get('year');
    const year = raw ? Number(raw) : currentYear();
    if (!Number.isInteger(year) || year < 2020 || year > 2100) throw new ApiValidationError('year inválido');
    return getAjustesInventario(year);
  });
};
