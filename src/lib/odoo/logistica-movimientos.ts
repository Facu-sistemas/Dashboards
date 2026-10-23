import { searchReadAll } from './client';
import { withTtlCache } from '@/lib/cache';
import { getFronteraCompany } from './reference';
import { COLCHONES_CATEG_IDS, LIVING_CATEG_IDS, getArgentinaTodayIso } from './oee';
import { getEquivalenteByTemplate } from './producto-equivalente';
import { getClientesActivosCompanies, getIgnoredCreditNoteMoveIds } from './clientes-activos';
import type { OdooDomain } from './types';

/**
 * "Entregas, fabricación y ventas" (Logística) — tres tablas mensuales por
 * categoría macro (Colchones / Sillones), cada una con su propia fecha:
 *
 *  - Entregas: lo facturado. Líneas de facturas de cliente posteadas por
 *    `invoice_date`, restando las notas de crédito reales (mismo criterio que
 *    Gerencia > Facturación: las NC comerciales/de descuento que
 *    `getIgnoredCreditNoteMoveIds` marca no restan). Es "factura − nota de crédito".
 *  - Fabricadas: órdenes de fabricación hechas, por Fecha fin (`date_finished`).
 *  - Vendidas: líneas de pedidos confirmados, por Fecha de la orden (`date_order`).
 *
 * Cada una mide Cantidad, Equivalente (cantidad × `x_studio_equivalente_produccion`
 * del template; en fabricación de sillones, `x_studio_unidades_eq` de la orden,
 * igual que Gerencia > Producción) y m³ (cantidad × `product.product.volume`).
 * Las categorías de cada fuente replican las de su pestaña de Gerencia para que
 * los totales coincidan con ellas.
 *
 * Además: stock disponible actual (`free_qty` = a mano − reservado) con su m³ o
 * equivalente. Solo lectura.
 */

const SILLONES_CATEG_IDS = [3, 2, 16]; // Lean, Tradicional, Deliveries
const COLCHONES_CATEG_ID = 5;
const TTL_MS = 10 * 60 * 1000;

export type Macro = 'colchones' | 'sillones';

export interface Medidas {
  cant: number;
  equiv: number;
  m3: number;
}

export interface MesFila extends Medidas {
  /** "YYYY-MM" */
  mes: string;
}

export interface AnioFila extends Medidas {
  anio: number;
  meses: MesFila[];
}

export interface GrupoMensual {
  total: Medidas;
  anios: AnioFila[];
}

export type Movimiento = Record<Macro, GrupoMensual>;

export interface StockFila {
  producto: string;
  disponible: number;
  /** m³ en colchones, unidades equivalentes en sillones. */
  medida: number;
}

export interface LogisticaMovimientosResult {
  hoy: string;
  entregas: Movimiento;
  fabricadas: Movimiento;
  vendidas: Movimiento;
  stock: Record<Macro, { filas: StockFila[]; totalDisponible: number; totalMedida: number }>;
}

interface Linea {
  fecha: string;
  productId: number;
  cant: number;
  /** Si viene (equivalente de la orden), pisa cant × factor del template. */
  equivDirecto?: number;
}

interface ProductoInfo {
  tmplId: number;
  volume: number;
}

const vacio = (): Medidas => ({ cant: 0, equiv: 0, m3: 0 });

async function infoProductos(productIds: number[]): Promise<{ info: Map<number, ProductoInfo>; ue: Map<number, number> }> {
  if (productIds.length === 0) return { info: new Map(), ue: new Map() };
  const rows = await searchReadAll<{ id: number; product_tmpl_id: [number, string]; volume: number }>({
    model: 'product.product',
    domain: [['id', 'in', productIds]],
    fields: ['product_tmpl_id', 'volume'],
    context: { active_test: false },
  });
  const info = new Map(rows.map((r) => [r.id, { tmplId: r.product_tmpl_id[0], volume: r.volume || 0 }]));
  const ue = await getEquivalenteByTemplate([...new Set(rows.map((r) => r.product_tmpl_id[0]))]);
  return { info, ue };
}

