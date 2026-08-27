import { searchReadAll, searchRead, readGroup } from './client';
import { getFronteraCompany } from './reference';
import { withTtlCache } from '../cache';
import { lastMonthKeys, monthBounds } from '../date';
import type { OdooDomain, OdooReadGroupResult } from './types';

const MATERIA_PRIMA_CATEG_ID = 14;
export type ConsumptionLookbackDays = 30 | 60 | 90 | 180;
const DEFAULT_LOOKBACK_DAYS: ConsumptionLookbackDays = 90;
const HISTORY_MONTHS = 6;
// BOM explosion walks every confirmed/in-progress production order — expensive
// enough (thousands of orders) that it's worth caching across subcategory
// switches, since it's the same global computation regardless of which
// subcategory the user is currently looking at.
const BOM_EXPLOSION_TTL_MS = 5 * 60 * 1000;

export interface RawMaterialCategoryOption {
  id: number;
  name: string;
}

export interface RawMaterialRow {
  productId: number;
  productName: string;
  currentStock: number;
  reorderPoint: number | null;
  projectedConsumption: number;
  avgDailyConsumption: number;
  daysUntilStockout: number | null;
  isLow: boolean;
}

export interface RawMaterialConsumptionResult {
  categories: RawMaterialCategoryOption[];
  rows: RawMaterialRow[];
  lowCount: number;
}

export interface MaterialMonthlyPoint {
  month: string; // YYYY-MM
  consumption: number;
}

export interface MaterialHistory {
  productId: number;
  productName: string;
  currentStock: number;
  reorderPoint: number | null;
  points: MaterialMonthlyPoint[];
}

export async function getRawMaterialCategories(): Promise<RawMaterialCategoryOption[]> {
  const rows = await searchReadAll<{ id: number; name: string }>({
    model: 'product.category',
    domain: [['parent_id', '=', MATERIA_PRIMA_CATEG_ID]],
    fields: ['name'],
    order: 'name asc',
  });
  return rows.map((r) => ({ id: r.id, name: r.name }));
}

type ConfirmedOrderRow = {
  id: number;
  bom_id: [number, string] | false;
  product_qty: number;
  qty_produced: number;
};

/**
 * Single-level BOM explosion: for every confirmed/in-progress production
 * order, take its remaining qty to produce (product_qty - qty_produced)
 * and multiply through its BOM's lines. This does NOT recurse into
 * sub-assembly BOMs (e.g. an order whose BOM line points at an
 * intermediate like "[CORTE DE TELA]" rather than a leaf raw material) —
 * confirmed live that most finished-goods BOMs reference actual raw
 * materials directly, and a true multi-level explosion is out of scope
 * for this v1. Results are filtered to Materia Prima downstream, so a
 * line pointing at a non-raw-material intermediate simply won't surface.
 */
async function fetchBomExplosionNeeds(companyId: number): Promise<Map<number, number>> {
  return withTtlCache(`ref:bom-explosion:${companyId}`, BOM_EXPLOSION_TTL_MS, async () => {
    const orders = await searchReadAll<ConfirmedOrderRow>({
      model: 'mrp.production',
      domain: [
        ['state', 'in', ['confirmed', 'progress', 'to_close']],
        ['company_id', '=', companyId],
        ['bom_id', '!=', false],
      ],
      fields: ['bom_id', 'product_qty', 'qty_produced'],
    });
    if (orders.length === 0) return new Map<number, number>();

    const bomIds = [...new Set(orders.map((o) => (o.bom_id as [number, string])[0]))];

    const [boms, bomLines] = await Promise.all([
      searchReadAll<{ id: number; product_qty: number }>({
        model: 'mrp.bom',
        domain: [['id', 'in', bomIds]],
        fields: ['product_qty'],
      }),
      searchReadAll<{ bom_id: [number, string]; product_id: [number, string]; product_qty: number }>({
        model: 'mrp.bom.line',
        domain: [['bom_id', 'in', bomIds]],
        fields: ['bom_id', 'product_id', 'product_qty'],
      }),
    ]);

    const bomYieldById = new Map(boms.map((b) => [b.id, b.product_qty || 1]));
    const linesByBom = new Map<number, { productId: number; qtyPerYield: number }[]>();
    for (const line of bomLines) {
      const bomId = line.bom_id[0];
      if (!linesByBom.has(bomId)) linesByBom.set(bomId, []);
      linesByBom.get(bomId)!.push({ productId: line.product_id[0], qtyPerYield: line.product_qty });
    }

    const neededByMaterial = new Map<number, number>();
    for (const order of orders) {
      const bomId = (order.bom_id as [number, string])[0];
      const remaining = Math.max(order.product_qty - order.qty_produced, 0);
      if (remaining === 0) continue;
      const yieldQty = bomYieldById.get(bomId) || 1;
      for (const line of linesByBom.get(bomId) ?? []) {
        const needed = (remaining / yieldQty) * line.qtyPerYield;
        neededByMaterial.set(line.productId, (neededByMaterial.get(line.productId) ?? 0) + needed);
      }
    }
    return neededByMaterial;
  });
}

