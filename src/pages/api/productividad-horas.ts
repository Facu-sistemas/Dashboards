import type { APIRoute } from 'astro';
import { getProductividadHoras } from '@/lib/productividad-horas';
import { handleApiRoute, jsonResponse } from '@/lib/api-helpers';

export const prerender = false;

// GET /api/productividad-horas?dias=30 — producción de Odoo cruzada con las horas del fichador. Solo dev (hay horas de personas).
export const GET: APIRoute = async (context) => {
  if (context.locals.usuario?.rol !== 'dev') {
    return jsonResponse({ ok: false, error: 'No autorizado' }, { status: 403 });
  }
  const dias = Math.min(90, Math.max(7, Number(context.url.searchParams.get('dias')) || 30));
  return handleApiRoute(() => getProductividadHoras(dias));
};
