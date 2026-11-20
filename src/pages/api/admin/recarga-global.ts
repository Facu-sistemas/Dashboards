import type { APIRoute } from 'astro';
import { pedirRecargaGlobal } from '@/lib/supabase/recarga-global';
import { handleApiRoute, jsonResponse, ApiValidationError } from '@/lib/api-helpers';

export const prerender = false;

// POST /api/admin/recarga-global — pide que todas las páginas abiertas se recarguen. Solo dev.
export const POST: APIRoute = async (context) => {
  if (context.locals.usuario?.rol !== 'dev') {
    return jsonResponse({ ok: false, error: 'No autorizado' }, { status: 403 });
  }
  return handleApiRoute(async () => {
    try {
      return { marca: await pedirRecargaGlobal() };
    } catch (err) {
      throw new ApiValidationError(err instanceof Error ? err.message : 'No se pudo pedir la recarga');
    }
  });
};
