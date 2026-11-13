import type { APIRoute } from 'astro';
import { listMarcasRecientes } from '@/lib/supabase/fichaje-marcas';
import { listKioscos } from '@/lib/supabase/fichaje-kioscos';
import { handleApiRoute, jsonResponse } from '@/lib/api-helpers';

export const prerender = false;

// GET /api/admin/fichaje-marcas-recientes — últimas fichadas, para que el panel de kioscos se actualice solo y suene. Solo dev.
export const GET: APIRoute = async (context) => {
  if (context.locals.usuario?.rol !== 'dev') {
    return jsonResponse({ ok: false, error: 'No autorizado' }, { status: 403 });
  }
  return handleApiRoute(async () => {
    const [marcas, latidos] = await Promise.all([listMarcasRecientes(300), listKioscos().catch(() => [])]);
    return { ok: true, marcas, latidos };
  });
};
