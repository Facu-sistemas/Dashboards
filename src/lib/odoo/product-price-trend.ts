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
}

export interface ProductPriceTrend {
  productId: number;
  productName: string;
  hasHistory: boolean;
  /** Last up-to-12 months with a value — may be shorter if the product's history started more recently, empty if !hasHistory. */
  points: ProductPricePoint[];
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

/** Distinct product.template ids with at least one confirmed sale line. */
async function getTemplateIdsWithSales(): Promise<Set<number>> {
  type Row = OdooReadGroupResult & { product_id: [number, string] | false };
  const groups = (await readGroup({
    model: 'sale.order.line',
    domain: [['order_id.state', '=', 'sale']],
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

/** Confirmed sale prices for this template's variants (`sale.order.line`, orders in state 'sale'). */
async function fetchConfirmedSaleEvents(templateId: number): Promise<PriceEvent[]> {
  type LineRow = { id: number; price_unit: number; order_id: [number, string] };
  const lines = await searchReadAll<LineRow>({
    model: 'sale.order.line',
    domain: [
      ['product_id.product_tmpl_id', '=', templateId],
      ['order_id.state', '=', 'sale'],
    ],
    fields: ['price_unit', 'order_id'],
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

  const events: PriceEvent[] = [];
  for (const l of lines) {
    const date = dateByOrderId.get(l.order_id[0]);
    if (date) events.push({ date, value: l.price_unit });
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

/**
 * Monthly price series for one product, per plan-tendencia-precios.md's
 * priority: a tracked list-price change that month wins; otherwise a
 * confirmed sale that month; otherwise carry the last known value (from
 * either source, however far back in the product's history) forward. If
 * the product has neither tracking nor sales in its entire history,
 * `hasHistory` is false.
 *
 * The carry-forward walk runs over the product's FULL history (not just
 * the last 12 months) so the first visible months can still inherit a
 * price set further back — only the final slice is trimmed to 12.
 */
export async function getProductPriceTrend(templateId: number): Promise<ProductPriceTrend> {
  const [productRows, trackingEvents, saleEvents] = await Promise.all([
    searchRead<{ id: number; name: string }>({
      model: PRODUCT_TEMPLATE_MODEL,
      domain: [['id', '=', templateId]],
      fields: ['name'],
      limit: 1,
    }),
    fetchTrackedListPriceEvents(templateId),
    fetchConfirmedSaleEvents(templateId),
  ]);

  const product = productRows[0];
  if (!product) throw new OdooError(`product.template ${templateId} not found`);

  if (trackingEvents.length === 0 && saleEvents.length === 0) {
    return { productId: templateId, productName: product.name, hasHistory: false, points: [] };
  }

  const trackingByMonth = latestPerMonth(trackingEvents);
  const salesByMonth = latestPerMonth(saleEvents);

  const earliestMonth = [...trackingByMonth.keys(), ...salesByMonth.keys()].sort()[0]!;
  const months = monthsBetween(earliestMonth, currentMonthKey());

  let lastKnown: { value: number; source: PriceSource } | undefined;
  const fullSeries: ProductPricePoint[] = [];
  for (const month of months) {
    const tracked = trackingByMonth.get(month);
    const sold = salesByMonth.get(month);
    if (tracked) {
      lastKnown = { value: tracked.value, source: 'lista' };
      fullSeries.push({ month, price: tracked.value, source: 'lista' });
    } else if (sold) {
      lastKnown = { value: sold.value, source: 'venta' };
      fullSeries.push({ month, price: sold.value, source: 'venta' });
    } else if (lastKnown) {
      fullSeries.push({ month, price: lastKnown.value, source: 'arrastrado' });
    }
    // else: this product's history hasn't started yet at this point — no point.
  }

  return { productId: templateId, productName: product.name, hasHistory: true, points: fullSeries.slice(-TREND_MONTHS) };
}
