// Prueba de humo de las pantallas de Compras MP: renderiza cada una en el servidor con datos reales (de Supabase) o armados, y busca
// errores de ejecución y valores rotos ("NaN", "undefined", "Infinity"). No reemplaza mirarlas en el navegador, pero atrapa lo grueso.
//
// Uso: node --env-file=.env tests/compras-mp/ejecutar-con-odoo.mjs tests/compras-mp/ui-humo.tsx
import { renderToString } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import Rendicion from '../../src/components/compras/mp/Rendicion';
import Presupuesto from '../../src/components/compras/mp/Presupuesto';
import Inventario from '../../src/components/compras/mp/Inventario';
import FichaSku from '../../src/components/compras/mp/FichaSku';
import OcVencidas from '../../src/components/compras/mp/OcVencidas';
import Reposicion from '../../src/components/compras/mp/Reposicion';
import Seguimiento from '../../src/components/compras/mp/Seguimiento';
import Evolucion from '../../src/components/compras/mp/Evolucion';
import Parametros from '../../src/components/compras/mp/Parametros';
import BandaControles from '../../src/components/compras/mp/BandaControles';
import { leerControlOc, leerDesembolsos, leerFilas, resolverCorrida } from '../../src/lib/compras-mp/lectura';
import { ultimasDecisiones } from '../../src/lib/compras-mp/decisiones-oc';
import { leerConfigEditable } from '../../src/lib/compras-mp/edicion';
import { construirReposicion } from '../../src/lib/compras-mp/reposicion';
import { cargarConfig } from '../../src/lib/compras-mp/config';
import { calcularSeguimiento } from '../../src/lib/compras-mp/seguimiento';
import type { FilaVersion, CabeceraVersion } from '../../src/lib/compras-mp/versiones';
import type { SeguimientoCompleto } from '../../src/lib/compras-mp/seguimiento-datos';
import { kpisCompras, kpisInventario } from '../../src/lib/compras-mp/indicadores';
import { getSupabaseAdminClient } from '../../src/lib/supabase/admin';
import { vistaEvolucion, vistaInventario, vistaOc, vistaPresupuesto, vistaRendicion, vistaSeguimiento, vistaSku } from '../../src/lib/compras-mp/vistas';
import type { Cierre } from '../../src/lib/compras-mp/cierres';

const corrida = (await resolverCorrida())!;
const [filas, des, controlOc, decisiones, cfg] = await Promise.all([leerFilas(corrida.id), leerDesembolsos(corrida.id), leerControlOc(corrida.id), ultimasDecisiones(), leerConfigEditable(2026)]);
const { extras } = await cargarConfig();
const repo = await construirReposicion(filas, extras.ubicacionReposicion);

