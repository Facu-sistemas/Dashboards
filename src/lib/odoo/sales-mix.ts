import { searchReadAll, readGroup } from './client';
import { rangePresetStartDate } from '../date';
import { COLCHONES_CONFIG, LIVING_CONFIG, type CategoryRankingConfig } from './top-products';
import type { OdooDomain, OdooReadGroupResult } from './types';

export type BusinessUnit = 'colchones' | 'living';

export interface ModelSalesShare {
  templateId: number;
  templateName: string;
  unitsSold: number;
  /** 0-100 share of units sold within this business unit, over the last 12 months. */
  sharePct: number;
}

function configFor(unit: BusinessUnit): CategoryRankingConfig {
  return unit === 'colchones' ? COLCHONES_CONFIG : LIVING_CONFIG;
}

/**
 * % of participation of each active, BOM-explodable model within its
 * business unit, from real units sold over the last 12 months — per
 * INSTRUCCIONES_Dashboard_Presupuesto_Dinamico.md section 3, step 2.
 * `eligibleTemplateIds` restricts the mix to models that are both active
 * (regla 4.3) and have a usable BOM (regla 4.2) — callers pass the set
 * from bom-explosion.ts's getActiveModelsWithBom().
 */
export async function getModelSalesMix(unit: BusinessUnit, eligibleTemplateIds: Set<number>): Promise<ModelSalesShare[]> {
  const config = configFor(unit);
  const start = rangePresetStartDate('last-12-months')!;

  const domain: OdooDomain = [
    ['product_id.categ_id', 'child_of', config.rootCategId],
    ['product_id.categ_id', 'not in', config.excludeCategIds],
    ['order_id.state', '=', 'sale'],
    ['order_id.date_order', '>=', start],
  ];

  type GroupRow = OdooReadGroupResult & { product_id: [number, string] | false; product_uom_qty: number };
  const groups = (await readGroup({
    model: 'sale.order.line',
    domain,
    fields: ['product_uom_qty'],
    groupBy: ['product_id'],
  })) as GroupRow[];

  const variantTotals = groups
    .filter((g): g is GroupRow & { product_id: [number, string] } => Boolean(g.product_id))
    .map((g) => ({ variantId: g.product_id[0], unitsSold: g.product_uom_qty }));

  if (variantTotals.length === 0) return [];

  const variantIds = variantTotals.map((v) => v.variantId);
  const variants = await searchReadAll<{ id: number; product_tmpl_id: [number, string] }>({
    model: 'product.product',
    domain: [['id', 'in', variantIds]],
    fields: ['product_tmpl_id'],
  });
  const templateIdByVariant = new Map(variants.map((v) => [v.id, v.product_tmpl_id[0]]));

  const qtyByTemplate = new Map<number, number>();
  for (const { variantId, unitsSold } of variantTotals) {
    const templateId = templateIdByVariant.get(variantId);
    if (templateId === undefined || !eligibleTemplateIds.has(templateId)) continue; // regla 4.3 + 4.2 — inactive or no usable BOM
    qtyByTemplate.set(templateId, (qtyByTemplate.get(templateId) ?? 0) + unitsSold);
  }

  const totalUnits = [...qtyByTemplate.values()].reduce((a, b) => a + b, 0);
  if (totalUnits === 0) return [];

  const templateIds = [...qtyByTemplate.keys()];
  const templates = await searchReadAll<{ id: number; name: string }>({
    model: 'product.template',
    domain: [['id', 'in', templateIds]],
    fields: ['name'],
  });
  const nameByTemplate = new Map(templates.map((t) => [t.id, t.name]));

  return templateIds
    .map((id) => {
      const unitsSold = qtyByTemplate.get(id)!;
      return {
        templateId: id,
        templateName: nameByTemplate.get(id) ?? `#${id}`,
        unitsSold,
        sharePct: (unitsSold / totalUnits) * 100,
      };
    })
    .sort((a, b) => b.unitsSold - a.unitsSold);
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
