import { searchReadAll } from './client';

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
