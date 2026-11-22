import type { APIRoute } from 'astro';
import { EMPLEADO_COOKIE, leerToken } from '@/lib/empleado-sesion';
import { getPortalEmpleado } from '@/lib/odoo/empleado-portal';
import { handleApiRoute, jsonResponse } from '@/lib/api-helpers';

export const prerender = false;

// GET /api/empleados/portal — datos del propio empleado (el id sale de la cookie firmada, nunca de la URL).
export const GET: APIRoute = async (context) => {
  const sesion = leerToken(context.cookies.get(EMPLEADO_COOKIE)?.value);
  if (!sesion) return jsonResponse({ ok: false, error: 'Sesión vencida' }, { status: 401 });
  return handleApiRoute(() => getPortalEmpleado(sesion.empleadoId));
};
