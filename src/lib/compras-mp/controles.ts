// Controles de calidad de datos de cada corrida (hoja "Controles" del libro v12, más los que salieron de la integración con Odoo).
// Cada corrida guarda el estado de cada control y la web lo muestra en una banda arriba.
import type { Config, PlanMensual, ResultadoMotor } from './motor';
import type { ResultadoDesembolsos } from './desembolsos';
import type { FilaControlOc } from './control-oc';
import type { InstantaneaOdoo } from './odoo/instantanea';

export type EstadoControl = 'OK' | 'AVISO' | 'REVISAR' | 'PENDIENTE';

export interface Control {
  id: string;
  nombre: string;
  valor: string;
  estado: EstadoControl;
  queHacer: string;
  /** Ejemplos (primeros elementos) para saber qué revisar. */
  detalle?: string[];
}

export interface ContextoControles {
  res: ResultadoMotor;
  snap: InstantaneaOdoo;
  cfg: Config;
  plan: PlanMensual;
  corte: number;
  anio: number;
  /** Fracción del mes en curso que falta proyectar. */
  fraccionMes1: number;
  des: ResultadoDesembolsos;
  controlOc: FilaControlOc[];
  /** Excepciones cargadas cuyo producto no está en la base (por nombre o id). */
  excepcionesSinProducto: string[];
}

/** Categorías que el libro conoce (hoja Parámetros, columna L). Una categoría nueva cae en "Living" por defecto, así que se avisa. */
export const CATEGORIAS_CONOCIDAS = [
  'Alambre', 'Bases', 'Buloneria', 'Cartones', 'Cincha', 'Grampas', 'Lienzo', 'Madera', 'Mecanismos', 'Mercería', 'Nylon', 'Otros',
  'Patas', 'Químicos', 'TNT', 'Tela Colchon', 'Tela Living',
];

const num = (n: number, dec = 0) => n.toLocaleString('es-AR', { maximumFractionDigits: dec });
const pct = (n: number) => `${(n * 100).toFixed(1)} %`;
const primeros = (xs: string[], n = 8) => (xs.length > n ? [...xs.slice(0, n), `… y ${xs.length - n} más`] : xs);

