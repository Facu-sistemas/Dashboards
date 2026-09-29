import { searchRead, searchReadAll } from './client';
import { getFronteraCompany } from './reference';
import { withTtlCache } from '../cache';
import type { OdooDomain } from './types';

/**
 * Read-only trace of one real sale order through the factory: sale order →
 * warehouse pickings (WH/PICK, WH/OUT) and/or manufacturing orders
 * (WH/MO, which can themselves fan out into sub-assembly MOs) → invoice →
 * any credit note that already reversed it. Built entirely from
 * `search_read` (see reglas-agente-odoo.md #4 and client.ts's own
 * "no create/write" contract) — this never touches Odoo, it only narrates
 * what already happened to a real order picked by the user.
 *
 * The "¿y si vuelve por devolución?" branch is deliberately NOT modeled
 * here as a live query: a genuine return flow (stock.picking return +
 * credit note) is rare enough in this Odoo that most orders won't have
 * one. The frontend renders that branch as a hypothetical/explanatory
 * step instead, based on the real credit notes this module DOES surface
 * when they exist.
 */

const MAX_MO_DEPTH = 4;
const MAX_BOM_DEPTH = 4;

export interface FlujoProductOption {
  id: number;
  name: string;
}

export interface FlujoOrderOption {
  id: number;
  name: string;
  partnerName: string;
  dateOrder: string;
  qty: number;
  state: string;
}

export interface FlujoStockMove {
  productName: string;
  qty: number;
  state: string;
}

export interface FlujoPicking {
  id: number;
  name: string;
  typeName: string;
  state: string;
  origin: string | null;
  locationFrom: string;
  locationTo: string;
  dateDone: string | null;
  moves: FlujoStockMove[];
}

export interface FlujoManufacturingOrder {
  id: number;
  name: string;
  productName: string;
  qty: number;
  state: string;
  dateFinished: string | null;
  children: FlujoManufacturingOrder[];
}

export interface FlujoInvoice {
  id: number;
  name: string;
  kind: 'invoice' | 'credit_note';
  state: string;
  amountTotal: number;
  invoiceDate: string | null;
  paymentState: string;
  /** Set on a credit note: the invoice name it reverses. */
  reversesInvoiceName: string | null;
}

export interface FlujoOrderLine {
  productName: string;
  qty: number;
  qtyDelivered: number;
  qtyInvoiced: number;
  priceUnit: number;
}

export interface FlujoTrace {
  order: {
    id: number;
    name: string;
    partnerName: string;
    dateOrder: string;
    amountTotal: number;
    state: string;
    lines: FlujoOrderLine[];
  };
  pickings: FlujoPicking[];
  manufacturingOrders: FlujoManufacturingOrder[];
  invoices: FlujoInvoice[];
}

/** One node of a product's bill of materials (`mrp.bom`), expanded recursively — the hypothetical mirror of `FlujoManufacturingOrder` for a product with no real order to trace yet. */
export interface FlujoBomNode {
  productName: string;
  qty: number;
  children: FlujoBomNode[];
}

export interface FlujoSimulation {
  product: { id: number; name: string; listPrice: number };
  /** Whether the product has a BOM at all — if not, it would ship straight from stock with no WH/MO branch. */
  hasBom: boolean;
  bomTree: FlujoBomNode[];
}

/** Sellable products (`product.product`, matches what `sale.order.line.product_id` points to) by name, for the product picker. */
export async function searchFlujoProducts(query: string | undefined, limit: number): Promise<FlujoProductOption[]> {
  const { companyId } = await getFronteraCompany();
  const domain: OdooDomain = [
    ['sale_ok', '=', true],
    ['company_id', 'in', [companyId, false]],
  ];
  if (query && query.trim()) domain.push(['name', 'ilike', query.trim()]);

  type Row = { id: number; name: string };
  const rows = await searchRead<Row>({ model: 'product.product', domain, fields: ['name'], limit, order: 'name asc' });
  return rows.map((r) => ({ id: r.id, name: r.name }));
}

