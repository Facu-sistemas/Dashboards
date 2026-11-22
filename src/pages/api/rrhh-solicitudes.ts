import type { APIRoute } from 'astro';
import { z } from 'zod';
import { listSolicitudes, resolverSolicitud } from '@/lib/supabase/rrhh-solicitudes-retiro';
import { puedeAdministrarRrhh } from '@/lib/rrhh-permisos';
import { handleApiRoute, jsonResponse, ApiValidationError } from '@/lib/api-helpers';

export const prerender = false;

const putSchema = z.object({
  id: z.string().uuid(),
  decision: z.enum(['aprobada', 'rechazada']),
  comentario: z.string().trim().max(500).optional(),
});

const noAutorizado = () => jsonResponse({ ok: false, error: 'No autorizado' }, { status: 403 });

// GET /api/rrhh-solicitudes — todas las solicitudes de retiro anticipado. Solo dev y la cuenta rrhh.
// `tablaLista: false` avisa que falta correr docs/rrhh-solicitudes-retiro.sql en Supabase.
export const GET: APIRoute = async (context) => {
  if (!puedeAdministrarRrhh(context.locals.usuario)) return noAutorizado();
  return handleApiRoute(async () => {
    try {
      return { tablaLista: true, errorTabla: null as string | null, solicitudes: await listSolicitudes() };
    } catch (err) {
      return { tablaLista: false, errorTabla: err instanceof Error ? err.message : String(err), solicitudes: [] };
    }
  });
};

// PUT /api/rrhh-solicitudes — aprueba o rechaza una solicitud pendiente.
export const PUT: APIRoute = async (context) => {
  const usuario = context.locals.usuario;
  if (!puedeAdministrarRrhh(usuario)) return noAutorizado();
  return handleApiRoute(async () => {
    let body: unknown;
    try {
      body = await context.request.json();
    } catch {
      throw new ApiValidationError('JSON inválido');
    }
    const parsed = putSchema.safeParse(body);
    if (!parsed.success) throw new ApiValidationError(parsed.error.issues.map((i) => i.message).join('; '));
    const { id, decision, comentario } = parsed.data;
    const resuelta = await resolverSolicitud(id, decision, usuario!.username, comentario || null).catch((err: unknown) => {
      console.error('[rrhh-solicitudes]', err);
      throw new ApiValidationError('No se pudo guardar la decisión. Probá de nuevo.');
    });
    if (!resuelta) throw new ApiValidationError('Esa solicitud ya fue resuelta');
    return { id, estado: decision };
  });
};
