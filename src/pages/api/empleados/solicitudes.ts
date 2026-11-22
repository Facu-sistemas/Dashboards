import type { APIRoute } from 'astro';
import { z } from 'zod';
import { EMPLEADO_COOKIE, leerToken } from '@/lib/empleado-sesion';
import { crearSolicitud, listSolicitudesDeEmpleado, tienePendienteEseDia } from '@/lib/supabase/rrhh-solicitudes-retiro';
import { getArgentinaTodayIso } from '@/lib/odoo/oee';
import { addDaysIso } from '@/lib/date';
import { handleApiRoute, jsonResponse, ApiValidationError } from '@/lib/api-helpers';

export const prerender = false;

const MAX_DIAS_ADELANTE = 30;

const bodySchema = z.object({
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida'),
  horaRetiro: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Hora inválida'),
  motivo: z.string().trim().min(5, 'Contanos el motivo (mínimo 5 letras)').max(500, 'El motivo es muy largo (máximo 500)'),
});

const sinSesion = () => jsonResponse({ ok: false, error: 'Sesión vencida' }, { status: 401 });

// GET /api/empleados/solicitudes — las solicitudes del propio empleado (el id sale de la cookie firmada).
export const GET: APIRoute = async (context) => {
  const sesion = leerToken(context.cookies.get(EMPLEADO_COOKIE)?.value);
  if (!sesion) return sinSesion();
  return handleApiRoute(() => listSolicitudesDeEmpleado(sesion.empleadoId));
};

// POST /api/empleados/solicitudes — crea una solicitud de retiro anticipado (queda pendiente hasta que RRHH la resuelva).
export const POST: APIRoute = async (context) => {
  const sesion = leerToken(context.cookies.get(EMPLEADO_COOKIE)?.value);
  if (!sesion) return sinSesion();
  return handleApiRoute(async () => {
    let body: unknown;
    try {
      body = await context.request.json();
    } catch {
      throw new ApiValidationError('JSON inválido');
    }
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) throw new ApiValidationError(parsed.error.issues.map((i) => i.message).join('; '));
    const { fecha, horaRetiro, motivo } = parsed.data;

    const hoy = getArgentinaTodayIso();
    if (fecha < hoy) throw new ApiValidationError('La fecha no puede ser anterior a hoy');
    if (fecha > addDaysIso(hoy, MAX_DIAS_ADELANTE)) throw new ApiValidationError(`Solo se puede pedir con hasta ${MAX_DIAS_ADELANTE} días de anticipación`);

    try {
      if (await tienePendienteEseDia(sesion.empleadoId, fecha)) throw new ApiValidationError('Ya tenés una solicitud pendiente para ese día');
      await crearSolicitud({ empleadoId: sesion.empleadoId, empleadoNombre: sesion.nombre, fecha, horaRetiro, motivo });
    } catch (err) {
      if (err instanceof ApiValidationError) throw err;
      console.error('[empleados/solicitudes]', err);
      throw new ApiValidationError('No se pudo guardar la solicitud. Avisale a RRHH.');
    }
    return { ok: true };
  });
};
