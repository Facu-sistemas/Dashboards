import type { APIRoute } from 'astro';
import { jsonResponse } from '../../../lib/api-helpers';
import { errorJson, leerJson, negarSiNoEdita } from '../../../lib/compras-mp/api';
import { CierreError, registrarCierre } from '../../../lib/compras-mp/cierres';

export const prerender = false;

// POST /api/compras-mp/cierre — { corridaId? } registra el cierre del último mes cerrado. Si ya había uno, queda como revisión nueva.
export const POST: APIRoute = async ({ locals, request }) => {
  const no = negarSiNoEdita(locals);
  if (no) return no;
  const body = (await leerJson<{ corridaId?: string }>(request)) ?? {};
  try {
    return jsonResponse({ ok: true, data: await registrarCierre({ corridaId: body.corridaId, usuario: locals.usuario!.username }) });
  } catch (e) {
    if (e instanceof CierreError) return errorJson(e.message);
    console.error('[compras-mp] error registrando el cierre', e);
    return errorJson(e instanceof Error ? e.message : 'No se pudo registrar el cierre', 500);
  }
};
