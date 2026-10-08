import type { APIRoute } from 'astro';
import { jsonResponse } from '../../../lib/api-helpers';
import { puedeEditarCompras, puedeVerCompras } from '../../../lib/compras-mp/permisos';
import { leerControlOc, leerDesembolsos, leerFilas, resolverCorrida } from '../../../lib/compras-mp/lectura';
import { construirSeguimiento } from '../../../lib/compras-mp/seguimiento-datos';
import { ultimasDecisiones } from '../../../lib/compras-mp/decisiones-oc';
import { listarCierres } from '../../../lib/compras-mp/cierres';
import { listarVersiones, versionVigente } from '../../../lib/compras-mp/versiones';
import { cargarPlan } from '../../../lib/compras-mp/config';
import { getEmpresas } from '../../../lib/odoo/rotacion-gasto';
import {
  vistaEvolucion, vistaInventario, vistaOc, vistaPresupuesto, vistaRendicion, vistaSeguimiento, vistaSku, type VistaSeguimiento,
} from '../../../lib/compras-mp/vistas';

export const prerender = false;

// GET /api/compras-mp/datos?vista=rendicion|presupuesto|inventario|sku|oc|seguimiento|evolucion[&corrida=<id>][&clave=<insumo>][&empresas=1,2]
// Lee lo que dejó una corrida (por defecto, la última terminada bien). No calcula nada ni consulta Odoo, salvo el gasto real de
// referencia del Seguimiento cuando se eligen empresas.
export const GET: APIRoute = async ({ locals, url }) => {
  if (!puedeVerCompras(locals.usuario)) return jsonResponse({ ok: false, error: 'No autorizado' }, { status: 403 });
  const vista = url.searchParams.get('vista') ?? 'rendicion';
  try {
    const corrida = await resolverCorrida(url.searchParams.get('corrida'));
    if (!corrida || !corrida.resumen) return jsonResponse({ ok: true, data: { vacio: true } });

    switch (vista) {
      case 'rendicion': {
        const [filas, des] = await Promise.all([leerFilas(corrida.id), leerDesembolsos(corrida.id)]);
        const seg = await construirSeguimiento(corrida, filas);
        return jsonResponse({ ok: true, data: vistaRendicion(corrida, filas, des, seg) });
      }
      case 'presupuesto':
        return jsonResponse({ ok: true, data: vistaPresupuesto(corrida, await leerFilas(corrida.id), await versionVigente()) });
      case 'inventario':
        return jsonResponse({ ok: true, data: vistaInventario(corrida, await leerFilas(corrida.id)) });
      case 'sku':
        return jsonResponse({ ok: true, data: vistaSku(corrida, await leerFilas(corrida.id), url.searchParams.get('clave')) });
      case 'oc':
        return jsonResponse({ ok: true, data: vistaOc(corrida, await leerControlOc(corrida.id), await ultimasDecisiones()) });
      case 'seguimiento': {
        const elegidas = (url.searchParams.get('empresas') ?? '').split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0);
        const [filas, versiones, empresas] = await Promise.all([leerFilas(corrida.id), listarVersiones(), getEmpresas()]);
        const seg = await construirSeguimiento(corrida, filas, elegidas.length ? elegidas : undefined);
        return jsonResponse({ ok: true, data: vistaSeguimiento(corrida, seg, versiones, await produccionDelPlan(seg), empresas, elegidas) });
      }
      case 'evolucion':
        return jsonResponse({ ok: true, data: vistaEvolucion(corrida, await listarCierres(), puedeEditarCompras(locals.usuario)) });
      default:
        return jsonResponse({ ok: false, error: 'Vista desconocida' }, { status: 400 });
    }
  } catch (e) {
    console.error('[compras-mp] error leyendo datos', e);
    return jsonResponse({ ok: false, error: 'No se pudieron leer los datos de Compras MP' }, { status: 500 });
  }
};

/** Plan contra real del último mes cerrado (producción y ventas), con lo que haya cargado en el plan. */
async function produccionDelPlan(seg: Awaited<ReturnType<typeof construirSeguimiento>>): Promise<VistaSeguimiento['produccion']> {
  const mes = seg?.resultado.precision.mes ?? seg?.corte ?? null;
  if (!mes) return [];
  const [anio, m] = mes.split('-').map(Number) as [number, number];
  const plan = await cargarPlan(anio);
  const v = (a: (number | null)[]) => a[m - 1] ?? null;
  const filas: VistaSeguimiento['produccion'] = [];
  const par = (concepto: string, p: number | null, r: number | null) => { if (p !== null && r !== null) filas.push({ mes, concepto, plan: p, real: r }); };
  par('Producción de colchones', v(plan.prodConsColchones), v(plan.prodRealColchones));
  par('Producción de sillones equivalentes', v(plan.prodConsSillones), v(plan.prodRealSillones));
  return filas;
}