/** Base domain for actual raw-material-consumption moves — shared by the average-rate calc and the per-material monthly history. */
function consumptionMoveDomain(companyId: number, materialIds: number[], start: string): OdooDomain {
  const today = new Date().toISOString().slice(0, 10);
  return [
    ['raw_material_production_id', '!=', false],
    ['raw_material_production_id.company_id', '=', companyId],
    ['state', '=', 'done'],
    ['product_id', 'in', materialIds],
    ['date', '>=', start],
    // Explicitly excludes moves dated after today — some rows are
    // intentionally pre-created with a far-future placeholder date (year
    // 2100) as part of forward planning and get corrected to the real date
    // once consumed; confirmed by the user, not a data bug. Including them
    // would treat not-yet-real consumption as if it already happened.
    ['date', '<=', today],
  ];
}

/** Average daily consumption from actual raw-material-consumption moves, over the given lookback window. */
async function fetchAverageDailyConsumption(
  materialIds: number[],
  companyId: number,
  lookbackDays: ConsumptionLookbackDays
): Promise<Map<number, number>> {
  if (materialIds.length === 0) return new Map();

  const lookbackStart = new Date(Date.now() - lookbackDays * 86_400_000).toISOString().slice(0, 10);
  const domain = consumptionMoveDomain(companyId, materialIds, lookbackStart);

  type GroupRow = OdooReadGroupResult & { product_id: [number, string] | false; product_uom_qty: number };
  const groups = (await readGroup({
    model: 'stock.move',
    domain,
    fields: ['product_uom_qty'],
    groupBy: ['product_id'],
  })) as GroupRow[];

  const map = new Map<number, number>();
  for (const g of groups) {
    if (g.product_id) map.set(g.product_id[0], g.product_uom_qty / lookbackDays);
  }
  return map;
}

/**
 * Stock vs. projected consumption for raw materials in a subcategory (or
 * every Materia Prima subcategory when `subcategoryId` is null). Confirmed
 * live: only 536 of the 676 total reorder rules are actually Materia
 * Prima — everything here is explicitly scoped by category, never assumed
 * from the full orderpoint count.
 *
 * Always sorted by urgency (fewest days until stockout first, no-data
 * last) — `onlyLow` narrows the list to rows already flagged as
 * low-stock/over-committed instead of changing the ordering, so this
 * table reads the same way whether you're scanning everything or just
 * the fires.
 */
