import { readGroup, searchRead, searchReadAll } from './client';
import { withTtlCache } from '../cache';
import { lastMonthKeys, monthBounds } from '../date';
import { getArgentinaTodayIso } from './oee';
import { MATERIA_PRIMA_CATEG_ID } from './raw-material-consumption';
import type { OdooDomain, OdooReadGroupResult } from './types';

/**
 * Rotación por categoría y gasto real de Materia Prima — todo de solo
 * lectura contra Odoo, sin exportar planillas. Se puede acotar a una o más
 * empresas de Odoo (por defecto todas).
 *
 * - Stock valorizado al cierre de cada mes: suma de `stock.valuation.layer`
 *   (cantidad y valor) de cada producto con `create_date < 1° del mes
 *   siguiente`. Es la misma idea que el extracto manual que pidió Compras.
 * - Consumo: capas de valoración cuyo movimiento es consumo de una orden de
 *   fabricación (cantidad y valor negativos → se invierte el signo).
 * - Dos valorizaciones. "capas" usa el valor que registró cada movimiento
 *   en Odoo. "actual" usa la cantidad de las capas × costo estándar actual.
 *   Confirmado en vivo (2026-09-30): hay capas históricas con costo
 *   unitario mal cargado (ej. HILO VAHE POLI 80 BLANCO, junio 2025:
 *   $13.675 por unidad con costo estándar de $0,82) que inflan el consumo
 *   por capas en miles de millones — por eso la valorización "actual" es
 *   la que se muestra por defecto.
 * - Rotación = consumo del período / inventario promedio (promedio de los
 *   cierres de mes, sumando el de apertura).
 * - Gasto real, dos criterios (ambos en pesos):
 *     · Órdenes de compra confirmadas (`purchase`/`done`), por fecha de
 *       confirmación — mide la gestión de Compras. Las órdenes en otra
 *       moneda se convierten con el `currency_rate` de la propia orden
 *       (unidades de moneda de la orden por 1 ARS: USD 0,000657 → $1522).
 *     · Facturas y notas de crédito de proveedor contabilizadas, por fecha
 *       contable, con `balance` (moneda de la compañía, con signo: las
 *       notas de crédito ya restan) — mide el impacto financiero.
 */

export type CriterioGasto = 'ordenes' | 'facturas';
export type Valorizacion = 'capas' | 'actual';

const CACHE_TTL_MS = 10 * 60 * 1000;
const ROTACION_MESES = 16; // mayo 2025 → agosto 2026 al 30/09/2026, igual que el historial de consumo de Compras
const MAX_PARALLEL = 4;

export interface Empresa {
  id: number;
  name: string;
}

export interface MetricasRotacion {
  /** Valor del stock al cierre de cada mes de `meses`. */
  stockCierre: number[];
  /** Consumo valorizado de cada mes de `meses`. */
  consumo: number[];
  inventarioPromedio: number;
  consumoTotal: number;
  /** Consumo del período / inventario promedio. null si no hay inventario promedio. */
  rotacion: number | null;
  /** Rotación llevada a 12 meses. */
  rotacionAnual: number | null;
  /** Días de inventario = inventario promedio / consumo diario. null si no hubo consumo. */
  diasInventario: number | null;
}

export interface RotacionCategoria {
  categoriaId: number;
  categoria: string;
  /** Con el costo que registró cada movimiento en Odoo (`stock.valuation.layer.value`). */
  capas: MetricasRotacion;
  /** Cantidad de las capas × costo estándar actual — inmune a capas históricas con costo mal cargado. */
  actual: MetricasRotacion;
}

export interface RotacionResult {
  empresas: Empresa[];
  /** Meses cerrados del análisis (YYYY-MM), oldest first. */
  meses: string[];
  categorias: RotacionCategoria[];
  total: { capas: MetricasRotacion; actual: MetricasRotacion };
}

export interface GastoProductoRow {
  productId: number;
  producto: string;
  categoria: string;
  /** 12 entradas Ene..Dic, en pesos. */
  mensual: number[];
  total: number;
}