// Una versión aprobada ARMADA (no se guarda en ningún lado) con meses ya cerrados, para ejercitar las columnas de cumplimiento.
const horizonte = ['2026-08', '2026-09', '2026-10', '2026-11'];
const filasVersion: FilaVersion[] = [];
for (const f of filas) {
  if (f.productId === null) continue;
  const r = f as unknown as Record<string, number>;
  horizonte.forEach((mes, i) => filasVersion.push({ productId: f.productId as number, sku: f.sku, cat: f.cat, mes, costo: f.costo, llegadaU: r[`r${i + 1}`] ?? 0, llegadaArs: r[`rd${i + 1}`] ?? 0, emitirU: 0, emitirArs: 0, consumoProyU: r[`p${i + 1}`] ?? 0 }));
}
const sup = getSupabaseAdminClient();
const rawDe = async (fuente: string) => (await sup.from('raw_compras').select('datos').eq('corrida_id', corrida.id).eq('fuente', fuente).maybeSingle()).data?.datos;
const stockRaw = (await rawDe('stock_fin_mes')) as { cortes: string[]; productos: { productId: number; cortes: { cantidad: number; valor: number }[] }[] };
const consumoRaw = (await rawDe('consumo')) as { meses: string[]; filas: { productId: number; vals: number[] }[] };
const stock = new Map(stockRaw.productos.map((p) => [p.productId, { cantidad: [...p.cortes.map((c) => c.cantidad), ...Array(13).fill(0)].slice(0, 13), valor: [...p.cortes.map((c) => c.valor), ...Array(13).fill(0)].slice(0, 13) }]));
const consumo = new Map(consumoRaw.filas.map((f) => [f.productId, new Map(consumoRaw.meses.map((m, i) => [m, f.vals[i] ?? 0]))]));
const catalogo = new Map(filas.filter((f) => f.productId !== null).map((f) => [f.productId as number, { sku: f.sku, cat: f.cat, abc: f.abc, costoActual: f.costo }]));
const resultado = calcularSeguimiento({ filasVersion, horizonte, corte: '2026-09', anioStock: 2026, cierresDeStock: stockRaw.cortes.length, stock, consumo, catalogo });
const version: CabeceraVersion = { id: 'v-prueba', nombre: 'Versión armada para la prueba', horizonte, corridaId: corrida.id, aprobadaPor: 'marly', aprobadaEn: new Date().toISOString(), totalCompra: 1, vigente: true, params: { fechaDatos: corrida.fechaDatos } };
const seg: SeguimientoCompleto = { version, resultado, corte: '2026-09' };
{ const raros = stockRaw.productos.filter((p) => p.cortes.some((c) => Math.abs(c.cantidad) > 1e9)).map((p) => `${(p as unknown as { nombrePantalla: string }).nombrePantalla} [${(p as unknown as { categoria: string }).categoria}]`); console.log('productos con stock absurdo (|cantidad| > 1e9):', raros.length, raros.slice(0, 5)); }
console.log('Versión armada: meses', JSON.stringify(resultado.meses.map((m) => [m.mes, m.cerrado, Math.round(m.aprobado / 1e6), Math.round(m.real / 1e6)])), '· cierres de stock', stockRaw.cortes.length, stockRaw.cortes.join(','));
const cierre = (mes: string, rev: number): Cierre => ({
  id: `c-${mes}-${rev}`, mes, revision: rev, fechaDatos: corrida.fechaDatos, usuario: 'marly', creadoEn: new Date().toISOString(),
  indicadores: { compras: kpisCompras(filas), inventario: kpisInventario(filas), cumplimiento: { aprobado: 100, real: 90, pct: 0.9, versionId: 'v', versionNombre: 'v' }, desembolsoPagado: 1.5e9, corridaId: corrida.id },
});

