import { searchReadAll } from './client';
import { rangePresetStartDate } from '../date';
import { normalizeName } from '../bom-csv';
import { COLCHONES_CONFIG, LIVING_CONFIG, type CategoryRankingConfig } from './top-products';
import type { OdooDomain } from './types';

export type BusinessUnit = 'colchones' | 'living';

export interface ModelSalesShare {
  baseNameKey: string;
  baseName: string;
  unitsSold: number;
  /** 0-100 share of units sold within this business unit, over the last 12 months. */
  sharePct: number;
}

function configFor(unit: BusinessUnit): CategoryRankingConfig {
  return unit === 'colchones' ? COLCHONES_CONFIG : LIVING_CONFIG;
}

/**
 * The finished, sellable product is almost never the same `product.template`
 * the BOM is defined against — confirmed live (2026-09): "ONIX SOFA 1 CPO
 * (-76)" (the BOM's own template) has ZERO direct sales; customers instead
 * buy one of ~30 separate per-color/fabric templates, each its own
 * `product.template`, named "ONIX SOFA 1 CPO (-76) - FLOYD 21/39/021
 * GRAPHITE" etc. Splitting on " - " and keeping the prefix recovers the
 * shared base name — summing across all of ONIX's color templates in a
 * ~12-month window gave 53 units, matching Marlynet's reference worked
 * example ("60 unidades", the small gap being a different window
 * boundary) closely enough to confirm this is the right relationship.
 */
function baseNameOf(fullName: string): string {
  return fullName.split(' - ')[0]!.trim();
}

/**
 * % of participation of each active model — rolled up to its BOM's "modelo
 * base" name, not Odoo's per-color `product.template` — within its
 * business unit, from real units sold over the last 12 months, per
 * INSTRUCCIONES_Dashboard_Presupuesto_Dinamico.md section 3, step 2.
 * `eligibleBaseNameKeys` restricts the mix to models that are both active
 * (regla 4.3) and have a usable BOM (regla 4.2) — callers pass the set of
 * normalized keys from bom-csv.ts's getBomByModeloBaseKey().
 */
export interface ModelSalesMixResult {
  shares: ModelSalesShare[];
  /** Base names with real sales in the window whose normalized key isn't in eligibleBaseNameKeys — a genuine gap (their sales volume is entirely absent from the mix, not just zeroed), not just an inactive/discontinued model. */
  unmatchedBaseNames: string[];
}

export async function getModelSalesMix(unit: BusinessUnit, eligibleBaseNameKeys: Set<string>): Promise<ModelSalesMixResult> {
  const config = configFor(unit);
  const start = rangePresetStartDate('last-12-months')!;

  const domain: OdooDomain = [
    ['product_id.categ_id', 'child_of', config.rootCategId],
    ['product_id.categ_id', 'not in', config.excludeCategIds],
    ['order_id.state', '=', 'sale'],
    ['order_id.date_order', '>=', start],
  ];
  const lines = await searchReadAll<{ product_id: [number, string]; product_uom_qty: number }>({
    model: 'sale.order.line',
    domain,
    fields: ['product_id', 'product_uom_qty'],
  });
  if (lines.length === 0) return { shares: [], unmatchedBaseNames: [] };

  const variantIds = [...new Set(lines.map((l) => l.product_id[0]))];
  const variants = await searchReadAll<{ id: number; product_tmpl_id: [number, string] }>({
    model: 'product.product',
    domain: [['id', 'in', variantIds]],
    fields: ['product_tmpl_id'],
  });
  const templateIdByVariant = new Map(variants.map((v) => [v.id, v.product_tmpl_id[0]]));

  const templateIds = [...new Set(variants.map((v) => v.product_tmpl_id[0]))];
  const templates = await searchReadAll<{ id: number; name: string; active: boolean }>({
    model: 'product.template',
    domain: [['id', 'in', templateIds]],
    fields: ['name', 'active'],
  });
  const templateById = new Map(templates.map((t) => [t.id, t]));

  const qtyByBaseKey = new Map<string, number>();
  const displayNameByBaseKey = new Map<string, string>();
  const unmatchedNames = new Map<string, string>(); // baseKey -> display name, for sold-but-not-in-BOM models
  for (const line of lines) {
    const templateId = templateIdByVariant.get(line.product_id[0]);
    if (templateId === undefined) continue;
    const tmpl = templateById.get(templateId);
    if (!tmpl?.active) continue; // regla 4.3 — inactive

    const baseName = baseNameOf(tmpl.name);
    const baseKey = normalizeName(baseName);
    if (!eligibleBaseNameKeys.has(baseKey)) {
      unmatchedNames.set(baseKey, baseName); // regla 4.2 — no usable BOM found for this sold model
      continue;
    }

    qtyByBaseKey.set(baseKey, (qtyByBaseKey.get(baseKey) ?? 0) + line.product_uom_qty);
    if (!displayNameByBaseKey.has(baseKey)) displayNameByBaseKey.set(baseKey, baseName);
  }

  const unmatchedBaseNames = [...unmatchedNames.values()].sort();
  const totalUnits = [...qtyByBaseKey.values()].reduce((a, b) => a + b, 0);
  if (totalUnits === 0) return { shares: [], unmatchedBaseNames };

  const shares = [...qtyByBaseKey.entries()]
    .map(([baseKey, unitsSold]) => ({
      baseNameKey: baseKey,
      baseName: displayNameByBaseKey.get(baseKey)!,
      unitsSold,
      sharePct: (unitsSold / totalUnits) * 100,
    }))
    .sort((a, b) => b.unitsSold - a.unitsSold);

  return { shares, unmatchedBaseNames };
}

