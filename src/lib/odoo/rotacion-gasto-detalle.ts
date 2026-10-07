import { readGroup, searchReadAll } from './client';
import { withTtlCache } from '../cache';
import { monthBounds } from '../date';
import { getArgentinaTodayIso } from './oee';
import { MATERIA_PRIMA_CATEG_ID } from './raw-material-consumption';
import { inBatches, MP_DOMAIN, resolverEmpresas } from './rotacion-gasto';
import type { OdooReadGroupResult } from './types';

/**
 * Detalle por producto para exportar a Excel (solo lectura). Cada fila lleva
 * el ID del producto y su "Nombre en pantalla" (`display_name`, leído en
 * es_AR por `client.ts`, igual que la exportación de Base de datos), para
 * poder vincular con otros archivos sin depender de coincidencias de texto.
 */

const CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_PARALLEL = 4;

export interface GastoLinea {
  producto: string;
  productId: number;
  nombrePantalla: string;
  refInterna: string;
  fecha: string;
  cantidad: number;
  importe: number;
  proveedor: string;
  comprobante: string;
  /** Ruta completa, ej. "Materia Prima / Bases" (`categ_id.complete_name`). */
  categoria: string;
}

export interface OcPendienteLinea {
  productId: number;
  nombrePantalla: string;
  categoria: string;
  orden: string;
  proveedor: string;
  fechaOrden: string;
  fechaPrevista: string;
  /** Cantidades en la unidad del producto (la del stock), no en la unidad de compra. */
  pedida: number;
  recibida: number;
  pendiente: number;
  precioUnitario: number;
  moneda: string;
}

export interface StockProductoRow {
  codigo: string;
  productId: number;
  producto: string;
  nombrePantalla: string;
  categoria: string;
  unidad: string;
  /** Un {cantidad, valor} por corte de `StockDetalleResult.cortes`. */
  cortes: { cantidad: number; valor: number }[];
}

export interface StockDetalleResult {
  /** Etiqueta de cada corte, ej. "31-dic-2025". */
  cortes: string[];
  productos: StockProductoRow[];
}

type ProductoDetalle = {
  id: number;
  name: string;
  display_name: string;
  default_code: string | false;
  uom_id: [number, string];
  categ_id: [number, string];
};

async function getProductos(soloMp: boolean): Promise<Map<number, ProductoDetalle>> {
  return withTtlCache(`rotacion-gasto-detalle:productos:${soloMp}`, CACHE_TTL_MS, async () => {
    const rows = await searchReadAll<ProductoDetalle>({
      model: 'product.product',
      domain: soloMp ? [['categ_id', 'child_of', MATERIA_PRIMA_CATEG_ID]] : [],
      fields: ['name', 'display_name', 'default_code', 'uom_id', 'categ_id'],
      context: { active_test: false },
    });
    return new Map(rows.map((r) => [r.id, r]));
  });
}

type Uom = { id: number; factor: number; category_id: [number, string] };

async function getUoms(): Promise<Map<number, Uom>> {
  return withTtlCache('rotacion-gasto-detalle:uoms', CACHE_TTL_MS, async () => {
    const rows = await searchReadAll<Uom>({ model: 'uom.uom', domain: [], fields: ['factor', 'category_id'], context: { active_test: false } });
    return new Map(rows.map((r) => [r.id, r]));
  });
}

