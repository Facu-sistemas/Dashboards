import type { APIRoute } from 'astro';
import { jsonResponse } from '@/lib/api-helpers';
import { construirAlertaReposicion } from '@/lib/odoo/alerta-reposicion';

export const prerender = false;

// GET /api/alerta-reposicion — reglas de Odoo con pronóstico bajo el mínimo y la cantidad a pedir. Lee Odoo en vivo (solo lectura).
export const GET: APIRoute = async ({ locals }) => {
  if (!locals.usuario?.areasPermitidas.includes('compras')) return jsonResponse({ ok: false, error: 'No autorizado' }, { status: 403 });
  try {
    return jsonResponse({ ok: true, data: await construirAlertaReposicion() });
  } catch (e) {
    console.error('[alerta-reposicion] error armando la alerta de reposición', e);
    return jsonResponse({ ok: false, error: 'No se pudo leer la reposición desde Odoo' }, { status: 500 });
  }
};