export interface LineaGrande {
  orden: string;
  producto: string;
  proveedor: string;
  moneda: string;
  cantidad: number;
  precioUnitario: number;
  importePesos: number;
}

export interface GastoRealResult {
  empresas: Empresa[];
  year: number;
  criterio: CriterioGasto;
  months: string[];
  categorias: { categoria: string; mensual: number[]; total: number }[];
  productos: GastoProductoRow[];
  totalMensual: number[];
  total: number;
  /** Órdenes en moneda extranjera convertidas a pesos (solo criterio `ordenes`). */
  ordenesEnMonedaExtranjera: number;
  /** Las líneas de mayor importe del año (solo criterio `ordenes`) — para detectar a simple vista una orden mal cargada (ej. precio en pesos en una orden en USD). */
  mayoresLineas: LineaGrande[];
}

function cleanCategoria(name: string): string {
  return name.replace(/^Materia Prima \/ /, '');
}

export async function inBatches<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  }
  return out;
}

export const MP_DOMAIN: OdooDomain = [['product_id.categ_id', 'child_of', MATERIA_PRIMA_CATEG_ID]];

export async function getEmpresas(): Promise<Empresa[]> {
  return withTtlCache('rotacion-gasto:empresas', CACHE_TTL_MS, async () => {
    const rows = await searchRead<{ id: number; name: string }>({ model: 'res.company', domain: [], fields: ['name'], order: 'id asc' });
    return rows.map((r) => ({ id: r.id, name: r.name }));
  });
}

/** Valida los ids pedidos contra las empresas reales; sin ids (o ninguno válido) = todas. */
export async function resolverEmpresas(ids: number[] | undefined): Promise<{ empresas: Empresa[]; seleccion: number[] }> {
  const empresas = await getEmpresas();
  const validos = (ids ?? []).filter((id) => empresas.some((e) => e.id === id));
  const seleccion = validos.length > 0 ? [...new Set(validos)].sort((a, b) => a - b) : empresas.map((e) => e.id);
  return { empresas, seleccion };
}

type ProductInfo = { nombre: string; categoria: string; categoriaId: number; costoActual: number };

async function getProductosMp(): Promise<Map<number, ProductInfo>> {
  return withTtlCache('rotacion-gasto:productos-mp:v2', CACHE_TTL_MS, async () => {
    const products = await searchReadAll<{ id: number; name: string; categ_id: [number, string]; standard_price: number }>({
      model: 'product.product',
      domain: [['categ_id', 'child_of', MATERIA_PRIMA_CATEG_ID]],
      fields: ['name', 'categ_id', 'standard_price'],
      context: { active_test: false },
    });
    return new Map(
      products.map((p) => [p.id, { nombre: p.name, categoria: cleanCategoria(p.categ_id[1]), categoriaId: p.categ_id[0], costoActual: p.standard_price }])
    );
  });
}

// ----------------------------------------------------------------------------- rotación

type SvlGroup = OdooReadGroupResult & { product_id: [number, string] | false; quantity: number; value: number };
type SvlMonthGroup = SvlGroup & { __range?: Record<string, { from: string | false; to: string | false }> };

interface QV {
  quantity: number;
  value: number;
}

async function stockAl(endExclusive: string, companyIds: number[]): Promise<Map<number, QV>> {
  const groups = (await readGroup({
    model: 'stock.valuation.layer',
    domain: [...MP_DOMAIN, ['company_id', 'in', companyIds], ['create_date', '<', `${endExclusive} 00:00:00`]],
    fields: ['quantity:sum', 'value:sum'],
    groupBy: ['product_id'],
    lazy: false,
  })) as SvlGroup[];
  const map = new Map<number, QV>();
  for (const g of groups) if (g.product_id) map.set(g.product_id[0], { quantity: g.quantity, value: g.value });
  return map;
}