/** Agrupa líneas firmadas (`sign` ya aplicado en cant/equivDirecto) por año → mes. */
async function agrupar(lineas: Linea[]): Promise<GrupoMensual> {
  const { info, ue } = await infoProductos([...new Set(lineas.map((l) => l.productId))]);
  const porMes = new Map<string, Medidas>();
  const total = vacio();
  for (const l of lineas) {
    const p = info.get(l.productId);
    const factor = p ? (ue.get(p.tmplId) ?? 0) : 0;
    const m = porMes.get(l.fecha.slice(0, 7)) ?? vacio();
    const equiv = l.equivDirecto ?? l.cant * factor;
    const m3 = l.cant * (p?.volume ?? 0);
    m.cant += l.cant;
    m.equiv += equiv;
    m.m3 += m3;
    porMes.set(l.fecha.slice(0, 7), m);
    total.cant += l.cant;
    total.equiv += equiv;
    total.m3 += m3;
  }
  const anios = new Map<number, AnioFila>();
  for (const [mes, m] of [...porMes.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const anio = Number(mes.slice(0, 4));
    const fila = anios.get(anio) ?? { anio, ...vacio(), meses: [] };
    fila.cant += m.cant;
    fila.equiv += m.equiv;
    fila.m3 += m.m3;
    fila.meses.push({ mes, ...m });
    anios.set(anio, fila);
  }
  return { total, anios: [...anios.values()].sort((a, b) => a.anio - b.anio) };
}

// ── Entregas (facturado − notas de crédito) ──────────────────────────────

async function lineasFacturadas(domain: OdooDomain, start: string, ignored: Set<number>): Promise<Linea[]> {
  const rows = await searchReadAll<{ invoice_date: string; product_id: [number, string]; quantity: number; move_type: string; move_id: [number, string] }>({
    model: 'account.move.line',
    domain: [
      ['move_type', 'in', ['out_invoice', 'out_refund']],
      ['parent_state', '=', 'posted'],
      ...domain,
      ['invoice_date', '>=', start],
    ],
    fields: ['invoice_date', 'product_id', 'quantity', 'move_type', 'move_id'],
  });
  const out: Linea[] = [];
  for (const r of rows) {
    if (!r.product_id || !r.invoice_date) continue;
    let sign = 1;
    if (r.move_type === 'out_refund') sign = ignored.has(r.move_id[0]) ? 0 : -1;
    if (sign === 0) continue;
    out.push({ fecha: r.invoice_date, productId: r.product_id[0], cant: sign * r.quantity });
  }
  return out;
}

// ── Fabricadas (OF hechas por fecha fin) ─────────────────────────────────

async function lineasFabricadas(categIds: number[], companyId: number, start: string, usarUnidadesEq: boolean): Promise<Linea[]> {
  const rows = await searchReadAll<{ date_finished: string; product_id: [number, string]; qty_produced: number; x_studio_unidades_eq: number }>({
    model: 'mrp.production',
    domain: [
      ['state', '=', 'done'],
      ['company_id', '=', companyId],
      ['product_id.categ_id', 'in', categIds],
      ['date_finished', '>=', start],
    ],
    fields: ['date_finished', 'product_id', 'qty_produced', 'x_studio_unidades_eq'],
  });
  return rows
    .filter((r) => r.product_id && r.date_finished)
    .map((r) => ({
      fecha: r.date_finished,
      productId: r.product_id[0],
      cant: r.qty_produced,
      equivDirecto: usarUnidadesEq ? r.x_studio_unidades_eq : undefined,
    }));
}

// ── Vendidas (pedidos confirmados por fecha de la orden) ─────────────────

async function lineasVendidas(domain: OdooDomain, start: string): Promise<Linea[]> {
  const rows = await searchReadAll<{ order_id: [number, string]; product_id: [number, string]; product_uom_qty: number }>({
    model: 'sale.order.line',
    domain: [['order_id.state', '=', 'sale'], ...domain, ['order_id.date_order', '>=', start]],
    fields: ['order_id', 'product_id', 'product_uom_qty'],
  });
  if (rows.length === 0) return [];
  const orders = await searchReadAll<{ id: number; date_order: string }>({
    model: 'sale.order',
    domain: [['id', 'in', [...new Set(rows.map((r) => r.order_id[0]))]]],
    fields: ['date_order'],
  });
  const fechaPorOrden = new Map(orders.map((o) => [o.id, o.date_order]));
  const out: Linea[] = [];
  for (const r of rows) {
    const fecha = fechaPorOrden.get(r.order_id[0]);
    if (fecha && r.product_id) out.push({ fecha, productId: r.product_id[0], cant: r.product_uom_qty });
  }
  return out;
}

// ── Stock disponible ─────────────────────────────────────────────────────

async function stockDisponible(categIds: number[], medida: 'm3' | 'equiv'): Promise<{ filas: StockFila[]; totalDisponible: number; totalMedida: number }> {
  const rows = await searchReadAll<{ display_name: string; free_qty: number; volume: number; x_studio_equivalente_produccion: number }>({
    model: 'product.product',
    domain: [['categ_id', 'in', categIds], ['free_qty', '>', 0]],
    fields: ['display_name', 'free_qty', 'volume', 'x_studio_equivalente_produccion'],
  });
  const filas = rows
    .map((r) => ({
      producto: r.display_name,
      disponible: r.free_qty,
      medida: r.free_qty * (medida === 'm3' ? r.volume || 0 : r.x_studio_equivalente_produccion || 0),
    }))
    .sort((a, b) => b.disponible - a.disponible || a.producto.localeCompare(b.producto));
  return {
    filas,
    totalDisponible: filas.reduce((s, f) => s + f.disponible, 0),
    totalMedida: filas.reduce((s, f) => s + f.medida, 0),
  };
}

export function getLogisticaMovimientos(): Promise<LogisticaMovimientosResult> {
  return withTtlCache('logistica:movimientos', TTL_MS, compute);
}

async function compute(): Promise<LogisticaMovimientosResult> {
  const hoy = getArgentinaTodayIso();
  const start = `${Number(hoy.slice(0, 4)) - 1}-01-01`;

  const [{ companyId }, companies] = await Promise.all([getFronteraCompany(), getClientesActivosCompanies()]);
  const ignored = new Set(
    await getIgnoredCreditNoteMoveIds(
      companies.map((c) => c.id),
      start
    )
  );

  const colchonesCateg: OdooDomain = [['product_id.categ_id', 'child_of', COLCHONES_CATEG_ID]];
  const sillonesCateg: OdooDomain = [['product_id.categ_id', 'in', SILLONES_CATEG_IDS]];

  const [entC, entS, fabC, fabS, venC, venS, stockC, stockS] = await Promise.all([
    lineasFacturadas(colchonesCateg, start, ignored).then(agrupar),
    lineasFacturadas(sillonesCateg, start, ignored).then(agrupar),
    lineasFabricadas(COLCHONES_CATEG_IDS, companyId, start, false).then(agrupar),
    lineasFabricadas(LIVING_CATEG_IDS, companyId, start, true).then(agrupar),
    lineasVendidas(colchonesCateg, start).then(agrupar),
    lineasVendidas(sillonesCateg, start).then(agrupar),
    stockDisponible(COLCHONES_CATEG_IDS, 'm3'),
    stockDisponible(SILLONES_CATEG_IDS, 'equiv'),
  ]);

  return {
    hoy,
    entregas: { colchones: entC, sillones: entS },
    fabricadas: { colchones: fabC, sillones: fabS },
    vendidas: { colchones: venC, sillones: venS },
    stock: { colchones: stockC, sillones: stockS },
  };
}
