import type { APIRoute } from 'astro';
import { z } from 'zod';
import { aprobarPaso, eliminarSolicitud, listSolicitudes, resolverSolicitud } from '@/lib/supabase/rrhh-solicitudes-retiro';
import { puedeAdministrarRrhh, puedeAprobarComoLider, puedeVerSolicitudes } from '@/lib/rrhh-permisos';
import { handleApiRoute, jsonResponse, ApiValidationError } from '@/lib/api-helpers';

export const prerender = false;

const putSchema = z.object({
  id: z.string().uuid(),
  decision: z.enum(['aprobada', 'rechazada']),
  comentario: z.string().trim().max(500).optional(),
  /** Con qué check se decide. Solo hace falta indicarlo cuando la cuenta puede dar los dos (el dev). */
  paso: z.enum(['rrhh', 'lider']).optional(),
});

const noAutorizado = () => jsonResponse({ ok: false, error: 'No autorizado' }, { status: 403 });

// GET /api/rrhh-solicitudes — todas las solicitudes de retiro anticipado. Las ven RRHH, el dev y los líderes.
// `yo` dice con qué check puede decidir quien mira.
// `tablaLista: false` avisa que falta correr docs/rrhh-solicitudes-retiro.sql en Supabase.
export const GET: APIRoute = async (context) => {
  const usuario = context.locals.usuario;
  if (!puedeVerSolicitudes(usuario)) return noAutorizado();
  const yo = { usuario: usuario!.username, puedeRrhh: puedeAdministrarRrhh(usuario), puedeLider: puedeAprobarComoLider(usuario) };
  return handleApiRoute(async () => {
    try {
      return { tablaLista: true, errorTabla: null as string | null, solicitudes: await listSolicitudes(), yo };
    } catch (err) {
      return { tablaLista: false, errorTabla: err instanceof Error ? err.message : String(err), solicitudes: [], yo };
    }
  });
};

// PUT /api/rrhh-solicitudes — da uno de los dos checks de aprobación o rechaza. Aprobar necesita el check de RRHH y el de un líder
// (o dev), de dos personas distintas; rechazar alcanza con una.
export const PUT: APIRoute = async (context) => {
  const usuario = context.locals.usuario;
  const puedeRrhh = puedeAdministrarRrhh(usuario);
  const puedeLider = puedeAprobarComoLider(usuario);
  if (!puedeRrhh && !puedeLider) return noAutorizado();
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
    const paso = parsed.data.paso ?? (puedeRrhh && !puedeLider ? 'rrhh' : puedeLider && !puedeRrhh ? 'lider' : undefined);
    if (!paso) throw new ApiValidationError('Indicá si decidís como RRHH o como líder.');
    if ((paso === 'rrhh' && !puedeRrhh) || (paso === 'lider' && !puedeLider)) return noAutorizado();

    if (decision === 'rechazada') {
      const resuelta = await resolverSolicitud(id, decision, usuario!.username, comentario || null, paso).catch((err: unknown) => {
        console.error('[rrhh-solicitudes]', err);
        throw new ApiValidationError('No se pudo guardar la decisión. Probá de nuevo.');
      });
      if (!resuelta) throw new ApiValidationError('Esa solicitud ya fue resuelta');
      return { id, estado: 'rechazada' as const };
    }

    const resultado = await aprobarPaso(id, paso, usuario!.username, comentario || null).catch((err: unknown) => {
      console.error('[rrhh-solicitudes]', err);
      throw new ApiValidationError('No se pudo guardar la decisión. Probá de nuevo.');
    });
    if (resultado === 'ya-resuelta') throw new ApiValidationError('Esa solicitud ya fue resuelta');
    if (resultado === 'paso-ya-dado') throw new ApiValidationError(paso === 'rrhh' ? 'El check de RRHH ya está dado.' : 'El check del líder ya está dado.');
    if (resultado === 'misma-persona') throw new ApiValidationError('Tiene que aprobar otra persona: no se pueden dar los dos checks con la misma cuenta.');
    return { id, estado: resultado === 'aprobada-final' ? ('aprobada' as const) : ('pendiente' as const) };
  });
};

// DELETE /api/rrhh-solicitudes — borra una solicitud (en cualquier estado). Solo dev y la cuenta rrhh.
export const DELETE: APIRoute = async (context) => {
  const usuario = context.locals.usuario;
  if (!puedeAdministrarRrhh(usuario)) return noAutorizado();
  return handleApiRoute(async () => {
    let body: unknown;
    try {
      body = await context.request.json();
    } catch {
      throw new ApiValidationError('JSON inválido');
    }
    const parsed = z.object({ id: z.string().uuid() }).safeParse(body);
    if (!parsed.success) throw new ApiValidationError('Datos inválidos');
    const borrada = await eliminarSolicitud(parsed.data.id).catch((err: unknown) => {
      console.error('[rrhh-solicitudes]', err);
      throw new ApiValidationError('No se pudo eliminar. Probá de nuevo.');
    });
    if (!borrada) throw new ApiValidationError('Esa solicitud ya no existe');
    console.info(`[rrhh-solicitudes] ${usuario!.username} eliminó la solicitud ${parsed.data.id}`);
    return { id: parsed.data.id };
  });
};
