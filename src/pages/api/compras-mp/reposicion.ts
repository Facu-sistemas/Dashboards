import type { APIRoute } from 'astro';
import { jsonResponse } from '../../../lib/api-helpers';
import { cargarConfig } from '../../../lib/compras-mp/config';
import { leerFilas, resolverCorrida } from '../../../lib/compras-mp/lectura';
import { aCsvOdoo, construirReposicion } from '../../../lib/compras-mp/reposicion';
import { puedeVerCompras } from '../../../lib/compras-mp/permisos';

export const prerender = false;

// GET /api/compras-mp/reposicion?formato=csv — archivo para importar en Odoo (mínimos y máximos). La web nunca escribe en Odoo:
// el archivo lo importa una persona, primero en staging. Sin ?formato=csv devuelve el detalle en JSON.
export const GET: APIRoute = async ({ locals, url }) => {
  if (!puedeVerCompras(locals.usuario)) return jsonResponse({ ok: false, error: 'No autorizado' }, { status: 403 });
  try {
    const corrida = await resolverCorrida(url.searchParams.get('corrida'));
    if (!corrida || !corrida.resumen) return jsonResponse({ ok: true, data: { vacio: true } });
    const [filas, { extras }] = await Promise.all([leerFilas(corrida.id), cargarConfig()]);
    const r = await construirReposicion(filas, extras.ubicacionReposicion);
    if (url.searchParams.get('formato') === 'csv') {
      return new Response(aCsvOdoo(r), {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="reglas-reabastecimiento-${corrida.fechaDatos}.csv"`,
          'Cache-Control': 'no-store',
        },
      });
    }
    return jsonResponse({ ok: true, data: { corrida: { id: corrida.id, fechaDatos: corrida.fechaDatos }, ...r } });
  } catch (e) {
    console.error('[compras-mp] error armando las reglas de reabastecimiento', e);
    return jsonResponse({ ok: false, error: 'No se pudieron armar las reglas de reabastecimiento' }, { status: 500 });
  }
};