/** Most recent real, confirmed sale orders that include this product — candidates for the user to trace. */
export async function findFlujoOrdersForProduct(productId: number, limit: number): Promise<FlujoOrderOption[]> {
  type LineRow = { order_id: [number, string]; product_uom_qty: number };
  const lines = await searchRead<LineRow>({
    model: 'sale.order.line',
    domain: [
      ['product_id', '=', productId],
      ['order_id.state', 'in', ['sale', 'done']],
    ],
    fields: ['order_id', 'product_uom_qty'],
    order: 'id desc',
    limit: limit * 4, // headroom for orders with several lines of the same product
  });
  if (lines.length === 0) return [];

  const qtyByOrder = new Map<number, number>();
  const orderedIds: number[] = [];
  for (const l of lines) {
    const [orderId] = l.order_id;
    if (!qtyByOrder.has(orderId)) orderedIds.push(orderId);
    qtyByOrder.set(orderId, (qtyByOrder.get(orderId) ?? 0) + l.product_uom_qty);
    if (orderedIds.length >= limit) break;
  }

  type OrderRow = { id: number; name: string; partner_id: [number, string]; date_order: string; state: string };
  const orders = await searchRead<OrderRow>({
    model: 'sale.order',
    domain: [['id', 'in', orderedIds]],
    fields: ['name', 'partner_id', 'date_order', 'state'],
  });
  const orderById = new Map(orders.map((o) => [o.id, o]));

  return orderedIds
    .map((id) => orderById.get(id))
    .filter((o): o is OrderRow => o !== undefined)
    .map((o) => ({
      id: o.id,
      name: o.name,
      partnerName: o.partner_id ? o.partner_id[1] : '—',
      dateOrder: o.date_order,
      qty: qtyByOrder.get(o.id) ?? 0,
      state: o.state,
    }));
}

async function fetchPickings(pickingIds: number[]): Promise<FlujoPicking[]> {
  if (pickingIds.length === 0) return [];

  type PickingRow = {
    id: number;
    name: string;
    picking_type_id: [number, string];
    state: string;
    origin: string | false;
    location_id: [number, string];
    location_dest_id: [number, string];
    date_done: string | false;
    move_ids: number[];
  };
  const pickings = await searchRead<PickingRow>({
    model: 'stock.picking',
    domain: [['id', 'in', pickingIds]],
    fields: ['name', 'picking_type_id', 'state', 'origin', 'location_id', 'location_dest_id', 'date_done', 'move_ids'],
    order: 'id asc',
  });

  const allMoveIds = pickings.flatMap((p) => p.move_ids);
  type MoveRow = { id: number; picking_id: [number, string]; product_id: [number, string]; product_uom_qty: number; state: string };
  const moves =
    allMoveIds.length > 0
      ? await searchReadAll<MoveRow>({
          model: 'stock.move',
          domain: [['id', 'in', allMoveIds]],
          fields: ['picking_id', 'product_id', 'product_uom_qty', 'state'],
        })
      : [];
  const movesByPicking = new Map<number, FlujoStockMove[]>();
  for (const m of moves) {
    const pickingId = m.picking_id[0];
    const list = movesByPicking.get(pickingId) ?? [];
    list.push({ productName: m.product_id[1], qty: m.product_uom_qty, state: m.state });
    movesByPicking.set(pickingId, list);
  }

  return pickings.map((p) => ({
    id: p.id,
    name: p.name,
    typeName: p.picking_type_id[1],
    state: p.state,
    origin: p.origin || null,
    locationFrom: p.location_id[1],
    locationTo: p.location_dest_id[1],
    dateDone: p.date_done || null,
    moves: movesByPicking.get(p.id) ?? [],
  }));
}

type MoRow = { id: number; name: string; origin: string | false; product_id: [number, string]; product_qty: number; state: string; date_finished: string | false };

