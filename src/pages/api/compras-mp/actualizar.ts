import type { APIRoute } from 'astro';
import { jsonResponse } from '../../../lib/api-helpers';
import { calcularCorrida, corridaLeidaPendiente, CorridaEnCursoError, ejecutarCorrida, leerOdoo } from '../../../lib/compras-mp/corrida';
import { leerJson } from '../../../lib/compras-mp/api';
import { puedeEditarCompras } from '../../../lib/compras-mp/permisos';

export const prerender = false;

// POST /api/compras-mp/actualizar — botón "Actualizar ahora": lee Odoo (solo lectura), calcula y guarda una corrida nueva.
// Solo el perfil de Compras (o dev). Cuerpo opcional { paso: 'leer' | 'calcular', corridaId? }: el botón hace los dos pasos seguidos
// (cada uno tarda menos de ~40 s, lejos del límite de Vercel); sin paso, hace todo junto (~50 s).
export const POST: APIRoute = async (context) => {
  const usuario = context.locals.usuario;
  if (!puedeEditarCompras(usuario)) return jsonResponse({ ok: false, error: 'No autorizado' }, { status: 403 });
  const body = (await leerJson<{ paso?: string; corridaId?: string }>(context.request)) ?? {};
  try {
    if (body.paso === 'leer') return jsonResponse({ ok: true, data: await leerOdoo({ origen: 'manual', disparadaPor: usuario!.username }) });
    if (body.paso === 'calcular') {
      const id = body.corridaId ?? (await corridaLeidaPendiente());
      if (!id) return jsonResponse({ ok: false, error: 'No hay una lectura de Odoo esperando el cálculo' }, { status: 409 });
      return jsonResponse({ ok: true, data: await calcularCorrida(id) });
    }
    const resumen = await ejecutarCorrida({ origen: 'manual', disparadaPor: usuario!.username });
    return jsonResponse({ ok: true, data: resumen });
  } catch (e) {
    if (e instanceof CorridaEnCursoError) return jsonResponse({ ok: false, error: e.message }, { status: 409 });
    console.error('[compras-mp] error al actualizar', e);
    return jsonResponse({ ok: false, error: e instanceof Error ? e.message : 'Error al actualizar' }, { status: 500 });
  }
};
