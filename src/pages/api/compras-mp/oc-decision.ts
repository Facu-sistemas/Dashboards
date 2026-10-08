import type { APIRoute } from 'astro';
import { jsonResponse } from '../../../lib/api-helpers';
import { errorJson, leerJson, negarSiNoEdita } from '../../../lib/compras-mp/api';
import { DecisionError, registrarDecisionOc } from '../../../lib/compras-mp/decisiones-oc';

export const prerender = false;

// POST /api/compras-mp/oc-decision — { ocId, productId, decision, nuevaFecha?, comentario? }. Queda con quién y cuándo. Solo Compras.
export const POST: APIRoute = async ({ locals, request }) => {
  const no = negarSiNoEdita(locals);
  if (no) return no;
  const b = await leerJson<{ ocId?: number; productId?: number; decision?: string; nuevaFecha?: string | null; comentario?: string | null }>(request);
  if (!b) return errorJson('Pedido inválido');
  try {
    const d = await registrarDecisionOc({ ocId: Number(b.ocId), productId: Number(b.productId), decision: String(b.decision ?? ''), nuevaFecha: b.nuevaFecha, comentario: b.comentario, usuario: locals.usuario!.username });
    return jsonResponse({ ok: true, data: d });
  } catch (e) {
    if (e instanceof DecisionError) return errorJson(e.message);
    console.error('[compras-mp] error guardando la decisión', e);
    return errorJson(e instanceof Error ? e.message : 'No se pudo guardar la decisión', 500);
  }
};