/** Una fila por línea de factura / nota de crédito de proveedor de materia prima, desde el 1/1 del año. Importe = balance (pesos, con signo). */
export async function getGastoLineas(empresaIds?: number[]): Promise<GastoLinea[]> {
  const { seleccion } = await resolverEmpresas(empresaIds);
  const year = Number(getArgentinaTodayIso().slice(0, 4));
  return withTtlCache(`rotacion-gasto-detalle:gasto:${year}:${seleccion.join(',')}`, CACHE_TTL_MS, async () => {
    type Line = {
      product_id: [number, string];
      date: string;
      quantity: number;
      balance: number;
      product_uom_id: [number, string] | false;
      partner_id: [number, string] | false;
      move_name: string | false;
    };
    const [lines, productos, uoms] = await Promise.all([
      searchReadAll<Line>({
        model: 'account.move.line',
        domain: [
          ['move_id.move_type', 'in', ['in_invoice', 'in_refund']],
          ['parent_state', '=', 'posted'],
          ['company_id', 'in', seleccion],
          ['display_type', '=', 'product'],
          ...MP_DOMAIN,
          ['date', '>=', `${year}-01-01`],
        ],
        fields: ['product_id', 'date', 'quantity', 'balance', 'product_uom_id', 'partner_id', 'move_name'],
        order: 'date asc, id asc',
      }),
      getProductos(true),
      getUoms(),
    ]);

    return lines.map((l) => {
      const p = productos.get(l.product_id[0]);
      const lineUom = l.product_uom_id ? uoms.get(l.product_uom_id[0]) : undefined;
      const prodUom = p ? uoms.get(p.uom_id[0]) : undefined;
      // Misma lógica que _compute_quantity: a la unidad de referencia (÷ factor) y de ahí a la unidad del producto (× factor).
      const convertible = lineUom && prodUom && lineUom.category_id[0] === prodUom.category_id[0] && lineUom.factor > 0;
      const qty = convertible ? (l.quantity / lineUom.factor) * prodUom.factor : l.quantity;
      return {
        producto: p?.name ?? l.product_id[1],
        productId: l.product_id[0],
        nombrePantalla: p?.display_name ?? l.product_id[1],
        refInterna: (p && p.default_code) || '',
        fecha: l.date,
        cantidad: (l.balance >= 0 ? 1 : -1) * Math.abs(qty),
        importe: l.balance,
        proveedor: l.partner_id ? l.partner_id[1] : '',
        comprobante: l.move_name || '',
        categoria: p?.categ_id[1] ?? '',
      };
    });
  });
}

/** Cantidad de la línea pasada a la unidad del producto (misma lógica que _compute_quantity). */
function aUnidadProducto(qty: number, lineUom: Uom | undefined, prodUom: Uom | undefined): number {
  const convertible = lineUom && prodUom && lineUom.category_id[0] === prodUom.category_id[0] && lineUom.factor > 0;
  return convertible ? (qty / lineUom.factor) * prodUom.factor : qty;
}

/** Líneas de órdenes de compra confirmadas de Materia Prima que todavía no se recibieron completas, con su fecha prevista de entrega. */
export async function getOcPendientes(empresaIds?: number[]): Promise<OcPendienteLinea[]> {
  const { seleccion } = await resolverEmpresas(empresaIds);
  return withTtlCache(`rotacion-gasto-detalle:oc-pendientes:${seleccion.join(',')}`, CACHE_TTL_MS, async () => {
    type Line = {
      product_id: [number, string];
      order_id: [number, string];
      product_qty: number;
      qty_received: number;
      product_uom: [number, string];
      date_planned: string | false;
      price_unit: number;
      currency_id: [number, string] | false;
    };
    const [lines, productos, uoms] = await Promise.all([
      searchReadAll<Line>({
        model: 'purchase.order.line',
        domain: [
          ['order_id.state', 'in', ['purchase', 'done']],
          ['order_id.company_id', 'in', seleccion],
          ['display_type', '=', false],
          ...MP_DOMAIN,
        ],
        fields: ['product_id', 'order_id', 'product_qty', 'qty_received', 'product_uom', 'date_planned', 'price_unit', 'currency_id'],
        order: 'date_planned asc, id asc',
      }),
      getProductos(true),
      getUoms(),
    ]);
    const pendientes = lines.filter((l) => l.product_qty - l.qty_received > 0);
    const orderIds = [...new Set(pendientes.map((l) => l.order_id[0]))];
    const orders = orderIds.length
      ? await searchReadAll<{ id: number; partner_id: [number, string]; date_approve: string | false; date_order: string | false }>({
          model: 'purchase.order',
          domain: [['id', 'in', orderIds]],
          fields: ['partner_id', 'date_approve', 'date_order'],
        })
      : [];
    const orderById = new Map(orders.map((o) => [o.id, o]));

    return pendientes.map((l) => {
      const p = productos.get(l.product_id[0]);
      const o = orderById.get(l.order_id[0]);
      const lineUom = uoms.get(l.product_uom[0]);
      const prodUom = p ? uoms.get(p.uom_id[0]) : undefined;
      const conv = (q: number) => aUnidadProducto(q, lineUom, prodUom);
      return {
        productId: l.product_id[0],
        nombrePantalla: p?.display_name ?? l.product_id[1],
        categoria: p?.categ_id[1] ?? '',
        orden: l.order_id[1],
        proveedor: o ? o.partner_id[1] : '',
        fechaOrden: String((o && (o.date_approve || o.date_order)) || '').slice(0, 10),
        fechaPrevista: String(l.date_planned || '').slice(0, 10),
        pedida: conv(l.product_qty),
        recibida: conv(l.qty_received),
        pendiente: conv(l.product_qty - l.qty_received),
        precioUnitario: l.price_unit,
        moneda: l.currency_id ? l.currency_id[1] : '',
      };
    });
  });
}

