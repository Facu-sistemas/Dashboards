import type { APIRoute } from 'astro';
import { getUsdToArsRate } from '../../lib/odoo/currency';
import { handleApiRoute } from '../../lib/api-helpers';

export const prerender = false;

// GET /api/fx-rate — informational USD->ARS badge only, never used to convert stored amounts.
export const GET: APIRoute = async () => {
  return handleApiRoute(() => getUsdToArsRate());
};
