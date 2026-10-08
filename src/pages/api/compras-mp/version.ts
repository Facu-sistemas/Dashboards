import type { APIRoute } from 'astro';
import { jsonResponse } from '../../../lib/api-helpers';
import { errorJson, leerJson, negarSiNoEdita } from '../../../lib/compras-mp/api';
import { AprobacionError, aprobarVersion } from '../../../lib/compras-mp/versiones';

export const prerender = false;

// POST /api/compras-mp/version — { nombre?, corridaId? } congela el presupuesto y el desembolso proyectado de la corrida
// (por defecto, la última). Las versiones aprobadas son inmutables. Solo Compras.
export const POST: APIRoute = async ({ locals, request }) => {
  const no = negarSiNoEdita(locals);
  if (no) return no;
  const body = (await leerJson<{ nombre?: string; corridaId?: string }>(request)) ?? {};
  try {
    const v = await aprobarVersion({ nombre: body.nombre, corridaId: body.corridaId, usuario: locals.usuario!.username });
    return jsonResponse({ ok: true, data: v });
  } catch (e) {
    if (e instanceof AprobacionError) return errorJson(e.message);
    console.error('[compras-mp] error aprobando la versión', e);
    return errorJson(e instanceof Error ? e.message : 'No se pudo aprobar la versión', 500);
  }
};
