import type { APIRoute } from 'astro';
import { listMarcasRecientes } from '@/lib/supabase/fichaje-marcas';
import { handleApiRoute, jsonResponse } from '@/lib/api-helpers';

export const prerender = false;

// GET /api/admin/fichaje-marcas-recientes — últimas fichadas, para que el panel de kioscos se actualice solo y suene. Solo dev.
export const GET: APIRoute = async (context) => {
  if (context.locals.usuario?.rol !== 'dev') {
    return jsonResponse({ ok: false, error: 'No autorizado' }, { status: 403 });
  }
  return handleApiRoute(async () => {
    const marcas = await listMarcasRecientes(300);
    return { ok: true, marcas };
  });
};
