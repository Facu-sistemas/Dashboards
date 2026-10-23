import type { APIRoute } from 'astro';
import { getPermisosUsuarios } from '@/lib/odoo/permisos-usuarios';
import { handleApiRoute, jsonResponse } from '@/lib/api-helpers';

export const prerender = false;

// Solo dev: expone quién tiene qué permiso en Odoo.
export const GET: APIRoute = async (context) => {
  if (context.locals.usuario?.rol !== 'dev') {
    return jsonResponse({ ok: false, error: 'No autorizado' }, { status: 403 });
  }
  return handleApiRoute(() => getPermisosUsuarios());
};
