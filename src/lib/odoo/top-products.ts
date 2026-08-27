import { searchReadAll, readGroup } from './client';
import { rangePresetStartDate, type DateRangePreset } from '../date';
import type { OdooDomain, OdooReadGroupResult } from './types';

const TOP_N = 10;

export type TopProductsRange = DateRangePreset;

export interface TopProductRow {
  productTemplateId: number;
  productName: string;
  subcategoryName: string;
  unitsSold: number;
}

export interface TopProductsResult {
  colchones: TopProductRow[];
  living: TopProductRow[];
}

interface CategoryRankingConfig {
  rootCategId: number;
  excludeCategIds: number[];
}

// Confirmed live against Odoo (2026-08): all six excluded ids are leaf
// categories with no children of their own, so a plain `not in` is
// sufficient — no need for a recursive "not descendant of" domain.
const COLCHONES_CONFIG: CategoryRankingConfig = { rootCategId: 5, excludeCategIds: [8, 6, 45] };
const LIVING_CONFIG: CategoryRankingConfig = { rootCategId: 1, excludeCategIds: [4, 16, 46] };

interface VariantGroup {
  variantId: number;
  unitsSold: number;
}

/**
 * Default range is the FULL sales history, not a rolling window — confirmed
 * against plan-top10-manufactura.md's pre-validated reference numbers,
 * which only match with no date filter at all (a 12-month window produces
 * different totals and a different top 10). Other ranges are opt-in via the
 * `range` selector.
 */
async function fetchVariantTotals(config: CategoryRankingConfig, range: TopProductsRange): Promise<VariantGroup[]> {
  const domain: OdooDomain = [
    ['product_id.categ_id', 'child_of', config.rootCategId],
    ['product_id.categ_id', 'not in', config.excludeCategIds],
    ['order_id.state', '=', 'sale'],
  ];
  const start = rangePresetStartDate(range);
  if (start) domain.push(['order_id.date_order', '>=', start]);

  // read_group aggregates server-side (sum per product_id) instead of
  // pulling every sale.order.line — for Living that's the difference
  // between one query and fetching 12k+ rows.
  type GroupRow = OdooReadGroupResult & { product_id: [number, string] | false; product_uom_qty: number };
  const groups = (await readGroup({
    model: 'sale.order.line',
    domain,
    fields: ['product_uom_qty'],
    groupBy: ['product_id'],
  })) as GroupRow[];

  return groups
    .filter((g): g is GroupRow & { product_id: [number, string] } => Boolean(g.product_id))
    .map((g) => ({ variantId: g.product_id[0], unitsSold: g.product_uom_qty }));
}

/**
 * Variants (product.product) roll up into products (product.template) —
 * e.g. color variants of the same mattress must be summed together for the
 * ranking, per plan-top10-manufactura.md.
 */
async function rollUpByTemplate(variantTotals: VariantGroup[]): Promise<TopProductRow[]> {
  if (variantTotals.length === 0) return [];

  const variantIds = variantTotals.map((v) => v.variantId);
  type VariantRow = { id: number; product_tmpl_id: [number, string]; categ_id: [number, string] | false };
  const variants = await searchReadAll<VariantRow>({
    model: 'product.product',
    domain: [['id', 'in', variantIds]],
    fields: ['product_tmpl_id', 'categ_id'],
  });
  const templateIdByVariant = new Map(variants.map((v) => [v.id, v.product_tmpl_id[0]]));
  const categByVariant = new Map(variants.map((v) => [v.id, v.categ_id ? v.categ_id[1] : '']));

  const qtyByTemplate = new Map<number, number>();
  const categByTemplate = new Map<number, string>();
  for (const { variantId, unitsSold } of variantTotals) {
    const templateId = templateIdByVariant.get(variantId);
    if (templateId === undefined) continue;
    qtyByTemplate.set(templateId, (qtyByTemplate.get(templateId) ?? 0) + unitsSold);
    if (!categByTemplate.has(templateId)) {
      const cat = categByVariant.get(variantId);
      if (cat) categByTemplate.set(templateId, cat);
    }
  }

  const templateIds = [...qtyByTemplate.keys()];
  type TemplateRow = { id: number; name: string };
  const templates = await searchReadAll<TemplateRow>({
    model: 'product.template',
    domain: [['id', 'in', templateIds]],
    fields: ['name'],
  });
  const nameByTemplate = new Map(templates.map((t) => [t.id, t.name]));

  return templateIds
    .map((id) => ({
      productTemplateId: id,
      productName: nameByTemplate.get(id) ?? `#${id}`,
      subcategoryName: categByTemplate.get(id) ?? '',
      unitsSold: qtyByTemplate.get(id)!,
    }))
    .sort((a, b) => b.unitsSold - a.unitsSold)
    .slice(0, TOP_N);
}

async function getTopProducts(config: CategoryRankingConfig, range: TopProductsRange): Promise<TopProductRow[]> {
  const variantTotals = await fetchVariantTotals(config, range);
  return rollUpByTemplate(variantTotals);
}

/** Top 10 Colchones and top 10 Living by units sold (confirmed sales) for the given date range — read-only, live from Odoo. */
export async function getTopProductsByCategory(range: TopProductsRange = 'all'): Promise<TopProductsResult> {
  const [colchones, living] = await Promise.all([
    getTopProducts(COLCHONES_CONFIG, range),
    getTopProducts(LIVING_CONFIG, range),
  ]);
  return { colchones, living };
}
