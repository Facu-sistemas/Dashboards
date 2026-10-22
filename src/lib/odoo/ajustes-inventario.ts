import { readGroup, searchRead, searchReadAll } from './client';
import { withTtlCache } from '@/lib/cache';
import { getArgentinaTodayIso } from './oee';
import { getFacturacionTotalPesosMensual } from './facturacion-gerencia';
import { MATERIA_PRIMA_CATEG_ID } from './raw-material-consumption';
import type { OdooReadGroupResult } from './types';

/**
 * Ajustes de inventario por mes, plata + unidades. Solo lectura.
 *
 * Cruce de dos reportes de Odoo (Inventario > Reportes):
 *  - Valoración (`stock.valuation.layer`): cada ajuste deja una capa con
 *    cantidad Y valor ($). Es la fuente de la plata.
 *  - Historial de movimientos (`stock.move.line`): la cantidad física del
 *    mismo movimiento (`stock_move_id`). Se cruza movimiento a movimiento
 *    para detectar capas cuya cantidad no coincide con lo que se movió.
 *
 * Un "ajuste" es un movimiento con `is_inventory = true` (origen o destino
 * = Virtual Locations/Inventory adjustment). Los ingresos al stock suman y
 * los egresos restan; el neto es lo que impacta el inventario valorizado.
 *
 * Confirmado en vivo (2026-10-21): hay capas corruptas (ej. POLIESTER AZUL
 * - HIPER 19/06/2026 con cantidad 1e30 y valor 6,5e33, en pares +/− que se
 * anulan pero destruyen cualquier suma por pérdida de precisión). Se
 * excluyen de los totales y se listan aparte en `anomalos` para que se
 * puedan corregir en Odoo.
 *
 * Cruce verificado en vivo (2026-10-21, año 2026): 11.000+ movimientos, y
 * solo 5 (jul y ago) no coinciden entre Valoración y Historial. Ojo: Odoo
 * genera capas nuevas al editar un movimiento ya hecho, por eso se compara
 * el Historial (estado final) contra TODAS las capas del movimiento.
 *
 * El mes de una capa es su `create_date` (igual que el reporte Valoración).
 *
 * Bases para medir el desvío en % (pedido de Gastón, 2026-10-22):
 *  1) materia prima valorizada consumida en producción = valor ($) de las
 *     capas de Valoración de movimientos de consumo de una orden de
 *     fabricación (`raw_material_production_id`) de productos de Materia
 *     Prima, por mes;
 *  2) facturación total del mes (la misma de Gerencia > Facturación).
 * Ambas son del período completo, no dependen del filtro de categoría/producto.
 */

const CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_QTY = 1e9;
const MAX_VALUE = 1e12;
const CHUNK = 3000;
const MAX_PRODUCTOS_POR_MES = 300;
const TOL = 0.01;

interface SvlRow extends Record<string, unknown> {
  id: number;
  product_id: [number, string];
  quantity: number;
  value: number;
  create_date: string;
  stock_move_id: [number, string] | false;
}

interface MoveLineRow extends Record<string, unknown> {
  move_id: [number, string] | false;
  quantity_product_uom: number;
  location_id: [number, string];
  location_dest_id: [number, string];
}

export interface AjusteMes {
  /** YYYY-MM */
  mes: string;
  capas: number;
  ingresoCantidad: number;
  ingresoValor: number;
  egresoCantidad: number;
  egresoValor: number;
  netoCantidad: number;
  netoValor: number;
  /** Unidades que Valoración suma de más (+) o de menos (−) respecto del Historial, en los movimientos que no coinciden. */
  difCantidad: number;
  /** Cantidad de movimientos cuyo total en Valoración difiere del historial. */
  movimientosConDiferencia: number;
  movimientos: number;
}

export interface AjusteProducto {
  productId: number;
  producto: string;
  categoria: string;
  uom: string;
  ingresoCantidad: number;
  ingresoValor: number;
  egresoCantidad: number;
  egresoValor: number;
  netoCantidad: number;
  netoValor: number;
  difCantidad: number;
  movimientosConDiferencia: number;
}

