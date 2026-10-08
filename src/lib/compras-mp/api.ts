// Ayudas comunes de las rutas /api/compras-mp que escriben: control de permisos y lectura del cuerpo.
import { jsonResponse } from '../api-helpers';
import { puedeEditarCompras } from './permisos';
import { recalcularUltima } from './corrida';

type Locals = { usuario?: { username: string; rol: string; areasPermitidas: string[] } };

/** Devuelve la respuesta 403 si el usuario no puede editar Compras; si puede, null. */
export function negarSiNoEdita(locals: Locals): Response | null {
  return puedeEditarCompras(locals.usuario) ? null : jsonResponse({ ok: false, error: 'No autorizado' }, { status: 403 });
}

export async function leerJson<T = Record<string, unknown>>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

export const errorJson = (mensaje: string, status = 400): Response => jsonResponse({ ok: false, error: mensaje }, { status });

export { recalcularUltima };
