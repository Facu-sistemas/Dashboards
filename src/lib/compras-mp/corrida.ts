// Corrida completa de Compras MP: Odoo (solo lectura) → fotos crudas → motor → desembolsos → control de OC → controles
// → resultados guardados en Supabase (calc_*). La web solo lee lo guardado; nunca calcula en el request de una pantalla.
import { getSupabaseAdminClient } from '../supabase/admin';
import { getDiasHabiles } from '../odoo/business-calendar';
import { calcular, type EntradaMotor, type PlanMensual, type ResultadoMotor } from './motor';
import { calcularDesembolsos, type ResultadoDesembolsos } from './desembolsos';
import { controlOcVencidas, type FilaControlOc } from './control-oc';
import { calcularControles, estadoGeneral, type Control, type EstadoControl } from './controles';
import { cargarConfig, cargarPlan } from './config';
import { calcularInventario, type HistoriaStock } from './inventario';
import { kpisCompras, kpisInventario, type FilaCompleta, type KpisCompras, type KpisInventario } from './indicadores';
import { idCorridaRaw } from './raw';
import { limpiarCorridasViejas } from './retencion';
import { aBaseRows } from './odoo/base';
import { aConsumoTabla } from './odoo/consumo';
import { aOcLineas } from './odoo/otros';
import { abrirCorrida, guardarRaw, tomarInstantanea, type FuenteRaw, type InstantaneaOdoo } from './odoo/instantanea';

export type OrigenCorrida = 'cron' | 'manual' | 'golden' | 'paralelo';

export interface ResumenCorrida {
  corridaId: string;
  fechaDatos: string;
  /** AAAA-MM del último mes cerrado y los del horizonte. */
  corte: string;
  horizonte: string[];
  skus: number;
  totalCompra: number;
  compraPorMes: number[];
  compraPorCategoria: { categoria: string; total: number }[];
  compraPorOrigen: Record<string, number>;
  ocVencidas: { lineas: number; valor: number };
  desembolsoProyectado: { mes: string; total: number }[];
  tipoCambio: number;
  kpis: { compras: KpisCompras; inventario: KpisInventario };
  estadoControles: EstadoControl;
  duracionMs: number;
}

const MINUTOS_COLGADA = 15;
const pad2 = (n: number) => String(n).padStart(2, '0');
const hoyAr = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date());

/** Marca como error las corridas que quedaron "corriendo" hace demasiado (se cortó la función a mitad de camino). */
async function liberarColgadas(): Promise<void> {
  const limite = new Date(Date.now() - MINUTOS_COLGADA * 60_000).toISOString();
  await getSupabaseAdminClient()
    .from('compras_corridas')
    .update({ estado: 'error', error: 'Interrumpida: no terminó dentro del tiempo permitido' })
    .eq('estado', 'corriendo')
    .lt('creada_en', limite);
}

export class CorridaEnCursoError extends Error {}

async function insertarEnTandas(tabla: string, filas: Record<string, unknown>[], tanda: number): Promise<void> {
  const supabase = getSupabaseAdminClient();
  for (let i = 0; i < filas.length; i += tanda) {
    const { error } = await supabase.from(tabla).insert(filas.slice(i, i + tanda));
    if (error) throw new Error(`${tabla}: ${error.message}`);
  }
}

/** Arma el plan que consume el motor: cfg_plan + días hábiles del calendario de Odoo (los transcurridos salen siempre del calendario). */
async function armarPlan(anio: number): Promise<PlanMensual> {
  const [cargado, calendario] = await Promise.all([cargarPlan(anio), getDiasHabiles(anio)]);
  const diasHabiles = cargado.diasHabiles.map((v, i) => v ?? calendario.diasTotal[i] ?? null);
  return { ...cargado, diasHabiles, diasTranscurridos: calendario.diasTranscurridos };
}

export interface CalculoCorrida {
  res: ResultadoMotor;
  /** Filas del motor con el inventario hoy (lo que se guarda en calc_sku). */
  filas: FilaCompleta[];
  des: ResultadoDesembolsos;
  controlOc: FilaControlOc[];
  controles: Control[];
  params: Record<string, unknown>;
  corte: number;
  anio: number;
}