export interface AjusteCategoria {
  categoria: string;
  netoCantidad: number[];
  netoValor: number[];
  totalCantidad: number;
  totalValor: number;
}

export interface AjusteAnomalo {
  fecha: string;
  producto: string;
  movimiento: string;
  cantidad: number;
  valor: number;
}

export interface AjustesBase {
  /** $ de materia prima consumida en producción por mes (positivo). */
  materiaPrima: number[];
  /** $ facturados por mes (neto de notas de crédito reales). */
  facturacion: number[];
}

export interface AjustesInventarioResult {
  year: number;
  /** 12 entradas YYYY-MM. */
  months: string[];
  mensual: AjusteMes[];
  total: Omit<AjusteMes, 'mes'>;
  /** Productos por mes (clave YYYY-MM), ordenados por |neto $| desc y recortados. */
  productosPorMes: Record<string, AjusteProducto[]>;
  /** Cuántos productos quedaron fuera del recorte, por mes. */
  productosOmitidos: Record<string, number>;
  categorias: AjusteCategoria[];
  anomalos: AjusteAnomalo[];
  /** Opciones para los filtros: todo lo que tuvo ajustes en el año, sin importar el filtro aplicado. */
  /** Denominadores del desvío en %, 12 meses. */
  base: AjustesBase;
  opciones: { categorias: string[]; productos: { id: number; nombre: string; categoria: string }[] };
}

export interface AjustesFiltro {
  /** Nombres completos de categorías de producto en Odoo; vacío = todas. */
  categorias?: string[];
  productId?: number;
}

interface Raw {
  year: number;
  months: string[];
  buenas: SvlRow[];
  anomalos: AjusteAnomalo[];
  anomalMoves: Set<number>;
  historialPorMov: Map<number, number>;
  svlTotalPorMov: Map<number, number>;
  movsNoComparables: Set<number>;
  info: Map<number, { categoria: string; uom: string }>;
  nombres: Map<number, string>;
  base: AjustesBase;
}

type Acum = {
  capas: number;
  ingresoCantidad: number;
  ingresoValor: number;
  egresoCantidad: number;
  egresoValor: number;
};

function nuevoAcum(): Acum {
  return { capas: 0, ingresoCantidad: 0, ingresoValor: 0, egresoCantidad: 0, egresoValor: 0 };
}

/** Ingreso si suma stock; las capas de solo valor (cantidad 0) siguen el signo del valor. */
function sumarCapa(a: Acum, quantity: number, value: number) {
  a.capas++;
  const ingreso = quantity > 0 || (quantity === 0 && value > 0);
  if (ingreso) {
    a.ingresoCantidad += quantity;
    a.ingresoValor += value;
  } else {
    a.egresoCantidad += quantity;
    a.egresoValor += value;
  }
}

function esAnomala(quantity: number, value: number): boolean {
  return !Number.isFinite(quantity) || !Number.isFinite(value) || Math.abs(quantity) > MAX_QTY || Math.abs(value) > MAX_VALUE;
}

async function inChunks<T extends Record<string, unknown>>(model: string, field: string, ids: number[], fields: string[], extra: Record<string, unknown> = {}): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    out.push(...(await searchReadAll<T>({ model, domain: [[field, 'in', ids.slice(i, i + CHUNK)]], fields, ...extra })));
  }
  return out;
}

export function currentYear(): number {
  return Number(getArgentinaTodayIso().slice(0, 4));
}

/** Lo pesado (Odoo) se cachea por año; el filtro se aplica en memoria sobre esos datos. */
export async function getAjustesInventario(year: number, filtro: AjustesFiltro = {}): Promise<AjustesInventarioResult> {
  const raw = await withTtlCache(`ajustes-inventario:v4:${year}`, CACHE_TTL_MS, () => cargar(year));
  return agregar(raw, filtro);
}

