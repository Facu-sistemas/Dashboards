import { searchReadAll } from './client';
import { getFronteraCompany } from './reference';
import { monthBounds, lastMonthKeys } from '../date';
import { withTtlCache, cacheKey } from '../cache';
import type { OdooDomain } from './types';

export type OeePeriodKind = 'day' | 'week' | 'month';

export interface OeeCategoryGauge {
  planned: number;
  produced: number;
  pctComplete: number;
}

export interface OeeOrderSummary {
  id: number;
  reference: string;
  productName: string;
}

export interface OeeMonthlyRow {
  month: string; // "YYYY-MM"
  colchones: OeeCategoryGauge;
  living: OeeCategoryGauge;
  total: OeeCategoryGauge;
}

export interface OeeResult {
  period: { kind: OeePeriodKind; date: string; start: string; endInclusive: string };
  colchones: OeeCategoryGauge;
  living: OeeCategoryGauge;
  total: OeeCategoryGauge;
  /** Orders closed within the selected period (state=done, date_finished in range). */
  closedOrders: OeeOrderSummary[];
  closedTotal: number;
  /** Currently open backlog, independent of the period selector (see getOeeSummary doc comment). */
  pendingOrders: OeeOrderSummary[];
  pendingTotal: number;
  monthly: OeeMonthlyRow[];
}

const LIST_LIMIT = 50;
const SUMMARY_TTL_MS = 60 * 1000;
const ARGENTINA_TZ = 'America/Argentina/Buenos_Aires';

/**
 * Exact `product.category` id sets used by Planificación's own saved Odoo
 * filters — confirmed live via `ir.filters`: "CERRADO COLCHONES" / "CERRADO
 * LIVING" / "PLAN+CUMPL COLC" / "PLAN+CUMPL LIVING" all hardcode these same
 * ids (the full "Colchones" and "Sillon" category trees, respectively).
 * Mirrored here verbatim so this dashboard's numbers always match what
 * Planificación reports internally — in particular, Living/Sillon
 * legitimately includes categ 16 ("Deliveries"), unlike an earlier version
 * of this file which excluded it.
 */
const COLCHONES_CATEG_IDS = [5, 8, 9, 6, 20];
const LIVING_CATEG_IDS = [1, 3, 16, 4, 2];
const ALL_CATEG_IDS = [...COLCHONES_CATEG_IDS, ...LIVING_CATEG_IDS];

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return toIsoDate(new Date(Date.UTC(y!, m! - 1, d! + days)));
}

/**
 * "Today" per Argentina wall-clock time, not the server process's — Odoo's
 * `planning_date` is a plain Date field (no time component) maintained by
 * staff working Argentina hours, so deriving "today" from `new Date()`'s UTC
 * parts would show tomorrow's date during the last 3 hours of each Argentina
 * business day (UTC-3) whenever this process runs with a UTC system clock.
 */
export function getArgentinaTodayIso(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ARGENTINA_TZ }).format(new Date());
}

/** Inclusive day/week(Mon-Sun)/month bounds around an anchor date (plain "YYYY-MM-DD", no timezone math needed). */
function periodBounds(kind: OeePeriodKind, anchorIso: string): { start: string; endInclusive: string } {
  const [y, m, d] = anchorIso.split('-').map(Number);
  const anchor = new Date(Date.UTC(y!, m! - 1, d!));

  if (kind === 'day') {
    return { start: anchorIso, endInclusive: anchorIso };
  }

  if (kind === 'week') {
    const dayOfWeek = anchor.getUTCDay(); // 0=Sun..6=Sat
    const diffToMonday = (dayOfWeek + 6) % 7;
    const monday = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate() - diffToMonday));
    const sunday = new Date(Date.UTC(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate() + 6));
    return { start: toIsoDate(monday), endInclusive: toIsoDate(sunday) };
  }

  const first = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1));
  const last = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 0));
  return { start: toIsoDate(first), endInclusive: toIsoDate(last) };
}

function emptyGauge(): OeeCategoryGauge {
  return { planned: 0, produced: 0, pctComplete: 0 };
}

function combineGauges(a: OeeCategoryGauge, b: OeeCategoryGauge): OeeCategoryGauge {
  const planned = a.planned + b.planned;
  const produced = a.produced + b.produced;
  return { planned, produced, pctComplete: planned > 0 ? (produced / planned) * 100 : 0 };
}

/**
 * Same measure as Planificación's "PLAN+CUMPL COLC/LIVING" filters: every
 * order whose `planning_date` falls in the period, regardless of `state`
 * (an order can be counted as "planned" and later cancelled — that's their
 * definition, not a bug), summing `product_qty` (plan) vs `qty_produced`
 * (cumplido) in JS rather than via `read_group` — see the empty-groupBy
 * field-drop bug noted below for why raw-row summation is used throughout
 * this module.
 */
async function sumPlanCumpl(
  categIds: number[],
  companyId: number,
  bounds: { start: string; endInclusive: string }
): Promise<OeeCategoryGauge> {
  type Row = { product_qty: number; qty_produced: number };
  const rows = await searchReadAll<Row>({
    model: 'mrp.production',
    domain: [
      ['company_id', '=', companyId],
      ['product_id.categ_id', 'in', categIds],
      ['planning_date', '>=', bounds.start],
      ['planning_date', '<=', bounds.endInclusive],
    ],
    fields: ['product_qty', 'qty_produced'],
  });
  const planned = rows.reduce((sum, r) => sum + r.product_qty, 0);
  const produced = rows.reduce((sum, r) => sum + r.qty_produced, 0);
  return { planned, produced, pctComplete: planned > 0 ? (produced / planned) * 100 : 0 };
}

