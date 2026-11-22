import type { APIRoute } from 'astro';
import { contarPendientesOError } from '@/lib/supabase/rrhh-solicitudes-retiro';
import { puedeAdministrarRrhh } from '@/lib/rrhh-permisos';
import { handleApiRoute, jsonResponse } from '@/lib/api-helpers';

export const prerender = false;

// GET /api/rrhh-solicitudes-pendientes — cuántas solicitudes de retiro esperan respuesta (lo consulta el aviso en vivo). Solo dev y rrhh.
export const GET: APIRoute = async (context) => {
  if (!puedeAdministrarRrhh(context.locals.usuario)) return jsonResponse({ ok: false, error: 'No autorizado' }, { status: 403 });
  return handleApiRoute(async () => ({ pendientes: await contarPendientesOError() }));
};