/** Depth-limited fan-out: an MO's `origin` names its parent (the sale order, or a parent MO for a sub-assembly). */
async function fetchManufacturingTree(orderName: string): Promise<FlujoManufacturingOrder[]> {
  async function fetchLevel(originNames: string[]): Promise<MoRow[]> {
    if (originNames.length === 0) return [];
    return searchReadAll<MoRow>({
      model: 'mrp.production',
      domain: [['origin', 'in', originNames]],
      fields: ['name', 'origin', 'product_id', 'product_qty', 'state', 'date_finished'],
    });
  }

  const levels: MoRow[][] = [];
  let currentNames = [orderName];
  for (let depth = 0; depth < MAX_MO_DEPTH; depth++) {
    const level = await fetchLevel(currentNames);
    if (level.length === 0) break;
    levels.push(level);
    currentNames = level.map((r) => r.name);
  }

  function toNode(r: MoRow, byParentName: Map<string, MoRow[]>): FlujoManufacturingOrder {
    const children = (byParentName.get(r.name) ?? []).map((c) => toNode(c, byParentName));
    return {
      id: r.id,
      name: r.name,
      productName: r.product_id[1],
      qty: r.product_qty,
      state: r.state,
      dateFinished: r.date_finished || null,
      children,
    };
  }

  // Build parent-name -> children lookup across every fetched level in one pass.
  const byParentName = new Map<string, MoRow[]>();
  for (const level of levels) {
    for (const r of level) {
      if (!r.origin) continue;
      const list = byParentName.get(r.origin) ?? [];
      list.push(r);
      byParentName.set(r.origin, list);
    }
  }

  const topLevel = levels[0] ?? [];
  return topLevel.map((r) => toNode(r, byParentName));
}

async function fetchInvoices(invoiceIds: number[]): Promise<FlujoInvoice[]> {
  if (invoiceIds.length === 0) return [];

  type MoveRow = {
    id: number;
    name: string;
    state: string;
    move_type: string;
    amount_total: number;
    invoice_date: string | false;
    payment_state: string;
    reversed_entry_id: [number, string] | false;
  };
  const fields = ['name', 'state', 'move_type', 'amount_total', 'invoice_date', 'payment_state', 'reversed_entry_id'];

  // `invoice_ids` on the sale order already includes any credit note issued
  // against it (Odoo doesn't split those into a separate field) — fetch
  // both sets and dedupe by id instead of assuming `invoice_ids` rows are
  // all real invoices (`move_type` is what actually says invoice vs.
  // refund, not which query found the row).
  const [byId, byReversal] = await Promise.all([
    searchRead<MoveRow>({ model: 'account.move', domain: [['id', 'in', invoiceIds]], fields }),
    searchRead<MoveRow>({ model: 'account.move', domain: [['reversed_entry_id', 'in', invoiceIds]], fields }),
  ]);

  const byMoveId = new Map<number, MoveRow>();
  for (const m of [...byId, ...byReversal]) byMoveId.set(m.id, m);

  return [...byMoveId.values()].map((m) => ({
    id: m.id,
    name: m.name,
    kind: m.move_type === 'out_refund' ? 'credit_note' : 'invoice',
    state: m.state,
    amountTotal: m.amount_total,
    invoiceDate: m.invoice_date || null,
    paymentState: m.payment_state,
    reversesInvoiceName: m.reversed_entry_id ? m.reversed_entry_id[1] : null,
  }));
}

