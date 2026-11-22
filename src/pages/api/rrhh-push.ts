import type { APIRoute } from 'astro';
import { z } from 'zod';
import { borrarSuscripcion, guardarSuscripcion } from '@/lib/supabase/rrhh-push';
import { claveVapidPublica, notificarDispositivo } from '@/lib/push-rrhh';
import { puedeAdministrarRrhh } from '@/lib/rrhh-permisos';
import { handleApiRoute, jsonResponse, ApiValidationError } from '@/lib/api-helpers';

export const prerender = false;

const noAutorizado = () => jsonResponse({ ok: false, error: 'No autorizado' }, { status: 403 });

const postSchema = z.object({
  endpoint: z.string().url().max(1000),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
});

// GET /api/rrhh-push — clave pública VAPID para suscribir el dispositivo. Solo dev y rrhh.
export const GET: APIRoute = async (context) => {
  if (!puedeAdministrarRrhh(context.locals.usuario)) return noAutorizado();
  return handleApiRoute(async () => {
    const clave = claveVapidPublica();
    if (!clave) throw new ApiValidationError('Las notificaciones no están configuradas en el servidor (faltan las claves VAPID).');
    return { clave };
  });
};

// POST /api/rrhh-push — guarda la suscripción de este dispositivo y le manda una notificación de bienvenida.
export const POST: APIRoute = async (context) => {
  const usuario = context.locals.usuario;
  if (!puedeAdministrarRrhh(usuario)) return noAutorizado();
  return handleApiRoute(async () => {
    let body: unknown;
    try {
      body = await context.request.json();
    } catch {
      throw new ApiValidationError('JSON inválido');
    }
    const parsed = postSchema.safeParse(body);
    if (!parsed.success) throw new ApiValidationError('Suscripción inválida');
    const s = { endpoint: parsed.data.endpoint, p256dh: parsed.data.keys.p256dh, auth: parsed.data.keys.auth };
    try {
      await guardarSuscripcion(s, usuario!.username);
    } catch (err) {
      console.error('[rrhh-push]', err);
      throw new ApiValidationError('No se pudo guardar. ¿Se corrió el SQL de rrhh_push_suscripciones en Supabase?');
    }
    await notificarDispositivo(s, { titulo: 'Notificaciones activadas', cuerpo: 'Te vamos a avisar cuando llegue una solicitud de retiro.', tag: 'rrhh-bienvenida' });
    return { ok: true };
  });
};

// DELETE /api/rrhh-push — este dispositivo deja de recibir avisos.
export const DELETE: APIRoute = async (context) => {
  if (!puedeAdministrarRrhh(context.locals.usuario)) return noAutorizado();
  return handleApiRoute(async () => {
    const parsed = z.object({ endpoint: z.string().url().max(1000) }).safeParse(await context.request.json().catch(() => null));
    if (!parsed.success) throw new ApiValidationError('Datos inválidos');
    await borrarSuscripcion(parsed.data.endpoint);
    return { ok: true };
  });
};
