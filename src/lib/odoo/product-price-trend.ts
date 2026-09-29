import { searchRead, searchReadAll, searchCount, readGroup } from './client';
import { getListPriceFieldId } from './reference';
import { withTtlCache } from '../cache';
import { monthsBetween, currentMonthKey } from '../date';
import { OdooError } from './types';
import type { OdooDomain, OdooReadGroupResult } from './types';

const PRODUCT_TEMPLATE_MODEL = 'product.template';
const TREND_MONTHS = 12;
// The "which products have any price history" set only grows slowly (a
// product gaining its first tracked change or sale is a rare event) — a
// longer TTL avoids two extra read_group round trips on every keystroke of
// the product search box.
const HISTORY_SET_TTL_MS = 10 * 60 * 1000;

export type PriceSource = 'lista' | 'venta' | 'arrastrado';

export interface ProductPricePoint {
  month: string; // YYYY-MM
  price: number;
  source: PriceSource;
  /** Only set for 'venta' months with more than one quotation: the spread of unit prices quoted that month. */
  min?: number;
  max?: number;
  /** Number of quotation lines behind this month's price (only for 'venta'). */
  count?: number;
}

export interface ProductQuotationDetail {
  orderId: number;
  orderName: string;
  date: string;
  month: string; // YYYY-MM, for client-side filtering by chart bar
  price: number;
  qty: number;
}

export interface ProductPriceTrend {
  productId: number;
  productName: string;
  hasHistory: boolean;
  /** Last up-to-12 months with a value — may be shorter if the product's history started more recently, empty if !hasHistory. */
  points: ProductPricePoint[];
  /** Every quotation line behind the 'venta' points, for the drill-down when a bar is clicked. */
  quotationDetails: ProductQuotationDetail[];
}

export interface SellableProductOption {
  id: number;
  name: string;
  listPrice: number;
}

export interface SellableProductPage {
  items: SellableProductOption[];
  total: number;
}

/** Distinct product.template ids with at least one tracked `list_price` change, via mail.message's `tracking_value_ids` one2many — avoids a second round trip through mail.tracking.value just to read res_id. */
async function getTemplateIdsWithTracking(): Promise<Set<number>> {
  const fieldId = await getListPriceFieldId();
  type Row = OdooReadGroupResult & { res_id: number };
  const groups = (await readGroup({
    model: 'mail.message',
    domain: [
      ['model', '=', PRODUCT_TEMPLATE_MODEL],
      ['tracking_value_ids.field_id', '=', fieldId],
    ],
    fields: [],
    groupBy: ['res_id'],
  })) as Row[];
  return new Set(groups.map((g) => g.res_id));
}

/** Distinct product.template ids with at least one quoted line (any non-cancelled sale.order). */
async function getTemplateIdsWithSales(): Promise<Set<number>> {
  type Row = OdooReadGroupResult & { product_id: [number, string] | false };
  const groups = (await readGroup({
    model: 'sale.order.line',
    domain: [['order_id.state', '!=', 'cancel']],
    fields: [],
    groupBy: ['product_id'],
  })) as Row[];

  const variantIds = groups.filter((g): g is Row & { product_id: [number, string] } => Boolean(g.product_id)).map((g) => g.product_id[0]);
  if (variantIds.length === 0) return new Set();

  type VariantRow = { id: number; product_tmpl_id: [number, string] };
  const variants = await searchReadAll<VariantRow>({
    model: 'product.product',
    domain: [['id', 'in', variantIds]],
    fields: ['product_tmpl_id'],
  });
  return new Set(variants.map((v) => v.product_tmpl_id[0]));
}

/** Every product.template id with ANY price history (tracking or sales) — used to hide products the trend view could only ever show "sin historial disponible" for. */
async function getTemplateIdsWithHistory(): Promise<Set<number>> {
  return withTtlCache('ref:templates-with-price-history', HISTORY_SET_TTL_MS, async () => {
    const [tracked, sold] = await Promise.all([getTemplateIdsWithTracking(), getTemplateIdsWithSales()]);
    return new Set([...tracked, ...sold]);
  });
}