/** Full real trace for one sale order id — everything the "Flujo" tab renders. */
export async function getFlujoTrace(orderId: number): Promise<FlujoTrace> {
  type OrderRow = {
    id: number;
    name: string;
    partner_id: [number, string];
    date_order: string;
    amount_total: number;
    state: string;
    invoice_ids: number[];
    picking_ids: number[];
    order_line: number[];
  };
  const orders = await searchRead<OrderRow>({
    model: 'sale.order',
    domain: [['id', '=', orderId]],
    fields: ['name', 'partner_id', 'date_order', 'amount_total', 'state', 'invoice_ids', 'picking_ids', 'order_line'],
  });
  const order = orders[0];
  if (!order) throw new Error(`Sale order ${orderId} not found`);

  type LineRow = { product_id: [number, string]; product_uom_qty: number; qty_delivered: number; qty_invoiced: number; price_unit: number };
  const [lines, pickings, manufacturingOrders, invoices] = await Promise.all([
    order.order_line.length > 0
      ? searchRead<LineRow>({
          model: 'sale.order.line',
          domain: [['id', 'in', order.order_line]],
          fields: ['product_id', 'product_uom_qty', 'qty_delivered', 'qty_invoiced', 'price_unit'],
        })
      : Promise.resolve<LineRow[]>([]),
    fetchPickings(order.picking_ids),
    fetchManufacturingTree(order.name),
    fetchInvoices(order.invoice_ids),
  ]);

  return {
    order: {
      id: order.id,
      name: order.name,
      partnerName: order.partner_id ? order.partner_id[1] : '—',
      dateOrder: order.date_order,
      amountTotal: order.amount_total,
      state: order.state,
      lines: lines.map((l) => ({
        productName: l.product_id[1],
        qty: l.product_uom_qty,
        qtyDelivered: l.qty_delivered,
        qtyInvoiced: l.qty_invoiced,
        priceUnit: l.price_unit,
      })),
    },
    pickings,
    manufacturingOrders,
    invoices,
  };
}

type ProductInfo = { id: number; name: string; templateId: number };
type BomChild = { productId: number; name: string; qty: number };

const REFERENCE_TTL_MS = 60 * 60 * 1000;

/**
 * Odoo's own routing decides whether a BOM component becomes its OWN
 * `WH/MO` or is just consumed as a raw input inside its parent's MO —
 * confirmed live: components on the "Fabricación" (manufacture) route
 * fan out into further MOs (e.g. a mattress top's foam/fabric/cover), but
 * a chemical or hardware input on a "Comprar" (buy) route never does, even
 * when it happens to have its own costing BOM. Without this gate, walking
 * every BOM line recursively explodes into raw chemistry (TDI, VORANOL…)
 * dozens of levels deep — nothing like what Odoo actually produces.
 */
async function getManufactureRouteId(): Promise<number | null> {
  return withTtlCache('ref:route:fabricacion', REFERENCE_TTL_MS, async () => {
    const rows = await searchRead<{ id: number }>({
      model: 'stock.route',
      domain: [['name', 'ilike', 'Fabrica']],
      fields: [],
      limit: 1,
    });
    return rows[0]?.id ?? null;
  });
}

async function templateIdsOnManufactureRoute(templateIds: number[]): Promise<Set<number>> {
  if (templateIds.length === 0) return new Set();
  const routeId = await getManufactureRouteId();
  if (routeId === null) return new Set();
  const rows = await searchRead<{ id: number }>({
    model: 'product.template',
    domain: [
      ['id', 'in', templateIds],
      ['route_ids', 'in', [routeId]],
    ],
    fields: [],
  });
  return new Set(rows.map((r) => r.id));
}

async function fetchProductInfos(ids: number[]): Promise<Map<number, ProductInfo>> {
  if (ids.length === 0) return new Map();
  type Row = { id: number; name: string; product_tmpl_id: [number, string] };
  const rows = await searchRead<Row>({ model: 'product.product', domain: [['id', 'in', ids]], fields: ['name', 'product_tmpl_id'] });
  return new Map(rows.map((r) => [r.id, { id: r.id, name: r.name, templateId: r.product_tmpl_id[0] }]));
}