export function calcularControles(c: ContextoControles): Control[] {
  const out: Control[] = [];
  const add = (id: string, nombre: string, valor: string, estado: EstadoControl, queHacer: string, detalle?: string[]) =>
    out.push({ id, nombre, valor, estado, queHacer, ...(detalle && detalle.length ? { detalle: primeros(detalle) } : {}) });
  const { res, snap, cfg, plan, corte, anio } = c;
  const filas = res.filas;
  const baseIds = new Set(snap.base.productos.map((p) => p.productId));
  const horizonte = [1, 2, 3, 4].map((j) => corte + j);
  const val = (arr: (number | null)[], m: number) => (m >= 1 && m <= 12 && typeof arr[m - 1] === 'number' ? (arr[m - 1] as number) : 0);

  // --- calibración y plan
  const claveCorte = `${anio}-${String(corte).padStart(2, '0')}`;
  add('mes_corte', 'Mes de corte encontrado en el historial de consumo', snap.consumo.meses.includes(claveCorte) ? claveCorte : 'NO ENCONTRADO',
    snap.consumo.meses.includes(claveCorte) ? 'OK' : 'REVISAR', 'El consumo de Odoo no trae el último mes cerrado');

  const calib = [corte - 3, corte - 2, corte - 1, corte].flatMap((m) => [val(plan.prodRealColchones, m), val(plan.prodRealSillones, m)]).filter((v) => v > 0).length;
  add('prod_real_calibracion', 'Producción real de calibración cargada (4 meses de colchones y sillones > 0)', `${calib} de 8`, calib === 8 ? 'OK' : 'REVISAR',
    'Cargar la producción real de los meses cerrados en el plan');

  const mesesPlan = horizonte.filter((m) => m <= 12);
  const consCargado = mesesPlan.filter((m) => val(plan.prodConsColchones, m) > 0 && val(plan.prodConsSillones, m) > 0).length;
  add('plan_consensuado', 'Plan consensuado cargado para el horizonte', `${consCargado} de ${mesesPlan.length} meses`, consCargado === mesesPlan.length ? 'OK' : 'REVISAR',
    'Cargar la producción consensuada de colchones y sillones del horizonte');

  const dh = val(plan.diasHabiles, corte + 1);
  add('dias_habiles', 'Días hábiles del mes en curso', String(dh), dh > 0 ? 'OK' : 'REVISAR', 'No hay días hábiles para el mes en curso (calendario de Odoo o plan)');

  const m5 = corte + 5;
  const sigCargado = (m5 <= 12 && val(plan.prodConsColchones, m5) > 0) || cfg.plan_mes_siguiente.prod_colchones !== null;
  add('plan_mes_siguiente', 'Plan del mes siguiente al horizonte (cobertura al cierre)', sigCargado ? 'Cargado' : 'Usa el último mes como aproximación', sigCargado ? 'OK' : 'AVISO',
    'Cargarlo cuando Comercial y Producción lo entreguen');
  if (horizonte.includes(13)) {
    const ene = (cfg.plan_enero_siguiente.prod_colchones ?? 0) > 0;
    add('plan_enero', 'Plan de enero del año siguiente cargado', ene ? 'Cargado' : 'Usa diciembre', ene ? 'OK' : 'AVISO', 'Cargar enero del año siguiente en los parámetros del plan');
  }
  if (corte === 12) {
    add('cambio_anio', 'Corte en diciembre: el horizonte cruza de año', 'Plan del año siguiente', 'AVISO',
      'El plan de los meses del año siguiente se toma de "enero del año siguiente"; revisar que esté cargado');
  }

  // --- datos leídos
  add('skus', 'Insumos leídos de la base', String(filas.length), filas.length > 0 ? 'OK' : 'REVISAR', 'La base de Odoo no trajo productos');

  const iCorte = snap.consumo.meses.indexOf(claveCorte);
  const sinFicha = iCorte >= 0
    ? snap.consumo.filas.filter((f) => !baseIds.has(f.productId) && f.vals.slice(Math.max(0, iCorte - 2), iCorte + 1).reduce((s, v) => s + v, 0) > 0)
    : [];
  add('consumo_sin_ficha', 'Insumos con consumo (últimos 3 meses) que no están en la base', String(sinFicha.length), sinFicha.length ? 'AVISO' : 'OK',
    'Normal si son productos archivados y sin stock; si no, revisar la ficha', sinFicha.map((f) => f.sku));

  const conocidas = new Set([...CATEGORIAS_CONOCIDAS, ...Object.keys(cfg.linea_por_categoria)]);
  const catNuevas = [...new Set(filas.filter((f) => !conocidas.has(f.cat)).map((f) => f.cat))];
  add('categorias', 'Categorías de productos que el presupuesto no conoce', String(catNuevas.length), catNuevas.length ? 'REVISAR' : 'OK',
    'Agregar la categoría nueva a las reglas (línea Colchones / Living / Ambos)', catNuevas);

  const consignados = filas.filter((f) => f.met === 'Consignado');
  add('costo_cero', 'Insumos con costo 0 (tratados como consignados)', String(consignados.length), consignados.length <= 7 ? 'OK' : 'AVISO',
    'Confirmar si son consignados o falta cargar el costo en Odoo', consignados.map((f) => f.sku));

  add('excepciones_sin_producto', 'Excepciones cuyo producto no existe en la base', String(c.excepcionesSinProducto.length), c.excepcionesSinProducto.length ? 'REVISAR' : 'OK',
    'El producto se renombró, se archivó o el nombre estaba mal escrito: corregir la excepción', c.excepcionesSinProducto);

  const sinOrigen = [...new Set(filas.map((f) => f.prov.trim()).filter((p) => p && !(p in cfg.origen_proveedor)))];
  add('proveedores_sin_origen', 'Proveedores sin origen cargado en las reglas', String(sinOrigen.length), sinOrigen.length ? 'AVISO' : 'OK',
    'Se toman como Local; agregarlos a la lista de proveedores con su origen', sinOrigen);

  add('nombres_repetidos', 'Productos distintos con el mismo nombre', String(snap.base.nombresDuplicados.length), snap.base.nombresDuplicados.length ? 'AVISO' : 'OK',
    'El cálculo los distingue por ID; conviene renombrar uno para no confundirse en pantalla', snap.base.nombresDuplicados);

  // --- consistencia del cálculo
  const porClase = ['A', 'B', 'C', 'Sin consumo'].reduce((s, k) => s + filas.filter((f) => f.abc === k).length, 0);
  add('abc_completo', 'Clase ABC: A + B + C + Sin consumo = insumos', `${porClase} de ${filas.length}`, porClase === filas.length ? 'OK' : 'REVISAR', 'Error de clasificación: avisar');

  const bajoMinimo = filas.filter((f) => {
    if (f.cic > 1 && f.resp === 'Sin respaldo') return false;
    const w4 = f.w4;
    return f.en4 < (f.cic > 1 ? f.ss * w4 : f.obs * w4) - 0.001;
  });
  add('stock_cierre_minimo', 'Stock al cierre ≥ nivel mínimo de la política en todos los insumos', String(bajoMinimo.length), bajoMinimo.length ? 'REVISAR' : 'OK',
    'Error en la regla de compra: avisar', bajoMinimo.map((f) => f.sku));

  const fac = c.fraccionMes1 + 3;
  const proyectado = filas.reduce((s, f) => s + f.pv, 0) / fac;
  const real = filas.reduce((s, f) => s + f.c4t * f.costo, 0) / 4;
  const ratio = real ? proyectado / real : 0;
  add('proyectado_vs_real', 'Consumo proyectado vs consumo real reciente (valorizado, por mes)', ratio.toFixed(2), ratio >= 0.8 && ratio <= 1.3 ? 'OK' : 'AVISO',
    'Fuera de 0,8–1,3: revisar el plan o los coeficientes');

  const repartido = filas.reduce((s, f) => s + f.oca + f.esf - f.ent, 0);
  add('entrante_repartido', 'Entrante repartido (con fecha + sin OC) = entrante de la base', num(repartido, 2), Math.abs(repartido) < 0.01 ? 'OK' : 'REVISAR', 'Error en el reparto del entrante');

  const venc = filas.reduce((s, f) => s + (f.ev + f.esf) * f.costo, 0);
  add('entrante_vencido', 'Entrante vencido o sin OC (pasado al mes 2), en $', num(venc), venc === 0 ? 'OK' : 'AVISO', 'Confirmar fechas con los proveedores (Control de OC vencidas)');

  const ocSinEntrante = filas.reduce((s, f) => s + (f.ocp - f.oca) * f.costo, 0);
  add('oc_sin_entrante', 'OC pendientes sin entrante en Odoo (a depurar), en $', num(ocSinEntrante), ocSinEntrante < 1 ? 'OK' : 'AVISO', 'Cerrar o cancelar saldos viejos en Odoo');

  // --- vínculos con Odoo
  const ocFuera = snap.oc.filter((l) => !baseIds.has(l.productId));
  const ocVinc = snap.oc.length ? 1 - ocFuera.length / snap.oc.length : 1;
  add('oc_vinculadas', 'Líneas de OC vinculadas a un producto de la base', pct(ocVinc), ocVinc >= 0.95 ? 'OK' : 'REVISAR',
    'Líneas de OC de productos que no están en la base (archivados o fuera de Materia Prima)', ocFuera.map((l) => `${l.orden} · ${l.nombrePantalla}`));
  add('oc_producto_archivado', 'OC pendientes sobre productos archivados', String(ocFuera.length), ocFuera.length ? 'AVISO' : 'OK',
    'Cerrar la OC o reactivar el producto en Odoo', ocFuera.map((l) => `${l.orden} · ${l.nombrePantalla} (${num(l.pendiente, 1)} u)`));

  const gastoTot = snap.gasto.reduce((s, l) => s + Math.abs(l.importe), 0);
  const gastoVinc = gastoTot ? snap.gasto.filter((l) => baseIds.has(l.productId)).reduce((s, l) => s + Math.abs(l.importe), 0) / gastoTot : null;
  add('gasto_vinculado', 'Gasto real vinculado a la base (% del importe)', gastoVinc === null ? 'Sin datos' : pct(gastoVinc),
    gastoVinc === null ? 'PENDIENTE' : gastoVinc >= 0.98 ? 'OK' : 'REVISAR', 'Productos del gasto que no están en la base: revisar');

  const ultimo = snap.stockFinMes.cortes.length - 1;
  const mp = snap.stockFinMes.productos.filter((p) => p.categoria.startsWith('Materia Prima'));
  const stockTot = mp.reduce((s, p) => s + (p.cortes[ultimo]?.valor ?? 0), 0);
  const stockVinc = stockTot ? mp.filter((p) => baseIds.has(p.productId)).reduce((s, p) => s + (p.cortes[ultimo]?.valor ?? 0), 0) / stockTot : null;
  add('stock_vinculado', `Stock de fin de mes vinculado a la base (% del valor, ${snap.stockFinMes.cortes[ultimo] ?? 's/d'})`, stockVinc === null ? 'Sin datos' : pct(stockVinc),
    stockVinc === null ? 'PENDIENTE' : stockVinc >= 0.98 ? 'OK' : 'REVISAR', 'Productos con stock valorizado que no están en la base');

  const factOk = new Set(snap.finanzas.impuestos.map((i) => i.numero));
  const pagosTot = snap.finanzas.pagos.reduce((s, p) => s + p.importeArs, 0);
  const pagosVinc = pagosTot ? snap.finanzas.pagos.filter((p) => factOk.has((p.facturas || '').split(',')[0]!.trim())).reduce((s, p) => s + p.importeArs, 0) / pagosTot : null;
  add('pagos_vinculados', 'Pagos vinculados a facturas con impuestos (% del importe)', pagosVinc === null ? 'Sin datos' : pct(pagosVinc),
    pagosVinc === null ? 'PENDIENTE' : pagosVinc >= 0.9 ? 'OK' : 'AVISO', 'Los pagos sin factura (anticipos) se toman como neto');

  add('tipo_cambio', 'Tipo de cambio USD usado en los desembolsos', c.des.tipoCambio ? num(c.des.tipoCambio, 2) : 'Sin cotización', c.des.tipoCambio > 0 ? 'OK' : 'REVISAR',
    'Cargar la cotización en Odoo o un tipo de cambio manual');

  const controlVenc = c.controlOc.length;
  add('oc_vencidas', 'OC vencidas con entrante pendiente', `${controlVenc} líneas · $${num(c.controlOc.reduce((s, x) => s + x.valor, 0))}`, controlVenc ? 'AVISO' : 'OK',
    'Ver el Control de OC vencidas y decidir línea por línea');

  // --- riesgos de abastecimiento
  const chSinResp = filas.filter((f) => f.resp === 'Sin respaldo');
  add('china_sin_respaldo', 'Insumos de China sin origen de respaldo', String(chSinResp.length), chSinResp.length ? 'AVISO' : 'OK',
    'Si el contenedor se atrasa no hay a quién comprarle: evaluar un proveedor alternativo', chSinResp.map((f) => f.sku));
  const chResp = filas.filter((f) => f.bk1 + f.bk2 + f.bk3 + f.bk4 > 0);
  add('china_respaldo', 'Insumos de China que necesitan compra de respaldo', String(chResp.length), chResp.length ? 'AVISO' : 'OK',
    'Son compras de urgencia a proveedor local o de Brasil: ver Presupuesto', chResp.map((f) => f.sku));
  const quiebre = filas.filter((f) => f.qm > 0);
  add('quiebre', 'Insumos con quiebre proyectado (stock < 0)', String(quiebre.length), quiebre.length ? 'AVISO' : 'OK',
    'Ninguna compra nueva llega a tiempo o China sin respaldo', quiebre.map((f) => f.sku));
  const faltante = filas.filter((f) => f.o0u > 0);
  add('faltante_seguridad', 'Insumos bajo seguridad antes de poder recibir una compra nueva', String(faltante.length), faltante.length ? 'AVISO' : 'OK',
    'Emitir ya y avisar a Producción', faltante.map((f) => f.sku));

  return out;
}

/** Peor estado entre los controles (para el semáforo de la banda). */
export function estadoGeneral(controles: Control[]): EstadoControl {
  if (controles.some((c) => c.estado === 'REVISAR')) return 'REVISAR';
  if (controles.some((c) => c.estado === 'AVISO')) return 'AVISO';
  if (controles.some((c) => c.estado === 'PENDIENTE')) return 'PENDIENTE';
  return 'OK';
}

