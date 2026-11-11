import type { APIRoute } from 'astro';
import { getEmpleadosActivos } from '@/lib/odoo/employees';
import { puedeRegistrarCaras } from '@/lib/rrhh-permisos';
import { handleApiRoute, jsonResponse } from '@/lib/api-helpers';

export const prerender = false;

export const GET: APIRoute = async (context) => {
  if (!context.locals.usuario?.areasPermitidas.includes('fichaje') || !puedeRegistrarCaras(context.locals.usuario)) {
    return jsonResponse({ ok: false, error: 'No autorizado' }, { status: 403 });
  }
  return handleApiRoute(() => getEmpleadosActivos());
};