async function cargarBase(year: number, months: string[]): Promise<AjustesBase> {
  type Grupo = OdooReadGroupResult & { value: number; __range?: Record<string, { from: string | false }> };
  const [grupos, facturacion] = await Promise.all([
    readGroup({
      model: 'stock.valuation.layer',
      domain: [
        ['stock_move_id.raw_material_production_id', '!=', false],
        ['product_id.categ_id', 'child_of', MATERIA_PRIMA_CATEG_ID],
        ['create_date', '>=', `${year}-01-01 00:00:00`],
        ['create_date', '<', `${year + 1}-01-01 00:00:00`],
        // Mismas capas corruptas que se excluyen arriba: romperían la suma.
        ['value', '<', MAX_VALUE],
        ['value', '>', -MAX_VALUE],
      ],
      fields: ['value'],
      groupBy: ['create_date:month'],
      lazy: false,
    }) as Promise<Grupo[]>,
    getFacturacionTotalPesosMensual(year),
  ]);
  const porMes = new Map<string, number>();
  for (const g of grupos) {
    const desde = g.__range?.['create_date:month']?.from;
    if (desde) porMes.set(desde.slice(0, 7), Math.abs(g.value));
  }
  return { materiaPrima: months.map((m) => porMes.get(m) ?? 0), facturacion };
}

async function cargar(year: number): Promise<Raw> {
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);

  const [layers, invLocs, base] = await Promise.all([
    searchReadAll<SvlRow>({
      model: 'stock.valuation.layer',
      domain: [
        ['stock_move_id.is_inventory', '=', true],
        ['create_date', '>=', `${year}-01-01 00:00:00`],
        ['create_date', '<', `${year + 1}-01-01 00:00:00`],
      ],
      fields: ['product_id', 'quantity', 'value', 'create_date', 'stock_move_id'],
      order: 'id asc',
      limit: 5000,
    }),
    searchRead<{ id: number }>({ model: 'stock.location', domain: [['usage', '=', 'inventory']], fields: ['id'] }),
    cargarBase(year, months),
  ]);
  const invIds = new Set(invLocs.map((l) => l.id));

  const anomalos: AjusteAnomalo[] = [];
  const anomalMoves = new Set<number>();
  const buenas: SvlRow[] = [];
  for (const l of layers) {
    if (esAnomala(l.quantity, l.value)) {
      anomalos.push({ fecha: l.create_date, producto: l.product_id[1], movimiento: l.stock_move_id ? l.stock_move_id[1] : '', cantidad: l.quantity, valor: l.value });
      if (l.stock_move_id) anomalMoves.add(l.stock_move_id[0]);
    } else {
      buenas.push(l);
    }
  }

  // Cruce con el historial. Odoo agrega capas cuando se edita un movimiento ya hecho, así que el
  // historial (estado final del movimiento) se compara contra TODAS las capas del movimiento,
  // no solo las del año. Signo: desde el ajuste = ingreso, hacia el ajuste = egreso.
  const moveIds = [...new Set(buenas.flatMap((l) => (l.stock_move_id && !anomalMoves.has(l.stock_move_id[0]) ? [l.stock_move_id[0]] : [])))];
  const [lines, capasDeMovs] = await Promise.all([
    inChunks<MoveLineRow>('stock.move.line', 'move_id', moveIds, ['move_id', 'quantity_product_uom', 'location_id', 'location_dest_id']),
    inChunks<SvlRow>('stock.valuation.layer', 'stock_move_id', moveIds, ['quantity', 'value', 'stock_move_id']),
  ]);
  const historialPorMov = new Map<number, number>();
  for (const ln of lines) {
    if (!ln.move_id) continue;
    const desdeAjuste = invIds.has(ln.location_id[0]);
    const haciaAjuste = invIds.has(ln.location_dest_id[0]);
    const signo = desdeAjuste && !haciaAjuste ? 1 : haciaAjuste && !desdeAjuste ? -1 : 0;
    historialPorMov.set(ln.move_id[0], (historialPorMov.get(ln.move_id[0]) ?? 0) + signo * ln.quantity_product_uom);
  }
  const svlTotalPorMov = new Map<number, number>();
  const movsNoComparables = new Set<number>();
  for (const l of capasDeMovs) {
    if (!l.stock_move_id) continue;
    if (esAnomala(l.quantity, l.value)) movsNoComparables.add(l.stock_move_id[0]);
    svlTotalPorMov.set(l.stock_move_id[0], (svlTotalPorMov.get(l.stock_move_id[0]) ?? 0) + l.quantity);
  }

  const productIds = [...new Set(buenas.map((l) => l.product_id[0]))];
  const productos = await inChunks<{ id: number; name: string; categ_id: [number, string] | false; uom_id: [number, string] | false }>(
    'product.product',
    'id',
    productIds,
    ['name', 'categ_id', 'uom_id'],
    { context: { active_test: false } }
  );
  const info = new Map(productos.map((p) => [p.id, { categoria: p.categ_id ? p.categ_id[1] : 'Sin categoría', uom: p.uom_id ? p.uom_id[1] : '' }]));

  const nombres = new Map(buenas.map((l) => [l.product_id[0], l.product_id[1]]));
  return { year, months, buenas, anomalos, anomalMoves, historialPorMov, svlTotalPorMov, movsNoComparables, info, nombres, base };
}