/** Stock de fin de mes por producto, con la clave del insumo (`#id`): índice 0 = 31-dic del año anterior, 1 = enero … */
export function aHistoriaStock(snap: InstantaneaOdoo): HistoriaStock {
  const h: HistoriaStock = new Map();
  for (const p of snap.stockFinMes.productos) {
    const cantidad = Array(13).fill(0) as number[];
    const valor = Array(13).fill(0) as number[];
    p.cortes.forEach((c, i) => { if (i <= 12) { cantidad[i] = c.cantidad; valor[i] = c.valor; } });
    h.set(`#${p.productId}`, { cantidad, valor });
  }
  return h;
}

/** Cálculo puro a partir de una instantánea: no escribe nada. */
export async function calcularDesdeInstantanea(snap: InstantaneaOdoo): Promise<CalculoCorrida> {
  const [anioHoy, mesHoy] = snap.fechaDatos.split('-').map(Number) as [number, number];
  // El último mes cerrado es el anterior al de la fecha de los datos.
  const corte = mesHoy === 1 ? 12 : mesHoy - 1;
  const anio = mesHoy === 1 ? anioHoy - 1 : anioHoy;

  const { cfg, extras, nombresExcepciones, filas: filasCfg } = await cargarConfig();
  const plan = await armarPlan(anio);
  // En enero el mes en curso pertenece al año nuevo: sus días salen del calendario de ese año.
  const calMesCurso = mesHoy === 1 ? await getDiasHabiles(anioHoy) : null;
  const diasTranscurridos = mesHoy === 1 ? (calMesCurso?.diasTranscurridos[0] ?? 0) : (plan.diasTranscurridos[mesHoy - 1] ?? 0);
  const diasHabMesCurso = mesHoy === 1 ? (calMesCurso?.diasTotal[0] ?? 0) : (plan.diasHabiles[mesHoy - 1] ?? 0);

  const nombrePorId = new Map(snap.base.productos.map((p) => [p.productId, p.sku]));
  const entrada: EntradaMotor = {
    base: aBaseRows(snap.base), consumo: aConsumoTabla(snap.consumo), plan, oc: aOcLineas(snap.oc, nombrePorId),
    corte, anio, diasTranscurridos, fechaExportacion: snap.fechaDatos, cfg,
  };
  const res = calcular(entrada);

  const costos = new Map(res.filas.map((f) => [f.clave, f.costo]));
  const fraccionMes1 = diasHabMesCurso ? Math.max(0, diasHabMesCurso - diasTranscurridos) / diasHabMesCurso : 0;
  const mesesGasto = [corte - 2, corte - 1, corte].filter((m) => m >= 1);
  const des = calcularDesembolsos({
    anio, mesCurso: corte + 1, fechaExportacion: snap.fechaDatos, fraccionMes1, filas: res.filas, ocs: entrada.oc, ocLineas: res.ocLineas, costos,
    condPago: new Map(Object.entries(snap.finanzas.condPago)), facturas: snap.finanzas.facturas, pagos: snap.finanzas.pagos,
    impuestos: snap.finanzas.impuestos, gastos: snap.finanzas.gastos, origenProveedor: cfg.origen_proveedor, defaults: cfg.cond_pago_default,
    tipoCambio: extras.tipoCambioManual ?? snap.tipoCambio?.pesos ?? null, mesesGastoPromedio: mesesGasto,
  });
  const controlOc = controlOcVencidas({ fechaExportacion: snap.fechaDatos, ocs: entrada.oc, ocLineas: res.ocLineas, filas: res.filas, costos });

  const idsBase = new Set(snap.base.productos.map((p) => p.productId));
  const nombresBase = new Set(snap.base.productos.map((p) => p.sku));
  const excepcionesSinProducto = Object.keys(cfg.excepciones)
    .filter((k) => (k.startsWith('#') ? !idsBase.has(Number(k.slice(1))) : !nombresBase.has(k)))
    .map((k) => nombresExcepciones[k] ?? k);
  const controles = calcularControles({ res, snap, cfg, plan, corte, anio, fraccionMes1, des, controlOc, excepcionesSinProducto });
  const inv = calcularInventario(res.filas, aHistoriaStock(snap), { corte, diasPorSemana: cfg.dias_por_semana });
  const filas: FilaCompleta[] = res.filas.map((f, i) => ({ ...f, ...inv[i]! }));

  const params = {
    corte, anio, mesCurso: mesHoy, diasTranscurridos, diasHabilesMesCurso: diasHabMesCurso, fechaDatos: snap.fechaDatos,
    tipoCambio: des.tipoCambio, configUsada: filasCfg, plan, cfg,
  };
  return { res, filas, des, controlOc, controles, params, corte, anio };
}