/**
 * Real units sold per month for a business unit, over an explicit set of
 * months — the denominator for the regla 4.4 empirical $/unit ratio
 * (INSTRUCCIONES_Dashboard_Presupuesto_Dinamico.md section 4.4: "gasto
 * real ÷ unidades reales producidas en esos mismos meses"). Units SOLD is
 * used as the "produced" proxy, same convention top-products.ts and
 * getModelSalesMix already rely on elsewhere in this codebase — there's
 * no separate "units actually produced" figure reliably queryable.
 * Not restricted to active/BOM-eligible models (unlike getModelSalesMix)
 * — a discontinued model's historical spend still happened and belongs
 * in the calibration.
 */
export async function getMonthlyUnitsSold(unit: BusinessUnit, months: string[]): Promise<Map<string, number>> {
  if (months.length === 0) return new Map();
  const config = configFor(unit);
  const sortedMonths = [...months].sort();
  const start = `${sortedMonths[0]}-01`;
  const [endYear, endMonth] = sortedMonths[sortedMonths.length - 1]!.split('-').map(Number);
  const endExclusive = endMonth === 12 ? `${endYear! + 1}-01-01` : `${endYear}-${String(endMonth! + 1).padStart(2, '0')}-01`;

  // read_group can't combine a related-field traversal ("order_id.date_order")
  // with a date-granularity groupBy (":month") — Odoo rejects it server-side
  // ("Property name 'date_order' has to be used on a property field",
  // confirmed live). Group in memory instead, same two-step join pattern
  // fetchRealPurchaseLines already uses for purchase.order.line.
  const domain: OdooDomain = [
    ['product_id.categ_id', 'child_of', config.rootCategId],
    ['product_id.categ_id', 'not in', config.excludeCategIds],
    ['order_id.state', '=', 'sale'],
    ['order_id.date_order', '>=', start],
    ['order_id.date_order', '<', endExclusive],
  ];
  const lines = await searchReadAll<{ order_id: [number, string]; product_uom_qty: number }>({
    model: 'sale.order.line',
    domain,
    fields: ['order_id', 'product_uom_qty'],
  });

  const orderIds = [...new Set(lines.map((l) => l.order_id[0]))];
  const orders = orderIds.length
    ? await searchReadAll<{ id: number; date_order: string }>({ model: 'sale.order', domain: [['id', 'in', orderIds]], fields: ['date_order'] })
    : [];
  const orderDateById = new Map(orders.map((o) => [o.id, o.date_order]));

  const byMonth = new Map<string, number>();
  for (const line of lines) {
    const dateOrder = orderDateById.get(line.order_id[0]);
    if (!dateOrder) continue;
    const month = dateOrder.slice(0, 7);
    byMonth.set(month, (byMonth.get(month) ?? 0) + line.product_uom_qty);
  }
  return byMonth;
}