/** Consumo por producto y mes. Cantidad y valor de las capas de consumo son negativos → se invierte el signo. */
async function consumoPorProductoYMes(start: string, endExclusive: string, companyIds: number[]): Promise<Map<number, Map<string, QV>>> {
  const groups = (await readGroup({
    model: 'stock.valuation.layer',
    domain: [
      ...MP_DOMAIN,
      ['company_id', 'in', companyIds],
      ['stock_move_id.raw_material_production_id', '!=', false],
      ['create_date', '>=', `${start} 00:00:00`],
      ['create_date', '<', `${endExclusive} 00:00:00`],
    ],
    fields: ['quantity:sum', 'value:sum'],
    groupBy: ['product_id', 'create_date:month'],
    lazy: false,
  })) as SvlMonthGroup[];
  const map = new Map<number, Map<string, QV>>();
  for (const g of groups) {
    const from = g.__range?.['create_date:month']?.from;
    if (!g.product_id || !from) continue;
    if (!map.has(g.product_id[0])) map.set(g.product_id[0], new Map());
    map.get(g.product_id[0])!.set(from.slice(0, 7), { quantity: -g.quantity, value: -g.value });
  }
  return map;
}

function metricas(aperturaYCierres: number[], consumo: number[], diasPeriodo: number): MetricasRotacion {
  const inventarioPromedio = aperturaYCierres.reduce((s, v) => s + v, 0) / (aperturaYCierres.length || 1);
  const consumoTotal = consumo.reduce((s, v) => s + v, 0);
  const rotacion = inventarioPromedio > 0 ? consumoTotal / inventarioPromedio : null;
  return {
    stockCierre: aperturaYCierres.slice(1),
    consumo,
    inventarioPromedio,
    consumoTotal,
    rotacion,
    rotacionAnual: rotacion === null ? null : rotacion * (365 / diasPeriodo),
    diasInventario: consumoTotal > 0 ? inventarioPromedio / (consumoTotal / diasPeriodo) : null,
  };
}