function agregar(raw: Raw, filtro: AjustesFiltro): AjustesInventarioResult {
  const { year, months, anomalos, anomalMoves, historialPorMov, svlTotalPorMov, movsNoComparables, info, nombres, base } = raw;
  const buenas = raw.buenas.filter((l) => {
    if (filtro.productId !== undefined && l.product_id[0] !== filtro.productId) return false;
    if (filtro.categorias?.length && !filtro.categorias.includes(info.get(l.product_id[0])?.categoria ?? 'Sin categoría')) return false;
    return true;
  });

  // Agregación por mes, por producto y por categoría.
  const porMes = new Map<string, Acum>(months.map((m) => [m, nuevoAcum()]));
  const prodMes = new Map<string, Map<number, Acum & { dif: number; conDif: number }>>(months.map((m) => [m, new Map()]));
  const catMes = new Map<string, { cant: number[]; valor: number[] }>();
  const moves = new Map<number, { mes: string; productId: number }>();

  for (const l of buenas) {
    const mes = l.create_date.slice(0, 7);
    const acum = porMes.get(mes);
    if (!acum) continue;
    sumarCapa(acum, l.quantity, l.value);

    const pid = l.product_id[0];
    const pm = prodMes.get(mes)!;
    if (!pm.has(pid)) pm.set(pid, { ...nuevoAcum(), dif: 0, conDif: 0 });
    sumarCapa(pm.get(pid)!, l.quantity, l.value);

    const cat = info.get(pid)?.categoria ?? 'Sin categoría';
    if (!catMes.has(cat)) catMes.set(cat, { cant: Array(12).fill(0), valor: Array(12).fill(0) });
    const mi = months.indexOf(mes);
    catMes.get(cat)!.cant[mi]! += l.quantity;
    catMes.get(cat)!.valor[mi]! += l.value;

    if (l.stock_move_id && !anomalMoves.has(l.stock_move_id[0]) && !moves.has(l.stock_move_id[0])) {
      moves.set(l.stock_move_id[0], { mes, productId: pid });
    }
  }

  const histMes = new Map<string, { dif: number; conDif: number; movimientos: number }>(months.map((m) => [m, { dif: 0, conDif: 0, movimientos: 0 }]));
  for (const [id, mv] of moves) {
    const h = histMes.get(mv.mes)!;
    h.movimientos++;
    if (movsNoComparables.has(id)) continue;
    const dif = (svlTotalPorMov.get(id) ?? 0) - (historialPorMov.get(id) ?? 0);
    if (Math.abs(dif) > TOL) {
      const pr = prodMes.get(mv.mes)!.get(mv.productId)!;
      h.conDif++;
      h.dif += dif;
      pr.conDif++;
      pr.dif += dif;
    }
  }

  const mensual: AjusteMes[] = months.map((mes) => {
    const a = porMes.get(mes)!;
    const h = histMes.get(mes)!;
    return {
      mes,
      capas: a.capas,
      ingresoCantidad: a.ingresoCantidad,
      ingresoValor: a.ingresoValor,
      egresoCantidad: a.egresoCantidad,
      egresoValor: a.egresoValor,
      netoCantidad: a.ingresoCantidad + a.egresoCantidad,
      netoValor: a.ingresoValor + a.egresoValor,
      difCantidad: h.dif,
      movimientosConDiferencia: h.conDif,
      movimientos: h.movimientos,
    };
  });

  const total = mensual.reduce<Omit<AjusteMes, 'mes'>>(
    (t, m) => ({
      capas: t.capas + m.capas,
      ingresoCantidad: t.ingresoCantidad + m.ingresoCantidad,
      ingresoValor: t.ingresoValor + m.ingresoValor,
      egresoCantidad: t.egresoCantidad + m.egresoCantidad,
      egresoValor: t.egresoValor + m.egresoValor,
      netoCantidad: t.netoCantidad + m.netoCantidad,
      netoValor: t.netoValor + m.netoValor,
      difCantidad: t.difCantidad + m.difCantidad,
      movimientosConDiferencia: t.movimientosConDiferencia + m.movimientosConDiferencia,
      movimientos: t.movimientos + m.movimientos,
    }),
    { capas: 0, ingresoCantidad: 0, ingresoValor: 0, egresoCantidad: 0, egresoValor: 0, netoCantidad: 0, netoValor: 0, difCantidad: 0, movimientosConDiferencia: 0, movimientos: 0 }
  );

  const productosPorMes: Record<string, AjusteProducto[]> = {};
  const productosOmitidos: Record<string, number> = {};
  for (const mes of months) {
    const rows: AjusteProducto[] = [...prodMes.get(mes)!].map(([pid, a]) => ({
      productId: pid,
      producto: nombres.get(pid) ?? String(pid),
      categoria: info.get(pid)?.categoria ?? 'Sin categoría',
      uom: info.get(pid)?.uom ?? '',
      ingresoCantidad: a.ingresoCantidad,
      ingresoValor: a.ingresoValor,
      egresoCantidad: a.egresoCantidad,
      egresoValor: a.egresoValor,
      netoCantidad: a.ingresoCantidad + a.egresoCantidad,
      netoValor: a.ingresoValor + a.egresoValor,
      difCantidad: a.dif,
      movimientosConDiferencia: a.conDif,
    }));
    rows.sort((x, y) => Math.abs(y.netoValor) - Math.abs(x.netoValor));
    productosPorMes[mes] = rows.slice(0, MAX_PRODUCTOS_POR_MES);
    productosOmitidos[mes] = Math.max(0, rows.length - MAX_PRODUCTOS_POR_MES);
  }

  const categorias: AjusteCategoria[] = [...catMes].map(([categoria, v]) => ({
    categoria,
    netoCantidad: v.cant,
    netoValor: v.valor,
    totalCantidad: v.cant.reduce((s, x) => s + x, 0),
    totalValor: v.valor.reduce((s, x) => s + x, 0),
  }));
  categorias.sort((a, b) => Math.abs(b.totalValor) - Math.abs(a.totalValor));

  anomalos.sort((a, b) => a.fecha.localeCompare(b.fecha));

  const opcionesProductos = new Map<number, { id: number; nombre: string; categoria: string }>();
  for (const l of raw.buenas) {
    const pid = l.product_id[0];
    if (!opcionesProductos.has(pid)) opcionesProductos.set(pid, { id: pid, nombre: l.product_id[1], categoria: info.get(pid)?.categoria ?? 'Sin categoría' });
  }
  const opciones = {
    categorias: [...new Set([...opcionesProductos.values()].map((p) => p.categoria))].sort((a, b) => a.localeCompare(b, 'es')),
    productos: [...opcionesProductos.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')),
  };

  return { year, months, mensual, total, productosPorMes, productosOmitidos, categorias, anomalos, base, opciones };
}