/** Guarda los resultados de una corrida (reemplaza lo que hubiera de esa misma corrida). */
async function guardarResultados(corridaId: string, calc: CalculoCorrida, snap: InstantaneaOdoo, inicio: number): Promise<ResumenCorrida> {
  const supabase = getSupabaseAdminClient();
  const { res, filas, des, controlOc, controles, params, corte, anio } = calc;
  for (const t of ['calc_sku_mes', 'calc_sku', 'calc_desembolsos', 'calc_control_oc']) {
    const { error } = await supabase.from(t).delete().eq('corrida_id', corridaId);
    if (error) throw new Error(`${t}: ${error.message}`);
  }

  await insertarEnTandas('calc_sku', filas.map((f) => ({
    corrida_id: corridaId, product_id: f.productId, sku: f.sku, categoria: f.cat, linea: f.lin, origen: f.ori, abc: f.abc, datos: f,
  })), 100);

  const meses = res.meses.map((m) => m.clave);
  const porMes: Record<string, unknown>[] = [];
  for (const f of res.filas) {
    const r = f as unknown as Record<string, number>;
    meses.forEach((mes, i) => {
      const j = i + 1;
      porMes.push({
        corrida_id: corridaId, product_id: f.productId, mes, llegada_u: r[`r${j}`], llegada_ars: r[`rd${j}`], regular_u: r[`rg${j}`], china_u: r[`ch${j}`],
        respaldo_u: r[`bk${j}`], emitir_u: r[`o${j}u`], emitir_ars: r[`o${j}`], faltante_u: j === 1 ? f.o0u : 0, consumo_proy_u: r[`p${j}`],
        deficit_u: r[`fal${j}`], entrante_u: r[`e${j}`],
      });
    });
  }
  await insertarEnTandas('calc_sku_mes', porMes, 500);

  // Desembolsos: pagado real por mes del año y proyectado por mes del horizonte (+ "posterior").
  const filasDes: Record<string, unknown>[] = [];
  const addDes = (mes: string, tipo: 'pagado' | 'proyectado', concepto: string, valor: number) => filasDes.push({ corrida_id: corridaId, mes, tipo, concepto, valor });
  for (let m = 1; m <= 12; m++) {
    const r = des.real[m] ?? [0, 0, 0, 0];
    const mes = `${anio}-${pad2(m)}`;
    addDes(mes, 'pagado', 'neto', r[0]); addDes(mes, 'pagado', 'iva', r[1]); addDes(mes, 'pagado', 'percepciones', r[2]); addDes(mes, 'pagado', 'gastos_importacion', r[3]);
    for (const [tipo, porMesTipo] of Object.entries(des.gastosPorTipo)) addDes(mes, 'pagado', `gastos_${tipo}`, porMesTipo[m] ?? 0);
  }
  const claveMes = (j: number) => (j <= 4 ? (meses[j - 1] ?? `m${j}`) : 'posterior');
  const bloques: [string, number[][]][] = [['facturas', des.facturasAbiertas], ['oc', des.ocEmitidas], ['compras', des.compras]];
  for (const [nombre, tri] of bloques) {
    for (let j = 1; j <= 5; j++) {
      const t = tri[j] ?? [0, 0, 0];
      addDes(claveMes(j), 'proyectado', `${nombre}_neto`, t[0]!); addDes(claveMes(j), 'proyectado', `${nombre}_iva`, t[1]!); addDes(claveMes(j), 'proyectado', `${nombre}_percepciones`, t[2]!);
    }
  }
  des.gastosProyectados.forEach((v, i) => addDes(claveMes(i + 1), 'proyectado', 'gastos_importacion', v));
  await insertarEnTandas('calc_desembolsos', filasDes, 500);

  await insertarEnTandas('calc_control_oc', controlOc.filter((c) => c.lineaId !== null).map((c) => ({
    corrida_id: corridaId, linea_id: c.lineaId, oc_id: c.ordenId, product_id: c.productId, datos: c,
  })), 200);

  // --- resumen
  const sum = (xs: number[]) => xs.reduce((s, v) => s + v, 0);
  const porCat = new Map<string, number>();
  const porOri: Record<string, number> = {};
  for (const f of res.filas) {
    porCat.set(f.cat, (porCat.get(f.cat) ?? 0) + f.rdt);
    porOri[f.ori] = (porOri[f.ori] ?? 0) + f.rdt;
  }
  const desPorMes = meses.map((mes, i) => {
    const j = i + 1;
    const t = [des.facturasAbiertas[j], des.ocEmitidas[j], des.compras[j]].flatMap((x) => x ?? [0, 0, 0]);
    return { mes, total: sum(t) + (des.gastosProyectados[i] ?? 0) };
  });
  const estado = estadoGeneral(controles);
  const resumen: ResumenCorrida = {
    corridaId, fechaDatos: snap.fechaDatos, corte: `${anio}-${pad2(corte)}`, horizonte: meses, skus: res.filas.length,
    totalCompra: sum(res.filas.map((f) => f.rdt)),
    compraPorMes: [1, 2, 3, 4].map((j) => sum(res.filas.map((f) => (f as unknown as Record<string, number>)[`rd${j}`] ?? 0))),
    compraPorCategoria: [...porCat].map(([categoria, total]) => ({ categoria, total })).sort((a, b) => b.total - a.total),
    compraPorOrigen: porOri,
    kpis: { compras: kpisCompras(filas), inventario: kpisInventario(filas) },
    ocVencidas: { lineas: controlOc.length, valor: sum(controlOc.map((c) => c.valor)) },
    desembolsoProyectado: desPorMes, tipoCambio: des.tipoCambio, estadoControles: estado, duracionMs: Date.now() - inicio,
  };
  const { error } = await supabase.from('compras_corridas').update({ estado: 'ok', error: null, params, resumen, controles }).eq('id', corridaId);
  if (error) throw new Error(`compras_corridas: ${error.message}`);
  return resumen;
}