export async function getRotacionPorCategoria(empresaIds?: number[]): Promise<RotacionResult> {
  const { empresas, seleccion } = await resolverEmpresas(empresaIds);
  return withTtlCache(`rotacion-gasto:rotacion:v2:${seleccion.join(',')}`, CACHE_TTL_MS, async () => {
    const today = new Date(`${getArgentinaTodayIso()}T00:00:00Z`);
    const previousMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
    const meses = lastMonthKeys(ROTACION_MESES, previousMonth);
    const start = monthBounds(meses[0]!).start;
    const endExclusive = monthBounds(meses[meses.length - 1]!).endExclusive;

    // cierres[0] = apertura (1° del primer mes); cierres[i+1] = cierre de meses[i]. Inventario promedio = promedio de esos N+1 puntos.
    const [productos, cierres, consumoPorProducto] = await Promise.all([
      getProductosMp(),
      inBatches([start, ...meses.map((m) => monthBounds(m).endExclusive)], MAX_PARALLEL, (cut) => stockAl(cut, seleccion)),
      consumoPorProductoYMes(start, endExclusive, seleccion),
    ]);

    const diasPeriodo = (Date.parse(`${endExclusive}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000;
    type Acc = { name: string; capasStock: number[]; actualStock: number[]; capasCons: number[]; actualCons: number[] };
    const nuevo = (name: string): Acc => ({
      name,
      capasStock: new Array<number>(cierres.length).fill(0),
      actualStock: new Array<number>(cierres.length).fill(0),
      capasCons: new Array<number>(meses.length).fill(0),
      actualCons: new Array<number>(meses.length).fill(0),
    });
    const porCategoria = new Map<number, Acc>();
    const accDe = (productId: number): Acc | null => {
      const meta = productos.get(productId);
      if (!meta) return null;
      if (!porCategoria.has(meta.categoriaId)) porCategoria.set(meta.categoriaId, nuevo(meta.categoria));
      return porCategoria.get(meta.categoriaId)!;
    };

    cierres.forEach((cierre, i) => {
      for (const [productId, qv] of cierre) {
        const a = accDe(productId);
        if (!a) continue;
        a.capasStock[i]! += qv.value;
        a.actualStock[i]! += qv.quantity * productos.get(productId)!.costoActual;
      }
    });
    for (const [productId, porMes] of consumoPorProducto) {
      const a = accDe(productId);
      if (!a) continue;
      meses.forEach((m, i) => {
        const qv = porMes.get(m);
        if (!qv) return;
        a.capasCons[i]! += qv.value;
        a.actualCons[i]! += qv.quantity * productos.get(productId)!.costoActual;
      });
    }

    const categorias: RotacionCategoria[] = [];
    const tot = nuevo('Total');
    for (const [categoriaId, a] of porCategoria) {
      categorias.push({
        categoriaId,
        categoria: a.name,
        capas: metricas(a.capasStock, a.capasCons, diasPeriodo),
        actual: metricas(a.actualStock, a.actualCons, diasPeriodo),
      });
      a.capasStock.forEach((v, i) => (tot.capasStock[i]! += v));
      a.actualStock.forEach((v, i) => (tot.actualStock[i]! += v));
      a.capasCons.forEach((v, i) => (tot.capasCons[i]! += v));
      a.actualCons.forEach((v, i) => (tot.actualCons[i]! += v));
    }
    // Se ordena por consumo a costo actual (el criterio sin errores de carga) y se descartan categorías sin movimiento.
    categorias.sort((a, b) => b.actual.consumoTotal - a.actual.consumoTotal);
    return {
      empresas,
      meses,
      categorias: categorias.filter((c) => c.actual.consumoTotal !== 0 || c.actual.inventarioPromedio !== 0),
      total: {
        capas: metricas(tot.capasStock, tot.capasCons, diasPeriodo),
        actual: metricas(tot.actualStock, tot.actualCons, diasPeriodo),
      },
    };
  });
}

// ----------------------------------------------------------------------------- gasto real

async function gastoPorOrdenes(
  year: number,
  companyIds: number[]
): Promise<{ porProductoMes: Map<number, number[]>; enMonedaExtranjera: number; mayoresLineas: LineaGrande[] }> {
  type Line = {
    order_id: [number, string];
    product_id: [number, string];
    price_subtotal: number;
    product_qty: number;
    price_unit: number;
    date_approve: string | false;
  };
  const lines = await searchReadAll<Line>({
    model: 'purchase.order.line',
    domain: [
      ['order_id.state', 'in', ['purchase', 'done']],
      ['order_id.company_id', 'in', companyIds],
      ['order_id.date_approve', '>=', `${year}-01-01 00:00:00`],
      ['order_id.date_approve', '<', `${year + 1}-01-01 00:00:00`],
      ['display_type', '=', false],
      ...MP_DOMAIN,
    ],
    fields: ['order_id', 'product_id', 'price_subtotal', 'product_qty', 'price_unit', 'date_approve'],
  });

  const orderIds = [...new Set(lines.map((l) => l.order_id[0]))];
  const orders = orderIds.length
    ? await searchReadAll<{ id: number; currency_rate: number; currency_id: [number, string]; date_approve: string | false; partner_id: [number, string] }>({
        model: 'purchase.order',
        domain: [['id', 'in', orderIds]],
        fields: ['currency_rate', 'currency_id', 'date_approve', 'partner_id'],
      })
    : [];
  const orderById = new Map(orders.map((o) => [o.id, o]));

  const porProductoMes = new Map<number, number[]>();
  const foreign = new Set<number>();
  const grandes: LineaGrande[] = [];
  for (const l of lines) {
    const order = orderById.get(l.order_id[0]);
    if (!order || !order.date_approve) continue;
    // `currency_rate` = unidades de moneda de la orden por 1 ARS; para pasar a pesos se divide.
    const rate = order.currency_rate > 0 ? order.currency_rate : 1;
    if (Math.abs(rate - 1) > 1e-9) foreign.add(order.id);
    const month = Number(order.date_approve.slice(5, 7)) - 1;
    const arr = porProductoMes.get(l.product_id[0]) ?? new Array<number>(12).fill(0);
    arr[month]! += l.price_subtotal / rate;
    porProductoMes.set(l.product_id[0], arr);
    grandes.push({
      orden: l.order_id[1],
      producto: l.product_id[1],
      proveedor: order.partner_id[1],
      moneda: order.currency_id[1],
      cantidad: l.product_qty,
      precioUnitario: l.price_unit,
      importePesos: l.price_subtotal / rate,
    });
  }
  grandes.sort((a, b) => b.importePesos - a.importePesos);
  return { porProductoMes, enMonedaExtranjera: foreign.size, mayoresLineas: grandes.slice(0, 5) };
}

async function gastoPorFacturas(year: number, companyIds: number[]): Promise<Map<number, number[]>> {
  type Group = OdooReadGroupResult & {
    product_id: [number, string] | false;
    balance: number;
    __range?: Record<string, { from: string | false; to: string | false }>;
  };
  const groups = (await readGroup({
    model: 'account.move.line',
    domain: [
      ['move_id.move_type', 'in', ['in_invoice', 'in_refund']],
      ['parent_state', '=', 'posted'],
      ['company_id', 'in', companyIds],
      ['display_type', '=', 'product'],
      ...MP_DOMAIN,
      ['date', '>=', `${year}-01-01`],
      ['date', '<', `${year + 1}-01-01`],
    ],
    fields: ['balance:sum'],
    groupBy: ['product_id', 'date:month'],
    lazy: false,
  })) as Group[];
  const map = new Map<number, number[]>();
  for (const g of groups) {
    const from = g.__range?.['date:month']?.from;
    if (!g.product_id || !from) continue;
    const arr = map.get(g.product_id[0]) ?? new Array<number>(12).fill(0);
    arr[Number(from.slice(5, 7)) - 1]! += g.balance;
    map.set(g.product_id[0], arr);
  }
  return map;
}

export async function getGastoReal(criterio: CriterioGasto, empresaIds?: number[]): Promise<GastoRealResult> {
  const year = Number(getArgentinaTodayIso().slice(0, 4));
  const { empresas, seleccion } = await resolverEmpresas(empresaIds);
  return withTtlCache(`rotacion-gasto:gasto:${criterio}:${year}:${seleccion.join(',')}`, CACHE_TTL_MS, async () => {
    const [productos, gasto] = await Promise.all([
      getProductosMp(),
      criterio === 'ordenes'
        ? gastoPorOrdenes(year, seleccion)
        : gastoPorFacturas(year, seleccion).then((porProductoMes) => ({ porProductoMes, enMonedaExtranjera: 0, mayoresLineas: [] as LineaGrande[] })),
    ]);

    const rows: GastoProductoRow[] = [];
    for (const [productId, mensual] of gasto.porProductoMes) {
      const meta = productos.get(productId);
      rows.push({
        productId,
        producto: meta?.nombre ?? `Producto ${productId}`,
        categoria: meta?.categoria ?? 'Sin categoría',
        mensual,
        total: mensual.reduce((s, v) => s + v, 0),
      });
    }
    rows.sort((a, b) => b.total - a.total);

    const byCat = new Map<string, number[]>();
    for (const r of rows) {
      const arr = byCat.get(r.categoria) ?? new Array<number>(12).fill(0);
      r.mensual.forEach((v, i) => (arr[i]! += v));
      byCat.set(r.categoria, arr);
    }
    const categorias = [...byCat.entries()]
      .map(([categoria, mensual]) => ({ categoria, mensual, total: mensual.reduce((s, v) => s + v, 0) }))
      .sort((a, b) => b.total - a.total);
    const totalMensual = Array.from({ length: 12 }, (_, i) => categorias.reduce((s, c) => s + c.mensual[i]!, 0));

    return {
      empresas,
      year,
      criterio,
      months: Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`),
      categorias,
      productos: rows,
      totalMensual,
      total: totalMensual.reduce((s, v) => s + v, 0),
      ordenesEnMonedaExtranjera: gasto.enMonedaExtranjera,
      mayoresLineas: gasto.mayoresLineas,
    };
  });
}
