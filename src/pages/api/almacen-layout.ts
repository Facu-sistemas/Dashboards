import type { APIRoute } from 'astro';
import { getWarehouseLayout } from '../../lib/odoo/almacen';
import { handleApiRoute } from '../../lib/api-helpers';

export const prerender = false;

// GET /api/almacen-layout
export const GET: APIRoute = async () => {
  return handleApiRoute(() => getWarehouseLayout());
};