async function marcarError(corridaId: string, e: unknown): Promise<void> {
  const mensaje = e instanceof Error ? e.message : String(e);
  await getSupabaseAdminClient().from('compras_corridas').update({ estado: 'error', error: mensaje.slice(0, 1000) }).eq('id', corridaId);
}

/**
 * Paso 1 de la corrida: lee Odoo (solo lectura) y guarda las fotos crudas. La corrida queda "corriendo" (bloquea otra simultánea)
 * con `params.fase = 'leida'`, lista para el paso 2. Se parte en dos para que cada llamada quede lejos del límite de tiempo de Vercel.
 */
export async function leerOdoo(opts: { origen: OrigenCorrida; disparadaPor?: string }): Promise<{ corridaId: string; fechaDatos: string; inicioMs: number }> {
  const inicioMs = Date.now();
  await liberarColgadas();
  let corridaId: string;
  try {
    corridaId = await abrirCorrida(opts.origen, hoyAr(), opts.disparadaPor);
  } catch (e) {
    // El índice único deja pasar solo una corrida "corriendo" a la vez.
    if (e instanceof Error && /compras_corridas_una_corriendo|duplicate key/i.test(e.message)) {
      throw new CorridaEnCursoError('Ya hay una actualización en curso; esperá a que termine');
    }
    throw e;
  }
  try {
    const snap = await tomarInstantanea();
    await guardarRaw(corridaId, snap);
    const { error } = await getSupabaseAdminClient().from('compras_corridas').update({ params: { fase: 'leida', inicioMs } }).eq('id', corridaId);
    if (error) throw new Error(error.message);
    return { corridaId, fechaDatos: snap.fechaDatos, inicioMs };
  } catch (e) {
    await marcarError(corridaId, e);
    throw e;
  }
}

/** Id de la corrida que ya leyó Odoo y espera el paso 2 (la más reciente), o null. */
export async function corridaLeidaPendiente(): Promise<string | null> {
  const { data, error } = await getSupabaseAdminClient().from('compras_corridas').select('id, params').eq('estado', 'corriendo').order('creada_en', { ascending: false }).limit(1);
  if (error) throw new Error(error.message);
  const c = data?.[0];
  return c && (c.params as { fase?: string } | null)?.fase === 'leida' ? (c.id as string) : null;
}

/** Paso 2: calcula con las fotos guardadas en el paso 1 y guarda los resultados. */
export async function calcularCorrida(corridaId: string): Promise<ResumenCorrida> {
  const { data, error } = await getSupabaseAdminClient().from('compras_corridas').select('estado, params').eq('id', corridaId).maybeSingle();
  if (error) throw new Error(error.message);
  const fase = (data?.params as { fase?: string; inicioMs?: number } | null) ?? {};
  if (!data || data.estado !== 'corriendo' || fase.fase !== 'leida') throw new Error('Esa corrida no está esperando el cálculo: primero hay que leer Odoo');
  try {
    const snap = await cargarInstantanea(corridaId);
    const calc = await calcularDesdeInstantanea(snap);
    const resumen = await guardarResultados(corridaId, calc, snap, fase.inicioMs ?? Date.now());
    // Mantenimiento: si falla no afecta a la corrida que ya quedó guardada.
    await limpiarCorridasViejas().catch((e) => console.error('[compras-mp] no se pudo limpiar corridas viejas', e));
    return resumen;
  } catch (e) {
    await marcarError(corridaId, e);
    throw e;
  }
}