export async function getRawMaterialConsumption(
  subcategoryId: number | null,
  lookbackDays: ConsumptionLookbackDays = DEFAULT_LOOKBACK_DAYS,
  onlyLow = false
): Promise<RawMaterialConsumptionResult> {
  const { companyId } = await getFronteraCompany();

  const categDomain: OdooDomain = subcategoryId
    ? [['categ_id', '=', subcategoryId]]
    : [['categ_id', 'child_of', MATERIA_PRIMA_CATEG_ID]];

  const [categories, products] = await Promise.all([
    getRawMaterialCategories(),
    searchReadAll<{ id: number; name: string; qty_available: number }>({
      model: 'product.product',
      domain: categDomain,
      fields: ['name', 'qty_available'],
      order: 'name asc',
    }),
  ]);

  if (products.length === 0) return { categories, rows: [], lowCount: 0 };

  const productIds = products.map((p) => p.id);

  const [orderpoints, neededByMaterial, avgDailyByMaterial] = await Promise.all([
    searchReadAll<{ product_id: [number, string]; product_min_qty: number }>({
      model: 'stock.warehouse.orderpoint',
      domain: [['product_id', 'in', productIds]],
      fields: ['product_id', 'product_min_qty'],
    }),
    fetchBomExplosionNeeds(companyId),
    fetchAverageDailyConsumption(productIds, companyId, lookbackDays),
  ]);

  const reorderByProduct = new Map(orderpoints.map((o) => [o.product_id[0], o.product_min_qty]));

  const allRows: RawMaterialRow[] = products.map((p) => {
    const projectedConsumption = neededByMaterial.get(p.id) ?? 0;
    const avgDailyConsumption = avgDailyByMaterial.get(p.id) ?? 0;
    const reorderPoint = reorderByProduct.get(p.id) ?? null;
    const daysUntilStockout = avgDailyConsumption > 0 ? p.qty_available / avgDailyConsumption : null;
    const isLow = (reorderPoint !== null && p.qty_available < reorderPoint) || projectedConsumption > p.qty_available;

    return {
      productId: p.id,
      productName: p.name,
      currentStock: p.qty_available,
      reorderPoint,
      projectedConsumption,
      avgDailyConsumption,
      daysUntilStockout,
      isLow,
    };
  });

  const lowCount = allRows.filter((r) => r.isLow).length;
  const filtered = onlyLow ? allRows.filter((r) => r.isLow) : allRows;
  const sorted = filtered.sort((a, b) => {
    if (a.daysUntilStockout === null && b.daysUntilStockout === null) return 0;
    if (a.daysUntilStockout === null) return 1;
    if (b.daysUntilStockout === null) return -1;
    return a.daysUntilStockout - b.daysUntilStockout;
  });

  return { categories, rows: sorted, lowCount };
}

/**
 * Monthly consumption history for ONE material, last 6 months — the
 * per-material drill-down view. Plotting stock vs. consumption for a
 * single insumo over time is meaningful; a chart trying to do this for
 * hundreds of unrelated materials at once (the original design) isn't —
 * one Y axis gets dominated by whichever material has a huge unit count,
 * and a line "connecting" alphabetically-ordered, unrelated categories
 * implies a continuity that doesn't exist.
 */
export async function getMaterialHistory(productId: number): Promise<MaterialHistory> {
  const { companyId } = await getFronteraCompany();

  const [productRows, orderpointRows] = await Promise.all([
    searchRead<{ id: number; name: string; qty_available: number }>({
      model: 'product.product',
      domain: [['id', '=', productId]],
      fields: ['name', 'qty_available'],
      limit: 1,
    }),
    searchRead<{ product_min_qty: number }>({
      model: 'stock.warehouse.orderpoint',
      domain: [['product_id', '=', productId]],
      fields: ['product_min_qty'],
      limit: 1,
    }),
  ]);

  const product = productRows[0];
  if (!product) throw new Error(`product.product ${productId} not found`);

  const months = lastMonthKeys(HISTORY_MONTHS);
  const rangeStart = monthBounds(months[0]!).start;
  const domain = consumptionMoveDomain(companyId, [productId], rangeStart);

  type GroupRow = OdooReadGroupResult & {
    product_uom_qty: number;
    __range?: Record<string, { from: string | false; to: string | false }>;
  };
  const groups = (await readGroup({
    model: 'stock.move',
    domain,
    fields: ['product_uom_qty'],
    groupBy: ['date:month'],
    lazy: false,
  })) as GroupRow[];

  const byMonth = new Map<string, number>();
  for (const g of groups) {
    const monthFrom = g.__range?.['date:month']?.from;
    if (monthFrom) byMonth.set(monthFrom.slice(0, 7), g.product_uom_qty);
  }

  return {
    productId,
    productName: product.name,
    currentStock: product.qty_available,
    reorderPoint: orderpointRows[0]?.product_min_qty ?? null,
    points: months.map((month) => ({ month, consumption: byMonth.get(month) ?? 0 })),
  };
}
