import type { APIRoute } from 'astro';
import { getPoliticaVsReal } from '../../lib/odoo/politica-vs-real';
import { handleApiRoute } from '../../lib/api-helpers';

export const prerender = false;

// GET /api/politica-vs-real
// Umbral y corte (categoría/clase ABC) se aplican en el cliente sobre el
// mismo payload — no requieren un nuevo request a Odoo.
export const GET: APIRoute = async () => {
  return handleApiRoute(() => getPoliticaVsReal());
};
