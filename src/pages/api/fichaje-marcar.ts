import type { APIRoute } from 'astro';
import { z } from 'zod';
import { marcarAsistencia } from '@/lib/odoo/asistencia-write';
import { registrarMarca } from '@/lib/supabase/fichaje-marcas';
import { handleApiRoute, jsonResponse, ApiValidationError } from '@/lib/api-helpers';
import { OdooError } from '@/lib/odoo/types';

export const prerender = false;

/** Una fichada diferida (guardada sin internet) no puede ser del futuro ni demasiado vieja. */
const MAX_ANTIGUEDAD_MS = 7 * 24 * 60 * 60 * 1000;
const TOLERANCIA_FUTURO_MS = 2 * 60 * 1000;

const bodySchema = z.object({ empleadoId: z.number().int().positive(), hora: z.string().datetime().optional() });

// POST /api/fichaje-marcar — registra entrada o salida (la decide Odoo) del
// empleado reconocido. Única ruta del proyecto que escribe en Odoo.
export const POST: APIRoute = async (context) => {
  if (!context.locals.usuario?.areasPermitidas.includes('fichaje')) {
    return jsonResponse({ ok: false, error: 'No autorizado' }, { status: 403 });
  }
  return handleApiRoute(async () => {
    let body: unknown;
    try {
      body = await context.request.json();
    } catch {
      throw new ApiValidationError('JSON inválido');
    }
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) throw new ApiValidationError(parsed.error.issues.map((i) => i.message).join('; '));
    try {
      const { hora } = parsed.data;
      if (hora) {
        const dif = Date.now() - Date.parse(hora);
        if (dif < -TOLERANCIA_FUTURO_MS) throw new ApiValidationError('La hora de la fichada es futura');
        if (dif > MAX_ANTIGUEDAD_MS) throw new ApiValidationError('La fichada guardada es demasiado antigua (más de 7 días)');
      }
      const resultado = await marcarAsistencia(parsed.data.empleadoId, hora);
      // El registro por kiosco es secundario: si falla (p. ej. la tabla aún no existe) el fichaje ya quedó en Odoo y no se tira abajo.
      await registrarMarca({
        empleadoId: parsed.data.empleadoId,
        empleadoNombre: resultado.empleado,
        accion: resultado.accion,
        kiosco: context.locals.usuario?.username ?? 'desconocido',
        marcadoEn: hora ? resultado.hora ?? undefined : undefined,
      }).catch((err) => console.error('[fichaje-marcar] no se pudo registrar la marca por kiosco', err));
      return resultado;
    } catch (err) {
      // Acá se muestra el motivo real de Odoo (ruta solo para usuarios con acceso a Test): el mensaje genérico de
      // handleApiRoute no deja diagnosticar por qué Odoo rechazó el fichaje.
      if (err instanceof OdooError) {
        console.error('[fichaje-marcar]', err.message, err.cause ?? '');
        throw new ApiValidationError(err.message);
      }
      throw err;
    }
  });
};
