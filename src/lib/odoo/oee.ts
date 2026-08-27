import { searchReadAll, searchRead, searchCount } from './client';
import { getFronteraCompany } from './reference';
import { monthBounds, currentMonthKey } from '../date';
import type { OdooDomain } from './types';

export type OeeGranularity = 'day' | 'week' | 'month';
export type OeeCategoryFilter = 'all' | 'colchones' | 'living';

export interface OeeOrderSummary {
  id: number;
  reference: string;
  productName: string;
}

export interface OeeResult {
  plannedQty: number;
  producedQty: number;
  pctComplete: number;
  /** Orders finished within the selected period — the ones behind plannedQty/producedQty. */
  closedOrders: OeeOrderSummary[];
  closedTotal: number;
  /** Currently open orders (not yet done), independent of the period selector — a running backlog, not "due this period" (no scheduling field here is reliable enough to draw that line). */
  pendingOrders: OeeOrderSummary[];
  pendingTotal: number;
}

const LIST_LIMIT = 50;

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Bounds for the CURRENT day/week(Mon-Sun)/month — this is a snapshot gauge, not a lookback trend. */
function currentPeriodBounds(granularity: OeeGranularity): { start: string; endExclusive: string } {
  const now = new Date();

  if (granularity === 'day') {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 1);
    return { start: toIsoDate(start), endExclusive: toIsoDate(end) };
  }

  if (granularity === 'week') {
    const dayOfWeek = now.getUTCDay(); // 0=Sun..6=Sat
    const diffToMonday = (dayOfWeek + 6) % 7;
    const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - diffToMonday));
    const nextMonday = new Date(monday);
    nextMonday.setUTCDate(monday.getUTCDate() + 7);
    return { start: toIsoDate(monday), endExclusive: toIsoDate(nextMonday) };
  }

  return monthBounds(currentMonthKey());
}

function categoryDomain(categoryFilter: OeeCategoryFilter): OdooDomain {
  if (categoryFilter === 'colchones') return [['product_id.categ_id', 'child_of', 5]];
  if (categoryFilter === 'living') {
    return [
      ['product_id.categ_id', 'child_of', 1],
      ['product_id.categ_id', 'not in', [16]],
    ];
  }
  return [];
}

/**
 * Simple OEE v1: produced vs. planned units for the current period —
 * confirmed live that `mrp.workcenter.productivity` has 0 rows (no
 * downtime/scrap tracking loaded in Odoo yet), so the full
 * Availability × Performance × Quality breakdown isn't computable. This
 * gauge is just `qty_produced / product_qty` for orders finished in the
 * period, scoped to Frontera Living S.A. — plus the order names behind
 * that number (closed this period, and what's still open), since a bare
 * percentage with nothing to read gives no sense of whether it's moving.
 */
export async function getOeeSummary(granularity: OeeGranularity, categoryFilter: OeeCategoryFilter): Promise<OeeResult> {
  const { companyId } = await getFronteraCompany();
  const { start, endExclusive } = currentPeriodBounds(granularity);
  const categDomain = categoryDomain(categoryFilter);

  const closedDomain: OdooDomain = [
    ['state', '=', 'done'],
    ['company_id', '=', companyId],
    ['date_finished', '>=', start],
    ['date_finished', '<', endExclusive],
    ...categDomain,
  ];

  type Row = { id: number; name: string; product_qty: number; qty_produced: number; product_id: [number, string] };
  // read_group with an empty groupBy silently drops `qty_produced` from the
  // aggregate result on this instance (confirmed live — only `product_qty`
  // came back, `qty_produced` was missing from the row entirely, not just
  // zero). Summing raw rows in JS sidesteps whatever field-level
  // group_operator quirk causes that.
  const closedRows = await searchReadAll<Row>({
    model: 'mrp.production',
    domain: closedDomain,
    fields: ['name', 'product_qty', 'qty_produced', 'product_id'],
    order: 'date_finished desc',
  });

  const plannedQty = closedRows.reduce((sum, r) => sum + r.product_qty, 0);
  const producedQty = closedRows.reduce((sum, r) => sum + r.qty_produced, 0);

  const pendingDomain: OdooDomain = [
    ['state', 'in', ['confirmed', 'progress', 'to_close']],
    ['company_id', '=', companyId],
    ...categDomain,
  ];

  const [pendingTotal, pendingRows] = await Promise.all([
    searchCount('mrp.production', pendingDomain),
    searchRead<Row>({
      model: 'mrp.production',
      domain: pendingDomain,
      fields: ['name', 'product_id'],
      order: 'create_date asc',
      limit: LIST_LIMIT,
    }),
  ]);

  return {
    plannedQty,
    producedQty,
    pctComplete: plannedQty > 0 ? (producedQty / plannedQty) * 100 : 0,
    closedOrders: closedRows.slice(0, LIST_LIMIT).map((r) => ({ id: r.id, reference: r.name, productName: r.product_id[1] })),
    closedTotal: closedRows.length,
    pendingOrders: pendingRows.map((r) => ({ id: r.id, reference: r.name, productName: r.product_id[1] })),
    pendingTotal,
  };
}
