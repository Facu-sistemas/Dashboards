import type { APIRoute } from 'astro';
import { getRrhhHistorial } from '@/lib/odoo/rrhh-historial';
import { handleApiRoute, ApiValidationError } from '@/lib/api-helpers';

export const prerender = false;

// GET /api/rrhh-historial?desde=&hasta=[&empleadoId=] — solo lectura. Sin empleadoId: resumen de todos (máx. 93 días);
// con empleadoId: además el día por día de ese empleado (máx. 400 días).
export const GET: APIRoute = async ({ url }) => {
  return handleApiRoute(() => {
    const desde = url.searchParams.get('desde');
    const hasta = url.searchParams.get('hasta');
    if (!desde || !hasta) throw new ApiValidationError('Faltan los parámetros desde y hasta');
    const raw = url.searchParams.get('empleadoId');
    const empleadoId = raw ? Number(raw) : undefined;
    if (raw && (!Number.isInteger(empleadoId) || empleadoId! <= 0)) throw new ApiValidationError('empleadoId inválido');
    return getRrhhHistorial(desde, hasta, empleadoId);
  });
};
