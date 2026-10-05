import { readGroup, searchReadAll } from './client';
import { getFronteraCompany } from './reference';
import { withTtlCache } from '../cache';
import { lastMonthKeys, monthBounds } from '../date';
import { getArgentinaTodayIso } from './oee';
import { MATERIA_PRIMA_CATEG_ID } from './raw-material-consumption';
import type { OdooReadGroupResult } from './types';

/**
 * "Pronóstico" (Test) — versión sencilla, sin planilla de objetivos ni
 * coeficientes por línea: todo sale del consumo real de los últimos meses.
 *
 * Avisos de compra, por insumo:
 *   consumo diario = consumo real de los últimos 3 meses cerrados ÷ días de esos meses
 *   días de cobertura = (disponible + entrante − mínimo) ÷ consumo diario
 * El mínimo/máximo sale de las reglas de reabastecimiento (`stock.warehouse.orderpoint`)
 * y el plazo del proveedor de `product.supplierinfo.delay`. El estado (comprar ya /
 * pronto / ok) y la cantidad sugerida se calculan en el cliente porque dependen
 * del horizonte que se elija en pantalla.
 *
 * Reporte mes a mes (últimos 12 meses cerrados), todo valorizado a costo estándar actual:
 *   pronóstico[m] = promedio del consumo de los 3 meses anteriores a m  (la misma regla de los avisos)
 *   consumo[m]    = consumo real de órdenes de fabricación
 *   compras[m]    = órdenes de compra confirmadas, por fecha de confirmación, en pesos
 *
 * Confirmado en vivo (2026-10-04): la orden P02213 (ACIER SA) está en USD con los
 * precios cargados en pesos — USD 105.915 por base → ~$9.100 M de más en septiembre.
 * Por eso una línea cuyo precio en pesos supera `SOSPECHOSA_FACTOR` × costo estándar
 * (y × las demás compras del producto) se lista aparte para corregirla en Odoo, y si
 * está en moneda extranjera se valoriza a costo estándar.
 */

const CACHE_TTL_MS = 10 * 60 * 1000;
const MESES_PROMEDIO = 3;
const MESES_REPORTE = 12;
const MESES_DETALLE = 6;
const SOSPECHOSA_FACTOR = 20;

export interface AlertaRow {
  productId: number;
  nombre: string;
  categoria: string;
  uom: string;
  proveedor: string | null;
  /** `delay` del proveedor principal; null si no está cargado (0 o 1 día, que es lo que hay en la mayoría). */
  plazoDias: number | null;
  /** Cantidad mínima de compra del proveedor principal (0 = sin mínimo). */
  minCompra: number;
  disponible: number;
  entrante: number;
  minimo: number;
  maximo: number;
  costo: number;
  /** Consumo de los últimos `MESES_DETALLE` meses cerrados (mismo orden que `mesesDetalle`). */
  consumoMensual: number[];
  consumoDiario: number;
  /** null si no hubo consumo en los últimos 3 meses. Puede ser negativo (ya debajo del mínimo). */
  diasCobertura: number | null;
}

export interface SerieMensual {
  pronostico: number[];
  consumo: number[];
  compras: number[];
}

export interface LineaSospechosa {
  mes: string;
  orden: string;
  proveedor: string;
  producto: string;
  moneda: string;
  cantidad: number;
  precioUnitario: number;
  importeOdoo: number;
  importeCorregido: number;
  /** true = moneda extranjera con precio en pesos → el reporte usa cantidad × costo estándar. false = en pesos, probablemente unidad mal cargada → el reporte usa el importe de Odoo. */
  corregida: boolean;
}

export interface PronosticoResult {
  hoy: string;
  /** Meses cerrados del detalle de consumo por insumo (oldest first). */
  mesesDetalle: string[];
  /** Meses cerrados del reporte (oldest first). */
  meses: string[];
  alertas: AlertaRow[];
  total: SerieMensual;
  categorias: ({ categoria: string } & SerieMensual)[];
  lineasSospechosas: LineaSospechosa[];
  categoriasAlertas: string[];
}

type ProductRow = {
  id: number;
  name: string;
  qty_available: number;
  incoming_qty: number;
  standard_price: number;
  categ_id: [number, string];
  uom_id: [number, string];
  seller_ids: number[];
  active: boolean;
};

type GroupRow = OdooReadGroupResult & {
  product_id: [number, string] | false;
  product_qty: number;
  __range?: Record<string, { from: string | false; to: string | false }>;
};