const MES_ABBR = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

type SvlGroup = OdooReadGroupResult & { product_id: [number, string] | false; quantity: number; value: number };

/** Stock y valor al cierre de dic del año anterior y de cada mes cerrado del año, de todos los productos con movimiento. */
export async function getStockDetalle(empresaIds?: number[]): Promise<StockDetalleResult> {
  const { seleccion } = await resolverEmpresas(empresaIds);
  const today = getArgentinaTodayIso();
  const year = Number(today.slice(0, 4));
  const lastClosed = Number(today.slice(5, 7)) - 1; // el mes en curso no se incluye
  return withTtlCache(`rotacion-gasto-detalle:stock:${today.slice(0, 7)}:${seleccion.join(',')}`, CACHE_TTL_MS, async () => {
    const cortes = [{ label: `31-dic-${year - 1}`, limite: `${year}-01-01` }];
    for (let m = 1; m <= lastClosed; m++) {
      const { endExclusive } = monthBounds(`${year}-${String(m).padStart(2, '0')}`);
      const ultimoDia = new Date(Date.parse(`${endExclusive}T00:00:00Z`) - 86_400_000).getUTCDate();
      cortes.push({ label: `${ultimoDia}-${MES_ABBR[m - 1]}-${year}`, limite: endExclusive });
    }

    const [productos, porCorte] = await Promise.all([
      getProductos(false),
      inBatches(cortes, MAX_PARALLEL, async (c) => {
        const groups = (await readGroup({
          model: 'stock.valuation.layer',
          domain: [['company_id', 'in', seleccion], ['create_date', '<', `${c.limite} 00:00:00`]],
          fields: ['quantity:sum', 'value:sum'],
          groupBy: ['product_id'],
          lazy: false,
        })) as SvlGroup[];
        const map = new Map<number, { cantidad: number; valor: number }>();
        for (const g of groups) if (g.product_id) map.set(g.product_id[0], { cantidad: g.quantity, valor: g.value });
        return map;
      }),
    ]);

    const ids = new Set<number>();
    for (const m of porCorte) for (const id of m.keys()) ids.add(id);
    const rows: StockProductoRow[] = [];
    for (const id of ids) {
      const cortesRow = porCorte.map((m) => m.get(id) ?? { cantidad: 0, valor: 0 });
      // Solo productos con alguna cantidad o valor distinto de cero en algún corte.
      if (!cortesRow.some((c) => c.cantidad || c.valor)) continue;
      const p = productos.get(id);
      rows.push({
        codigo: (p && p.default_code) || '',
        productId: id,
        producto: p?.name ?? `Producto ${id}`,
        nombrePantalla: p?.display_name ?? `Producto ${id}`,
        categoria: p?.categ_id[1] ?? '',
        unidad: p?.uom_id[1] ?? '',
        cortes: cortesRow,
      });
    }
    rows.sort((a, b) => a.nombrePantalla.localeCompare(b.nombrePantalla, 'es'));
    return { cortes: cortes.map((c) => c.label), productos: rows };
  });
}
