import type { APIRoute } from 'astro';
import { jsonResponse } from '../../../lib/api-helpers';
import { errorJson, leerJson, negarSiNoEdita, recalcularUltima } from '../../../lib/compras-mp/api';
import { aplicarCambio, EdicionError, leerConfigEditable, type CambioConfig } from '../../../lib/compras-mp/edicion';

export const prerender = false;

// GET /api/compras-mp/config?anio=2026 — parámetros, reglas, excepciones, plan y auditoría (pantalla Parámetros). Solo Compras.
export const GET: APIRoute = async ({ locals, url }) => {
  const no = negarSiNoEdita(locals);
  if (no) return no;
  const anio = Number(url.searchParams.get('anio')) || new Date().getFullYear();
  try {
    return jsonResponse({ ok: true, data: await leerConfigEditable(anio) });
  } catch (e) {
    console.error('[compras-mp] error leyendo la configuración', e);
    return errorJson('No se pudo leer la configuración', 500);
  }
};

// POST /api/compras-mp/config — { cambios: CambioConfig[], recalcular?: boolean }
// Aplica los cambios (validados y auditados) y, salvo que se pida lo contrario, recalcula con las fotos de la última corrida.
export const POST: APIRoute = async ({ locals, request }) => {
  const no = negarSiNoEdita(locals);
  if (no) return no;
  const body = await leerJson<{ cambios?: CambioConfig[]; recalcular?: boolean }>(request);
  if (!body || !Array.isArray(body.cambios) || body.cambios.length === 0) return errorJson('No hay cambios para aplicar');
  if (body.cambios.length > 200) return errorJson('Demasiados cambios en una sola llamada');
  const usuario = locals.usuario!.username;
  try {
    for (const c of body.cambios) await aplicarCambio(c, usuario);
    const resumen = body.recalcular === false ? null : await recalcularUltima({ disparadaPor: usuario });
    return jsonResponse({ ok: true, data: { aplicados: body.cambios.length, recalculo: resumen } });
  } catch (e) {
    if (e instanceof EdicionError) return errorJson(e.message);
    console.error('[compras-mp] error aplicando cambios', e);
    return errorJson(e instanceof Error ? e.message : 'No se pudieron aplicar los cambios', 500);
  }
};
