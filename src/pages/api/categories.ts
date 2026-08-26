import type { APIRoute } from 'astro';
import { getProductCategories } from '../../lib/odoo/purchase-budget';
import { handleApiRoute } from '../../lib/api-helpers';

export const prerender = false;

// GET /api/categories
export const GET: APIRoute = async () => {
  return handleApiRoute(() => getProductCategories());
};
