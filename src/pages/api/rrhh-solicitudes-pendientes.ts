import type { APIRoute } from 'astro';
import { estadoSolicitudes } from '@/lib/supabase/rrhh-solicitudes-retiro';
import { puedeVerSolicitudes } from '@/lib/rrhh-permisos';
import { handleApiRoute, jsonResponse } from '@/lib/api-helpers';

export const prerender = false;

// GET /api/rrhh-solicitudes-pendientes?desde=ISO — cuántas esperan respuesta, cuándo fue la última y cuántas pendientes son posteriores a `desde`. Lo consulta el aviso en vivo. Solo dev y rrhh.
export const GET: APIRoute = async (context) => {
  if (!puedeVerSolicitudes(context.locals.usuario)) return jsonResponse({ ok: false, error: 'No autorizado' }, { status: 403 });
  const desde = context.url.searchParams.get('desde') ?? undefined;
  return handleApiRoute(async () => estadoSolicitudes(desde && !Number.isNaN(Date.parse(desde)) ? desde : undefined));
};