const casos: { nombre: string; clave: string[]; datos: unknown; el: ReactElement; esperado: string[] }[] = [
  { nombre: 'Rendición (sin versión)', clave: ['cmp', 'rendicion'], datos: vistaRendicion(corrida, filas, des), el: <Rendicion />, esperado: ['Rendición de cuentas', 'Sin versión aprobada', 'N2.5', 'Capital inmovilizado'] },
  { nombre: 'Rendición (con versión y meses cerrados)', clave: ['cmp', 'rendicion'], datos: vistaRendicion(corrida, filas, des, seg), el: <Rendicion />, esperado: ['Cumplimiento', 'cerrado/s'] },
  { nombre: 'Presupuesto', clave: ['cmp', 'presupuesto'], datos: vistaPresupuesto(corrida, filas, null), el: <Presupuesto onSku={() => undefined} puedeEditar />, esperado: ['Aprobar este presupuesto', 'Compra por categoría', 'Detalle por insumo'] },
  { nombre: 'Presupuesto (con versión, sin permiso de edición)', clave: ['cmp', 'presupuesto'], datos: vistaPresupuesto(corrida, filas, version), el: <Presupuesto onSku={() => undefined} puedeEditar={false} />, esperado: ['Solo Compras puede aprobar', 'Vigente'] },
  { nombre: 'Inventario', clave: ['cmp', 'inventario'], datos: vistaInventario(corrida, filas), el: <Inventario onSku={() => undefined} />, esperado: ['Por clase ABC', 'Detalle por insumo'] },
  { nombre: 'Ficha SKU (insumo elegido)', clave: ['cmp', 'sku', filas[0]!.clave], datos: vistaSku(corrida, filas, filas[0]!.clave), el: <FichaSku clave={filas[0]!.clave} onElegir={() => undefined} />, esperado: ['Punto de partida', 'Mes a mes', 'Política de inventario'] },
  { nombre: 'Ficha SKU (sin insumo)', clave: ['cmp', 'sku', ''], datos: vistaSku(corrida, filas, null), el: <FichaSku clave={null} onElegir={() => undefined} />, esperado: ['Elegí un insumo'] },
  { nombre: 'OC vencidas (editor)', clave: ['cmp', 'oc'], datos: vistaOc(corrida, controlOc, decisiones), el: <OcVencidas onSku={() => undefined} puedeEditar />, esperado: ['Total vencido', 'Decidir'] },
  { nombre: 'Reposición', clave: ['cmp', 'reposicion'], datos: { corrida: { id: corrida.id, fechaDatos: corrida.fechaDatos }, ...repo }, el: <Reposicion />, esperado: ['Importar primero en staging', 'Descargar archivo para importar en Odoo'] },
  { nombre: 'Seguimiento (con versión)', clave: ['cmp', 'seguimiento', ''], datos: vistaSeguimiento(corrida, seg, [version], [{ mes: '2026-09', concepto: 'Producción de colchones', plan: 10400, real: 10158 }], [{ id: 1, name: 'Frontera Living S.A' }, { id: 2, name: 'Presupuesto' }], []), el: <Seguimiento onSku={() => undefined} />, esperado: ['Cumplimiento por categoría', 'Precisión del pronóstico', 'Versiones aprobadas'] },
  { nombre: 'Seguimiento (sin versión)', clave: ['cmp', 'seguimiento', ''], datos: vistaSeguimiento(corrida, null, [], [], [], []), el: <Seguimiento onSku={() => undefined} />, esperado: ['no hay cumplimiento que medir'] },
  { nombre: 'Evolución (con cierres)', clave: ['cmp', 'evolucion'], datos: vistaEvolucion(corrida, [cierre('2026-08', 1), cierre('2026-09', 1), cierre('2026-09', 2)], true), el: <Evolucion puedeEditar />, esperado: ['Cierres registrados', 'Registrar revisión del cierre'] },
  { nombre: 'Evolución (sin cierres)', clave: ['cmp', 'evolucion'], datos: vistaEvolucion(corrida, [], true), el: <Evolucion puedeEditar />, esperado: ['Todavía no se registró ningún cierre', 'Registrar cierre de'] },
  { nombre: 'Parámetros', clave: ['cmp', 'config', String(new Date().getFullYear())], datos: cfg, el: <Parametros />, esperado: ['Bases de sommier', 'Plan mensual', 'Historial de cambios'] },
];

let fallas = 0;
for (const c of casos) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(c.clave, JSON.parse(JSON.stringify(c.datos)));
  let html = '';
  try {
    html = renderToString(<QueryClientProvider client={qc}>{c.el}</QueryClientProvider>);
  } catch (e) {
    console.log(`FALLA ${c.nombre}: ${e instanceof Error ? e.message : e}`);
    fallas++;
    continue;
  }
  const texto = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const rotos = ['NaN', 'undefined', 'Infinity', '[object Object]'].filter((x) => texto.includes(x));
  const faltan = c.esperado.filter((x) => !texto.includes(x));
  const ok = !rotos.length && !faltan.length && html.length > 150;
  if (!ok) fallas++;
  console.log(`${ok ? 'OK   ' : 'FALLA'} ${c.nombre.padEnd(52)} ${String(Math.round(html.length / 1024)).padStart(5)} KB${rotos.length ? ` · valores rotos: ${rotos.join(', ')}` : ''}${faltan.length ? ` · no aparece: ${faltan.join(' | ')}` : ''}`);
}
// La banda de controles se renderiza sola (no usa datos remotos).
const banda = renderToString(<BandaControles controles={corrida.controles} />).replace(/<[^>]+>/g, ' ');
const bandaOk = banda.includes('Controles de calidad') && !banda.includes('undefined');
if (!bandaOk) fallas++;
console.log(`${bandaOk ? 'OK   ' : 'FALLA'} Banda de controles (${corrida.controles.length} controles)`);
console.log(fallas ? `\n${fallas} FALLAS` : '\nPantallas: todas se renderizan sin errores ni valores rotos');
if (fallas) process.exitCode = 1;