/** First BOM per template (a template can have more than one, e.g. by variant — the general one is enough for this illustration) and its component lines. */
async function fetchBomChildrenByTemplate(templateIds: number[]): Promise<Map<number, BomChild[]>> {
  if (templateIds.length === 0) return new Map();

  type BomRow = { id: number; product_tmpl_id: [number, string]; bom_line_ids: number[] };
  const boms = await searchReadAll<BomRow>({
    model: 'mrp.bom',
    domain: [['product_tmpl_id', 'in', templateIds]],
    fields: ['product_tmpl_id', 'bom_line_ids'],
  });
  const bomByTemplate = new Map<number, BomRow>();
  for (const b of boms) {
    if (!bomByTemplate.has(b.product_tmpl_id[0])) bomByTemplate.set(b.product_tmpl_id[0], b);
  }

  const allLineIds = [...bomByTemplate.values()].flatMap((b) => b.bom_line_ids);
  if (allLineIds.length === 0) return new Map();

  type LineRow = { id: number; product_id: [number, string]; product_qty: number };
  const lines = await searchReadAll<LineRow>({ model: 'mrp.bom.line', domain: [['id', 'in', allLineIds]], fields: ['product_id', 'product_qty'] });
  const lineById = new Map(lines.map((l) => [l.id, l]));

  const result = new Map<number, BomChild[]>();
  for (const [templateId, bom] of bomByTemplate) {
    const children = bom.bom_line_ids
      .map((id) => lineById.get(id))
      .filter((l): l is LineRow => l !== undefined)
      .map((l) => ({ productId: l.product_id[0], name: l.product_id[1], qty: l.product_qty }));
    result.set(templateId, children);
  }
  return result;
}

/**
 * Depth-limited BOM expansion, level by level (same shape as
 * `fetchManufacturingTree` but walking `mrp.bom` instead of real
 * `mrp.production` records) — only descends into a component when it's
 * itself on the manufacture route (see `templateIdsOnManufactureRoute`);
 * anything else (raw materials, bought hardware) is shown as a leaf.
 */
async function buildBomTree(rootProductId: number): Promise<{ hasBom: boolean; children: FlujoBomNode[] }> {
  const childrenByProduct = new Map<number, BomChild[]>();
  let frontier = [rootProductId];
  let hasBom = false;

  for (let depth = 0; depth < MAX_BOM_DEPTH && frontier.length > 0; depth++) {
    const infos = await fetchProductInfos(frontier);
    const templateIds = [...new Set(frontier.map((id) => infos.get(id)?.templateId).filter((t): t is number => t !== undefined))];
    const [bomChildrenByTemplate, manufacturedTemplateIds] = await Promise.all([
      fetchBomChildrenByTemplate(templateIds),
      templateIdsOnManufactureRoute(templateIds),
    ]);

    const nextFrontier: number[] = [];
    for (const productId of frontier) {
      const info = infos.get(productId);
      if (!info) continue;
      // The root is always expanded once so its own components show —
      // everything past that only fans out further if IT would also get
      // its own WH/MO in Odoo.
      const eligible = productId === rootProductId || manufacturedTemplateIds.has(info.templateId);
      const children = eligible ? (bomChildrenByTemplate.get(info.templateId) ?? []) : [];
      if (productId === rootProductId && children.length > 0) hasBom = true;
      childrenByProduct.set(productId, children);
      for (const c of children) nextFrontier.push(c.productId);
    }
    frontier = nextFrontier;
  }

  function toNode(c: BomChild): FlujoBomNode {
    const kids = childrenByProduct.get(c.productId) ?? [];
    return { productName: c.name, qty: c.qty, children: kids.map(toNode) };
  }

  const topLevel = childrenByProduct.get(rootProductId) ?? [];
  return { hasBom, children: topLevel.map(toNode) };
}

/**
 * Hypothetical trace for a product with no real order picked — what WOULD
 * happen based on the product's own real BOM, for the "simular sin orden
 * real" path. Still read-only: this expands `mrp.bom`, an existing
 * definition, it doesn't create anything.
 */
export async function getFlujoSimulation(productId: number): Promise<FlujoSimulation> {
  type Row = { id: number; name: string; lst_price: number };
  const rows = await searchRead<Row>({ model: 'product.product', domain: [['id', '=', productId]], fields: ['name', 'lst_price'] });
  const row = rows[0];
  if (!row) throw new Error(`Product ${productId} not found`);

  const { hasBom, children } = await buildBomTree(productId);
  return { product: { id: row.id, name: row.name, listPrice: row.lst_price }, hasBom, bomTree: children };
}