/** Corrida completa en una sola llamada (los dos pasos seguidos). Tarda ~50 s. */
export async function ejecutarCorrida(opts: { origen: OrigenCorrida; disparadaPor?: string }): Promise<ResumenCorrida> {
  const { corridaId } = await leerOdoo(opts);
  return calcularCorrida(corridaId);
}

/** Reconstruye la instantánea de una corrida desde las fotos crudas guardadas (sin tocar Odoo). */
export async function cargarInstantanea(corridaId: string): Promise<InstantaneaOdoo> {
  const { data, error } = await getSupabaseAdminClient().from('raw_compras').select('fuente, fecha_datos, datos').eq('corrida_id', await idCorridaRaw(corridaId));
  if (error || !data?.length) throw new Error(`La corrida ${corridaId} no tiene fotos crudas guardadas`);
  const f = (fuente: FuenteRaw) => data.find((r) => r.fuente === fuente)?.datos;
  return {
    fechaDatos: data[0]!.fecha_datos as string,
    base: f('base'), consumo: f('consumo'), oc: f('oc'), stockFinMes: f('stock_fin_mes'), gasto: f('gasto'),
    finanzas: { condPago: f('cond_pago'), facturas: f('facturas'), pagos: f('pagos'), impuestos: f('impuestos'), gastos: f('gastos_imp') },
    tipoCambio: f('tipo_cambio') ?? null, recepcionesSinFacturar: f('recepciones_sin_facturar') ?? [],
  } as InstantaneaOdoo;
}

/**
 * Recalcula con las fotos crudas de una corrida anterior y las reglas/plan ACTUALES (por ejemplo, después de que Compras
 * cambió un parámetro). No consulta Odoo, así que tarda segundos.
 */
export async function recalcularDesdeCorrida(corridaOrigen: string, opts: { disparadaPor?: string }): Promise<ResumenCorrida> {
  const inicio = Date.now();
  await liberarColgadas();
  const snap = await cargarInstantanea(corridaOrigen);
  const corridaId = await abrirCorrida('manual', snap.fechaDatos, opts.disparadaPor);
  try {
    const calc = await calcularDesdeInstantanea(snap);
    // Siempre apunta a la corrida que tiene las fotos (si el origen ya era un recálculo, a su origen).
    calc.params = { ...calc.params, recalculoDe: await idCorridaRaw(corridaOrigen) };
    return await guardarResultados(corridaId, calc, snap, inicio);
  } catch (e) {
    await marcarError(corridaId, e);
    throw e;
  }
}

/** Recalcula con las fotos de la última corrida terminada bien y las reglas/plan actuales (sin consultar Odoo). */
export async function recalcularUltima(opts: { disparadaPor?: string }): Promise<ResumenCorrida> {
  const u = await ultimaCorrida(true);
  if (!u) throw new Error('Todavía no hay una corrida para recalcular: usá "Actualizar ahora"');
  return recalcularDesdeCorrida(u.id, opts);
}

export interface CorridaGuardada {
  id: string;
  creadaEn: string;
  origen: string;
  disparadaPor: string | null;
  fechaDatos: string;
  estado: string;
  error: string | null;
  resumen: ResumenCorrida | null;
  controles: Control[];
}

/** Última corrida (por defecto, la última terminada bien). */
export async function ultimaCorrida(soloOk = true): Promise<CorridaGuardada | null> {
  let q = getSupabaseAdminClient().from('compras_corridas').select('id, creada_en, origen, disparada_por, fecha_datos, estado, error, resumen, controles').order('creada_en', { ascending: false }).limit(1);
  if (soloOk) q = q.eq('estado', 'ok');
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const r = data?.[0];
  if (!r) return null;
  return {
    id: r.id, creadaEn: r.creada_en, origen: r.origen, disparadaPor: r.disparada_por, fechaDatos: r.fecha_datos, estado: r.estado, error: r.error,
    resumen: (r.resumen && Object.keys(r.resumen).length ? r.resumen : null) as ResumenCorrida | null, controles: (r.controles ?? []) as Control[],
  };
}

