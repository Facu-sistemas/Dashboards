import { searchReadAll } from './client';
import { withTtlCache } from '../cache';
import { normalizeName } from '../bom-csv';

export interface InsumoCost {
  productId: number;
  productName: string;
  categId: number | null;
  /** Category's own leaf name (not the hierarchical path tuple label — see purchase-budget.ts's fetchSpendLines for why). */
  categName: string | null;
  standardPrice: number;
  costCurrency: 'ARS' | 'USD' | 'OTHER';
  hasCost: boolean;
}

/**
 * Current cost for a set of insumos, cross-referenced strictly by
 * `product_id` (regla 4.1 — never by text name, which can silently
 * mismatch between BOM and cost list). No caching here on purpose: regla
 * 4.5 requires reading whatever cost is vigente at query time, not a
 * value from a previous run — the short de-dup TTL already built into
 * client.ts's searchRead is the only caching this gets.
 */
export async function getInsumoCosts(productIds: number[]): Promise<Map<number, InsumoCost>> {
  if (productIds.length === 0) return new Map();

  type Row = {
    id: number;
    name: string;
    categ_id: [number, string] | false;
    standard_price: number;
    cost_currency_id: [number, string] | false;
  };
  const rows = await searchReadAll<Row>({
    model: 'product.product',
    domain: [['id', 'in', productIds]],
    fields: ['name', 'categ_id', 'standard_price', 'cost_currency_id'],
  });

  const categIds = [...new Set(rows.filter((r) => r.categ_id).map((r) => (r.categ_id as [number, string])[0]))];
  const categories = categIds.length
    ? await searchReadAll<{ id: number; name: string }>({ model: 'product.category', domain: [['id', 'in', categIds]], fields: ['name'] })
    : [];
  const categNameById = new Map(categories.map((c) => [c.id, c.name]));

  const result = new Map<number, InsumoCost>();
  for (const r of rows) {
    const categId = r.categ_id ? r.categ_id[0] : null;
    const currencyName = r.cost_currency_id ? r.cost_currency_id[1] : null;
    result.set(r.id, {
      productId: r.id,
      productName: r.name,
      categId,
      categName: categId !== null ? categNameById.get(categId) ?? null : null,
      standardPrice: r.standard_price,
      costCurrency: currencyName === 'USD' ? 'USD' : currencyName === 'ARS' ? 'ARS' : 'OTHER',
      hasCost: r.standard_price > 0,
    });
  }
  return result;
}

// Rebuilding the full active-product name index is expensive (thousands
// of products) — cache it briefly, same reasoning as the other short-TTL
// caches in this feature (a newly-added/renamed product shows up within
// a couple of page loads, not instantly, which is an acceptable trade).
const NAME_INDEX_TTL_MS = 10 * 60 * 1000;

async function getActiveProductNameIndex(): Promise<Map<string, number>> {
  return withTtlCache('insumo-costs:name-index', NAME_INDEX_TTL_MS, async () => {
    const rows = await searchReadAll<{ id: number; name: string }>({
      model: 'product.product',
      domain: [['active', '=', true]],
      fields: ['name'],
    });
    const map = new Map<string, number>();
    for (const r of rows) {
      const key = normalizeName(r.name);
      if (!map.has(key)) map.set(key, r.id); // first match wins on a name collision
    }
    return map;
  });
}

/**
 * Resolves BOM-CSV insumo names (bom-csv.ts) to their live Odoo
 * `product_id`, by exact match on the same normalized name both sides
 * use — regla 4.1 ("cruzar por product_id, nunca por texto") still holds
 * downstream of this: once resolved, every further join uses the id, not
 * the name. An insumo whose CSV name doesn't resolve to any active Odoo
 * product is left out of the returned map — callers report it as a gap
 * rather than guessing a match.
 */
export async function resolveInsumoProductIds(insumoKeys: string[]): Promise<Map<string, number>> {
  if (insumoKeys.length === 0) return new Map();
  const index = await getActiveProductNameIndex();
  const result = new Map<string, number>();
  for (const key of insumoKeys) {
    const id = index.get(key);
    if (id !== undefined) result.set(key, id);
  }
  return result;
}