/** Sellable products (`sale_ok = True`) WITH price history, for the picker table — optionally filtered by name. */
export async function searchSellableProducts(
  query: string | undefined,
  limit: number,
  offset: number
): Promise<SellableProductPage> {
  const historyIds = await getTemplateIdsWithHistory();

  const domain: OdooDomain = [
    ['sale_ok', '=', true],
    ['id', 'in', [...historyIds]],
  ];
  if (query && query.trim()) domain.push(['name', 'ilike', query.trim()]);

  type Row = { id: number; name: string; list_price: number };
  const [items, total] = await Promise.all([
    searchRead<Row>({ model: PRODUCT_TEMPLATE_MODEL, domain, fields: ['name', 'list_price'], limit, offset, order: 'name asc' }),
    searchCount(PRODUCT_TEMPLATE_MODEL, domain),
  ]);

  return { items: items.map((r) => ({ id: r.id, name: r.name, listPrice: r.list_price })), total };
}

interface PriceEvent {
  date: string;
  value: number;
}

/** Tracked `list_price` changes on this template, from its message thread (`mail.tracking.value`). */
async function fetchTrackedListPriceEvents(templateId: number): Promise<PriceEvent[]> {
  const fieldId = await getListPriceFieldId();
  type Row = { new_value_float: number; create_date: string };
  const rows = await searchReadAll<Row>({
    model: 'mail.tracking.value',
    domain: [
      ['field_id', '=', fieldId],
      ['mail_message_id.model', '=', PRODUCT_TEMPLATE_MODEL],
      ['mail_message_id.res_id', '=', templateId],
    ],
    fields: ['new_value_float', 'create_date'],
    order: 'create_date asc',
  });
  return rows.map((r) => ({ date: r.create_date, value: r.new_value_float }));
}

/**
 * Quoted unit prices for this template's variants, from `sale.order.line`
 * across every non-cancelled quotation/order (draft, sent, sale, done) —
 * not just confirmed sales. Uses `price_subtotal` (the line's own net
 * subtotal, tax-excluded) divided by quantity, so a surcharge added as its
 * own separate line on the quote (financing, card fee, etc.) never bleeds
 * into this product's price.
 */
interface QuoteLineEvent extends PriceEvent {
  orderId: number;
  orderName: string;
  qty: number;
}

async function fetchQuotationEvents(templateId: number): Promise<QuoteLineEvent[]> {
  type LineRow = { id: number; price_subtotal: number; product_uom_qty: number; order_id: [number, string] };
  const lines = await searchReadAll<LineRow>({
    model: 'sale.order.line',
    domain: [
      ['product_id.product_tmpl_id', '=', templateId],
      ['order_id.state', '!=', 'cancel'],
    ],
    fields: ['price_subtotal', 'product_uom_qty', 'order_id'],
  });
  if (lines.length === 0) return [];

  const orderIds = [...new Set(lines.map((l) => l.order_id[0]))];
  type OrderRow = { id: number; date_order: string };
  const orders = await searchReadAll<OrderRow>({
    model: 'sale.order',
    domain: [['id', 'in', orderIds]],
    fields: ['date_order'],
  });
  const dateByOrderId = new Map(orders.map((o) => [o.id, o.date_order]));

  const events: QuoteLineEvent[] = [];
  for (const l of lines) {
    const date = dateByOrderId.get(l.order_id[0]);
    if (!date) continue;
    const qty = l.product_uom_qty || 1;
    events.push({ date, value: l.price_subtotal / qty, orderId: l.order_id[0], orderName: l.order_id[1], qty });
  }
  return events.sort((a, b) => a.date.localeCompare(b.date));
}

/** Keeps only the latest event per "YYYY-MM" bucket. */
function latestPerMonth(events: PriceEvent[]): Map<string, PriceEvent> {
  const byMonth = new Map<string, PriceEvent>();
  for (const e of events) {
    const month = e.date.slice(0, 7);
    const existing = byMonth.get(month);
    if (!existing || e.date > existing.date) byMonth.set(month, e);
  }
  return byMonth;
}