type MonthlyRawRow = { planning_date: string; product_qty: number; qty_produced: number };

async function fetchMonthlyRows(categIds: number[], companyId: number, startDate: string, endExclusiveDate: string): Promise<MonthlyRawRow[]> {
  return searchReadAll<MonthlyRawRow>({
    model: 'mrp.production',
    domain: [
      ['company_id', '=', companyId],
      ['product_id.categ_id', 'in', categIds],
      ['planning_date', '>=', startDate],
      ['planning_date', '<', endExclusiveDate],
    ],
    fields: ['planning_date', 'product_qty', 'qty_produced'],
  });
}

function bucketByMonth(rows: MonthlyRawRow[]): Map<string, OeeCategoryGauge> {
  const totals = new Map<string, { planned: number; produced: number }>();
  for (const r of rows) {
    const month = r.planning_date.slice(0, 7);
    const acc = totals.get(month) ?? { planned: 0, produced: 0 };
    acc.planned += r.product_qty;
    acc.produced += r.qty_produced;
    totals.set(month, acc);
  }
  const out = new Map<string, OeeCategoryGauge>();
  for (const [month, { planned, produced }] of totals) {
    out.set(month, { planned, produced, pctComplete: planned > 0 ? (produced / planned) * 100 : 0 });
  }
  return out;
}

/**
 * Three gauges (Colchones / Living / Todos los productos) built from the
 * exact same Odoo filters Planificación uses to report plan vs. cumplido,
 * plus the closed/pending order lists from the previous version of this
 * tab (kept, now scoped consistently to the combined Colchones+Living
 * category set instead of an "all products" domain that used to silently
 * include ~150k unrelated component/sub-assembly manufacturing orders) and
 * a 6-month monthly trend crossing the same plan-vs-cumplido data.
 *
 * The pending backlog isn't period-scoped — confirmed live that most open
 * orders (draft/confirmed/progress/to_close) without an explicit schedule
 * carry a placeholder `planning_date` of 2100-01-01, so "pending" is always
 * the current backlog regardless of which period is selected; only orders
 * Planificación has actually scheduled get picked up by the period filter
 * on the gauges above.
 */
export async function getOeeSummary(periodKind: OeePeriodKind, dateIso?: string): Promise<OeeResult> {
  const anchor = dateIso ?? getArgentinaTodayIso();
  return withTtlCache(cacheKey('oee:summary', { periodKind, anchor }), SUMMARY_TTL_MS, async () => {
    const { companyId } = await getFronteraCompany();
    const bounds = periodBounds(periodKind, anchor);

    const [colchones, living] = await Promise.all([
      sumPlanCumpl(COLCHONES_CATEG_IDS, companyId, bounds),
      sumPlanCumpl(LIVING_CATEG_IDS, companyId, bounds),
    ]);
    const total = combineGauges(colchones, living);

    type OrderRow = { id: number; name: string; product_id: [number, string] };

    const closedDomain: OdooDomain = [
      ['state', '=', 'done'],
      ['company_id', '=', companyId],
      ['product_id.categ_id', 'in', ALL_CATEG_IDS],
      ['date_finished', '>=', bounds.start],
      ['date_finished', '<', addDaysIso(bounds.endInclusive, 1)],
    ];
    const pendingDomain: OdooDomain = [
      ['state', 'in', ['confirmed', 'progress', 'to_close']],
      ['company_id', '=', companyId],
      ['product_id.categ_id', 'in', ALL_CATEG_IDS],
    ];

    const [closedRows, pendingRows] = await Promise.all([
      searchReadAll<OrderRow>({
        model: 'mrp.production',
        domain: closedDomain,
        fields: ['name', 'product_id'],
        order: 'date_finished desc',
      }),
      searchReadAll<OrderRow>({
        model: 'mrp.production',
        domain: pendingDomain,
        fields: ['name', 'product_id'],
        order: 'create_date asc',
      }),
    ]);

    const months = lastMonthKeys(6);
    const monthsStart = monthBounds(months[0]!).start;
    const monthsEndExclusive = monthBounds(months[months.length - 1]!).endExclusive;

    const [colchonesMonthlyRows, livingMonthlyRows] = await Promise.all([
      fetchMonthlyRows(COLCHONES_CATEG_IDS, companyId, monthsStart, monthsEndExclusive),
      fetchMonthlyRows(LIVING_CATEG_IDS, companyId, monthsStart, monthsEndExclusive),
    ]);
    const colchonesByMonth = bucketByMonth(colchonesMonthlyRows);
    const livingByMonth = bucketByMonth(livingMonthlyRows);
    const monthly: OeeMonthlyRow[] = months.map((month) => {
      const monthColchones = colchonesByMonth.get(month) ?? emptyGauge();
      const monthLiving = livingByMonth.get(month) ?? emptyGauge();
      return { month, colchones: monthColchones, living: monthLiving, total: combineGauges(monthColchones, monthLiving) };
    });

    return {
      period: { kind: periodKind, date: anchor, start: bounds.start, endInclusive: bounds.endInclusive },
      colchones,
      living,
      total,
      closedOrders: closedRows.slice(0, LIST_LIMIT).map((r) => ({ id: r.id, reference: r.name, productName: r.product_id[1] })),
      closedTotal: closedRows.length,
      pendingOrders: pendingRows.slice(0, LIST_LIMIT).map((r) => ({ id: r.id, reference: r.name, productName: r.product_id[1] })),
      pendingTotal: pendingRows.length,
      monthly,
    };
  });
}