function cleanCategoria(name: string): string {
  return name.replace(/^Materia Prima \/ /, '');
}

function diasDelMes(monthKey: string): number {
  const { start, endExclusive } = monthBounds(monthKey);
  return (Date.parse(`${endExclusive}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000;
}

/** Consumo de materia prima en órdenes de fabricación, por producto y mes (cantidad en UdM del producto). */
async function consumoPorProductoYMes(companyId: number, start: string, endExclusive: string): Promise<Map<number, Map<string, number>>> {
  const groups = (await readGroup({
    model: 'stock.move',
    domain: [
      ['raw_material_production_id', '!=', false],
      ['raw_material_production_id.company_id', '=', companyId],
      ['state', '=', 'done'],
      ['product_id.categ_id', 'child_of', MATERIA_PRIMA_CATEG_ID],
      ['date', '>=', start],
      // Excluye movimientos con fecha placeholder a futuro (año 2100) — ver raw-material-consumption.ts.
      ['date', '<', endExclusive],
    ],
    fields: ['product_qty'],
    groupBy: ['product_id', 'date:month'],
    lazy: false,
  })) as GroupRow[];
  const map = new Map<number, Map<string, number>>();
  for (const g of groups) {
    const from = g.__range?.['date:month']?.from;
    if (!g.product_id || !from) continue;
    if (!map.has(g.product_id[0])) map.set(g.product_id[0], new Map());
    map.get(g.product_id[0])!.set(from.slice(0, 7), g.product_qty);
  }
  return map;
}

interface CompraLinea {
  productId: number;
  mes: string;
  importe: number;
  sospechosa: LineaSospechosa | null;
}

async function comprasPorLinea(companyId: number, start: string, endExclusive: string, costoPorProducto: Map<number, number>): Promise<CompraLinea[]> {
  type Line = {
    order_id: [number, string];
    product_id: [number, string];
    price_subtotal: number;
    price_unit: number;
    product_qty: number;
    product_uom_qty: number;
    currency_id: [number, string];
  };
  const lines = await searchReadAll<Line>({
    model: 'purchase.order.line',
    domain: [
      ['order_id.state', 'in', ['purchase', 'done']],
      ['order_id.company_id', '=', companyId],
      ['order_id.date_approve', '>=', `${start} 00:00:00`],
      ['order_id.date_approve', '<', `${endExclusive} 00:00:00`],
      ['display_type', '=', false],
      ['product_id.categ_id', 'child_of', MATERIA_PRIMA_CATEG_ID],
    ],
    fields: ['order_id', 'product_id', 'price_subtotal', 'price_unit', 'product_qty', 'product_uom_qty', 'currency_id'],
  });
  const orderIds = [...new Set(lines.map((l) => l.order_id[0]))];
  const orders = orderIds.length
    ? await searchReadAll<{ id: number; currency_rate: number; date_approve: string | false; partner_id: [number, string] }>({
        model: 'purchase.order',
        domain: [['id', 'in', orderIds]],
        fields: ['currency_rate', 'date_approve', 'partner_id'],
      })
    : [];
  const orderById = new Map(orders.map((o) => [o.id, o]));

  const conImporte = lines.flatMap((l) => {
    const order = orderById.get(l.order_id[0]);
    if (!order || !order.date_approve) return [];
    // `currency_rate` = unidades de moneda de la orden por 1 ARS → para pasar a pesos se divide.
    const rate = order.currency_rate > 0 ? order.currency_rate : 1;
    const importe = l.price_subtotal / rate;
    return [{ l, order, mes: order.date_approve.slice(0, 7), importe, unitario: l.product_uom_qty > 0 ? importe / l.product_uom_qty : 0 }];
  });
  const unitariosPorProducto = new Map<number, number[]>();
  for (const x of conImporte) unitariosPorProducto.set(x.l.product_id[0], [...(unitariosPorProducto.get(x.l.product_id[0]) ?? []), x.unitario]);
  const mediana = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)] ?? 0;

  const out: CompraLinea[] = [];
  for (const { l, order, mes, importe, unitario } of conImporte) {
    const costo = costoPorProducto.get(l.product_id[0]) ?? 0;
    // Hace falta que también sea desproporcionada contra las demás compras del producto: si todas
    // pagan lo mismo, el que está mal es el costo estándar, no la compra.
    const otras = (unitariosPorProducto.get(l.product_id[0]) ?? []).filter((u) => u !== unitario);
    const caraVsOtras = otras.length === 0 || unitario > SOSPECHOSA_FACTOR * mediana(otras);
    if (costo > 0 && unitario > SOSPECHOSA_FACTOR * costo && caraVsOtras) {
      // Solo se corrige el importe en órdenes en moneda extranjera (precio en pesos cargado en una orden en USD).
      // En pesos el importe suele estar bien y lo mal cargado es la unidad — confirmado en vivo: HILO VAHE POLI 80
      // BLANCO comprado como "120 m" a $15.221 = precio por bobina de 20.000 m.
      const corregida = l.currency_id[1] !== 'ARS';
      const corregido = corregida ? l.product_uom_qty * costo : importe;
      out.push({
        productId: l.product_id[0],
        mes,
        importe: corregido,
        sospechosa: {
          mes,
          orden: l.order_id[1],
          proveedor: order.partner_id[1],
          producto: l.product_id[1],
          moneda: l.currency_id[1],
          cantidad: l.product_qty,
          precioUnitario: l.price_unit,
          importeOdoo: importe,
          importeCorregido: corregido,
          corregida,
        },
      });
    } else {
      out.push({ productId: l.product_id[0], mes, importe, sospechosa: null });
    }
  }
  return out;
}

async function fetchPronostico(): Promise<PronosticoResult> {
  const { companyId } = await getFronteraCompany();
  const hoy = getArgentinaTodayIso();
  const today = new Date(`${hoy}T00:00:00Z`);
  const previousMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
  // 12 meses de reporte + los 3 anteriores al primero, que alimentan su pronóstico.
  const mesesConsumo = lastMonthKeys(MESES_REPORTE + MESES_PROMEDIO, previousMonth);
  const meses = mesesConsumo.slice(MESES_PROMEDIO);
  const mesesDetalle = mesesConsumo.slice(-MESES_DETALLE);
  const mesesPromedio = mesesConsumo.slice(-MESES_PROMEDIO);
  const start = monthBounds(mesesConsumo[0]!).start;
  const endExclusive = monthBounds(mesesConsumo[mesesConsumo.length - 1]!).endExclusive;

  const [productos, orderpoints, consumo] = await Promise.all([
    // Incluye archivados: su consumo y sus compras cuentan en el reporte, pero no generan avisos.
    searchReadAll<ProductRow>({
      model: 'product.product',
      domain: [['categ_id', 'child_of', MATERIA_PRIMA_CATEG_ID]],
      fields: ['name', 'qty_available', 'incoming_qty', 'standard_price', 'categ_id', 'uom_id', 'seller_ids', 'active'],
      order: 'name asc',
      context: { active_test: false },
    }),
    searchReadAll<{ product_id: [number, string]; product_min_qty: number; product_max_qty: number }>({
      model: 'stock.warehouse.orderpoint',
      domain: [['product_id.categ_id', 'child_of', MATERIA_PRIMA_CATEG_ID]],
      fields: ['product_id', 'product_min_qty', 'product_max_qty'],
    }),
    consumoPorProductoYMes(companyId, start, endExclusive),
  ]);

  const productoById = new Map(productos.map((p) => [p.id, p]));
  const costoPorProducto = new Map(productos.map((p) => [p.id, p.standard_price]));
  const compras = await comprasPorLinea(companyId, monthBounds(meses[0]!).start, endExclusive, costoPorProducto);

  // Proveedor principal = el primero de seller_ids (Odoo los devuelve ordenados por `sequence`).
  const activos = productos.filter((p) => p.active);
  const sellerIds = [...new Set(activos.flatMap((p) => p.seller_ids.slice(0, 1)))];
  const sellers = sellerIds.length
    ? await searchReadAll<{ id: number; partner_id: [number, string]; delay: number; min_qty: number }>({
        model: 'product.supplierinfo',
        domain: [['id', 'in', sellerIds]],
        fields: ['partner_id', 'delay', 'min_qty'],
      })
    : [];
  const sellerById = new Map(sellers.map((s) => [s.id, s]));

  // Una regla por producto en la práctica; si hubiera varias (varios depósitos) se suman.
  const reglas = new Map<number, { minimo: number; maximo: number }>();
  for (const o of orderpoints) {
    const r = reglas.get(o.product_id[0]) ?? { minimo: 0, maximo: 0 };
    r.minimo += o.product_min_qty;
    r.maximo += o.product_max_qty;
    reglas.set(o.product_id[0], r);
  }

  // ------------------------------------------------------------------ avisos
  const diasPromedio = mesesPromedio.reduce((s, m) => s + diasDelMes(m), 0);
  const alertas: AlertaRow[] = [];
  for (const p of activos) {
    const porMes = consumo.get(p.id);
    const regla = reglas.get(p.id) ?? { minimo: 0, maximo: 0 };
    const consumoMensual = mesesDetalle.map((m) => porMes?.get(m) ?? 0);
    const consumoDiario = mesesPromedio.reduce((s, m) => s + (porMes?.get(m) ?? 0), 0) / diasPromedio;
    // Sin consumo reciente ni mínimo cargado no hay nada que avisar.
    if (consumoDiario <= 0 && regla.minimo <= 0) continue;
    const seller = p.seller_ids[0] !== undefined ? sellerById.get(p.seller_ids[0]) : undefined;
    alertas.push({
      productId: p.id,
      nombre: p.name,
      categoria: cleanCategoria(p.categ_id[1]),
      uom: p.uom_id[1],
      proveedor: seller?.partner_id[1] ?? null,
      plazoDias: seller && seller.delay > 1 ? seller.delay : null,
      minCompra: seller?.min_qty ?? 0,
      disponible: p.qty_available,
      entrante: p.incoming_qty,
      minimo: regla.minimo,
      maximo: regla.maximo,
      costo: p.standard_price,
      consumoMensual,
      consumoDiario,
      diasCobertura: consumoDiario > 0 ? (p.qty_available + p.incoming_qty - regla.minimo) / consumoDiario : null,
    });
  }

  // ------------------------------------------------------------------ reporte mensual
  const nuevaSerie = (): SerieMensual => ({
    pronostico: new Array<number>(meses.length).fill(0),
    consumo: new Array<number>(meses.length).fill(0),
    compras: new Array<number>(meses.length).fill(0),
  });
  const total = nuevaSerie();
  const porCategoria = new Map<string, SerieMensual>();
  const serieDe = (productId: number): SerieMensual | null => {
    const p = productoById.get(productId);
    if (!p) return null;
    const cat = cleanCategoria(p.categ_id[1]);
    if (!porCategoria.has(cat)) porCategoria.set(cat, nuevaSerie());
    return porCategoria.get(cat)!;
  };

  for (const [productId, porMes] of consumo) {
    const serie = serieDe(productId);
    if (!serie) continue;
    const costo = costoPorProducto.get(productId) ?? 0;
    meses.forEach((m, i) => {
      const k = i + MESES_PROMEDIO; // índice de m dentro de mesesConsumo
      const previo = mesesConsumo.slice(k - MESES_PROMEDIO, k).reduce((s, mm) => s + (porMes.get(mm) ?? 0), 0) / MESES_PROMEDIO;
      const real = porMes.get(m) ?? 0;
      serie.pronostico[i]! += previo * costo;
      serie.consumo[i]! += real * costo;
      total.pronostico[i]! += previo * costo;
      total.consumo[i]! += real * costo;
    });
  }

  const lineasSospechosas: LineaSospechosa[] = [];
  for (const c of compras) {
    if (c.sospechosa) lineasSospechosas.push(c.sospechosa);
    const i = meses.indexOf(c.mes);
    const serie = serieDe(c.productId);
    if (i < 0 || !serie) continue;
    serie.compras[i]! += c.importe;
    total.compras[i]! += c.importe;
  }
  lineasSospechosas.sort((a, b) => b.importeOdoo - a.importeOdoo);

  const categorias = [...porCategoria.entries()]
    .map(([categoria, s]) => ({ categoria, ...s }))
    .filter((c) => c.consumo.some((v) => v !== 0) || c.compras.some((v) => v !== 0))
    .sort((a, b) => b.consumo.reduce((s, v) => s + v, 0) - a.consumo.reduce((s, v) => s + v, 0));

  return {
    hoy,
    mesesDetalle,
    meses,
    alertas,
    total,
    categorias,
    lineasSospechosas,
    categoriasAlertas: [...new Set(alertas.map((a) => a.categoria))].sort(),
  };
}

export async function getPronosticoCompras(): Promise<PronosticoResult> {
  return withTtlCache(`pronostico-compras:v3:${getArgentinaTodayIso()}`, CACHE_TTL_MS, fetchPronostico);
}