interface MonthlyQuoteStats {
  avg: number;
  min: number;
  max: number;
  count: number;
}

/** Aggregates every quotation event per "YYYY-MM" bucket — several quotes in the same month land as one point (average) with its min/max spread, instead of only the latest one winning. */
function statsPerMonth(events: PriceEvent[]): Map<string, MonthlyQuoteStats> {
  const byMonth = new Map<string, number[]>();
  for (const e of events) {
    const month = e.date.slice(0, 7);
    const values = byMonth.get(month);
    if (values) values.push(e.value);
    else byMonth.set(month, [e.value]);
  }
  const result = new Map<string, MonthlyQuoteStats>();
  for (const [month, values] of byMonth) {
    const sum = values.reduce((acc, v) => acc + v, 0);
    result.set(month, { avg: sum / values.length, min: Math.min(...values), max: Math.max(...values), count: values.length });
  }
  return result;
}

/**
 * Monthly price series for one product, per plan-tendencia-precios.md's
 * priority: a tracked list-price change that month wins; otherwise the
 * average of that month's quoted prices (any non-cancelled quotation,
 * net of surcharge lines — see fetchQuotationEvents); otherwise carry the
 * last known value (from either source, however far back in the product's
 * history) forward. If the product has neither tracking nor quotations in
 * its entire history, `hasHistory` is false.
 *
 * The carry-forward walk runs over the product's FULL history (not just
 * the last 12 months) so the first visible months can still inherit a
 * price set further back — only the final slice is trimmed to 12.
 */
export async function getProductPriceTrend(templateId: number): Promise<ProductPriceTrend> {
  const [productRows, trackingEvents, quoteEvents] = await Promise.all([
    searchRead<{ id: number; name: string }>({
      model: PRODUCT_TEMPLATE_MODEL,
      domain: [['id', '=', templateId]],
      fields: ['name'],
      limit: 1,
    }),
    fetchTrackedListPriceEvents(templateId),
    fetchQuotationEvents(templateId),
  ]);

  const product = productRows[0];
  if (!product) throw new OdooError(`product.template ${templateId} not found`);

  if (trackingEvents.length === 0 && quoteEvents.length === 0) {
    return { productId: templateId, productName: product.name, hasHistory: false, points: [], quotationDetails: [] };
  }

  const quotationDetails: ProductQuotationDetail[] = quoteEvents.map((e) => ({
    orderId: e.orderId,
    orderName: e.orderName,
    date: e.date,
    month: e.date.slice(0, 7),
    price: e.value,
    qty: e.qty,
  }));

  const trackingByMonth = latestPerMonth(trackingEvents);
  const quotesByMonth = statsPerMonth(quoteEvents);

  const earliestMonth = [...trackingByMonth.keys(), ...quotesByMonth.keys()].sort()[0]!;
  const months = monthsBetween(earliestMonth, currentMonthKey());

  let lastKnown: { value: number; source: PriceSource } | undefined;
  const fullSeries: ProductPricePoint[] = [];
  for (const month of months) {
    const tracked = trackingByMonth.get(month);
    const quoted = quotesByMonth.get(month);
    if (tracked) {
      lastKnown = { value: tracked.value, source: 'lista' };
      fullSeries.push({ month, price: tracked.value, source: 'lista' });
    } else if (quoted) {
      lastKnown = { value: quoted.avg, source: 'venta' };
      fullSeries.push({
        month,
        price: quoted.avg,
        source: 'venta',
        min: quoted.count > 1 ? quoted.min : undefined,
        max: quoted.count > 1 ? quoted.max : undefined,
        count: quoted.count,
      });
    } else if (lastKnown) {
      fullSeries.push({ month, price: lastKnown.value, source: 'arrastrado' });
    }
    // else: this product's history hasn't started yet at this point — no point.
  }

  return {
    productId: templateId,
    productName: product.name,
    hasHistory: true,
    points: fullSeries.slice(-TREND_MONTHS),
    quotationDetails,
  };
}
