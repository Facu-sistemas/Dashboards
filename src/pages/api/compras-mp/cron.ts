import type { APIRoute } from 'astro';
import { timingSafeEqual } from 'node:crypto';
import { jsonResponse } from '../../../lib/api-helpers';
import { calcularCorrida, corridaLeidaPendiente, CorridaEnCursoError, ejecutarCorrida, leerOdoo } from '../../../lib/compras-mp/corrida';

export const prerender = false;

// GET/POST /api/compras-mp/cron — corrida automática diaria. No lleva sesión (la llama un programador externo: Vercel Cron o
// pg_cron de Supabase), así que se protege con un secreto compartido en CRON_SECRET. Sin ese secreto configurado, queda cerrada.
function autorizado(request: Request): boolean {
  const secreto = import.meta.env.CRON_SECRET;
  if (!secreto) return false;
  const recibido = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? request.headers.get('x-cron-secret') ?? '';
  const a = Buffer.from(recibido);
  const b = Buffer.from(secreto);
  return a.length === b.length && timingSafeEqual(a, b);
}

// ?paso=leer y ?paso=calcular parten la corrida en dos llamadas (dos jobs del programador, separados unos minutos) por si una sola
// llamada se acerca al límite de tiempo de la plataforma. Sin ?paso se hace todo junto.
const manejar: APIRoute = async ({ request, url }) => {
  if (!autorizado(request)) return jsonResponse({ ok: false, error: 'No autorizado' }, { status: 401 });
  const paso = url.searchParams.get('paso');
  try {
    if (paso === 'leer') {
      const r = await leerOdoo({ origen: 'cron' });
      return jsonResponse({ ok: true, data: { corridaId: r.corridaId, paso: 'leer' } });
    }
    if (paso === 'calcular') {
      const id = await corridaLeidaPendiente();
      if (!id) return jsonResponse({ ok: true, data: { omitida: true, motivo: 'No hay una lectura de Odoo esperando el cálculo' } });
      const r = await calcularCorrida(id);
      return jsonResponse({ ok: true, data: { corridaId: r.corridaId, totalCompra: r.totalCompra, estadoControles: r.estadoControles, duracionMs: r.duracionMs } });
    }
    const resumen = await ejecutarCorrida({ origen: 'cron' });
    return jsonResponse({ ok: true, data: { corridaId: resumen.corridaId, totalCompra: resumen.totalCompra, estadoControles: resumen.estadoControles, duracionMs: resumen.duracionMs } });
  } catch (e) {
    if (e instanceof CorridaEnCursoError) return jsonResponse({ ok: true, data: { omitida: true, motivo: e.message } });
    console.error('[compras-mp] error en la corrida automática', e);
    return jsonResponse({ ok: false, error: e instanceof Error ? e.message : 'Error en la corrida' }, { status: 500 });
  }
};

export const GET = manejar;
export const POST = manejar;
