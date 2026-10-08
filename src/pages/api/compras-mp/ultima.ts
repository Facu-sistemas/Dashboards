import type { APIRoute } from 'astro';
import { jsonResponse } from '../../../lib/api-helpers';
import { ultimaCorrida } from '../../../lib/compras-mp/corrida';
import { puedeEditarCompras, puedeVerCompras } from '../../../lib/compras-mp/permisos';

export const prerender = false;

// GET /api/compras-mp/ultima — resumen y controles de la última corrida terminada bien, más el estado de la última intentada.
export const GET: APIRoute = async ({ locals }) => {
  if (!puedeVerCompras(locals.usuario)) return jsonResponse({ ok: false, error: 'No autorizado' }, { status: 403 });
  try {
    const [ok, ultima] = await Promise.all([ultimaCorrida(true), ultimaCorrida(false)]);
    return jsonResponse({
      ok: true,
      data: {
        corrida: ok,
        // Si la última intento falló o está en curso, se informa aparte para que se vea en la pantalla.
        ultimoIntento: ultima && ultima.id !== ok?.id ? { estado: ultima.estado, error: ultima.error, creadaEn: ultima.creadaEn } : null,
        puedeActualizar: puedeEditarCompras(locals.usuario),
      },
    });
  } catch (e) {
    console.error('[compras-mp] error leyendo la última corrida', e);
    return jsonResponse({ ok: false, error: 'No se pudo leer la última corrida' }, { status: 500 });
  }
};
