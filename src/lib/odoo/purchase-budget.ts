import { searchReadAll } from './client';
import { getFronteraCompany, getComprasAnalyticAccountId } from './reference';
import type {
  CategoryBudgetStatus,
  ComplianceStatus,
  MonthlyCompliancePoint,
  OdooDomain,
  ProductCategoryOption,
  PurchaseCurrency,
} from './types';

// Tolerance bands for the semaphore, per KPI definition. Adjust here if the
// business agrees on different thresholds.
const GREEN_MAX_PCT = 110;
const YELLOW_MAX_PCT = 130;

function complianceStatus(pct: number | null): ComplianceStatus {
  if (pct === null) return 'no-budget';
  if (pct <= GREEN_MAX_PCT) return 'green';
  if (pct <= YELLOW_MAX_PCT) return 'yellow';
  return 'red';
}

function monthBounds(monthKey: string): { start: string; endExclusive: string } {
  const parts = monthKey.split('-').map(Number);
  const year = parts[0] ?? 0;
  const month = parts[1] ?? 1;
  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const endExclusive = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
  return { start, endExclusive };
}

/** Last `count` month keys ("YYYY-MM"), oldest first, ending at the given month (default: current). */
function lastMonthKeys(count: number, endingAt?: Date): string[] {
  const base = endingAt ?? new Date();
  const keys: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() - i, 1));
    keys.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return keys;
}

export async function getProductCategories(): Promise<ProductCategoryOption[]> {
  type Row = { id: number; name: string };
  const rows = await searchReadAll<Row>({
    model: 'product.category',
    fields: ['name'],
    order: 'name asc',
  });
  return rows.map((r) => ({ id: r.id, name: r.name }));
}

interface EnrichedSpendLine {
  month: string; // YYYY-MM
  categoryId: number;
  categoryName: string;
  currency: PurchaseCurrency;
  amount: number;
}

/**
 * Real purchase spend, read straight from `purchase.order.line` — confirmed
 * orders only (`order_id.state = 'purchase'`, not 'done': this Odoo's
 * workflow doesn't lock orders, so 'done' never applies here), scoped to
 * Frontera Living S.A. Amounts are NEVER converted between currencies —
 * each line keeps its own loading currency (ARS or USD), grouped
 * separately, by design (mixing them previously produced a wrong ranking
 * in production).
 */
async function fetchSpendLines(
  startDate: string,
  endDateExclusive: string,
  categoryId?: number
): Promise<EnrichedSpendLine[]> {
  const { companyId } = await getFronteraCompany();

  type LineRow = {
    id: number;
    price_subtotal: number;
    currency_id: [number, string];
    order_id: [number, string];
    product_id: [number, string] | false;
  };

  const domain: OdooDomain = [
    ['company_id', '=', companyId],
    ['order_id.state', '=', 'purchase'],
    ['order_id.date_order', '>=', startDate],
    ['order_id.date_order', '<', endDateExclusive],
  ];
  if (categoryId) domain.push(['product_id.categ_id', '=', categoryId]);

  const lines = await searchReadAll<LineRow>({
    model: 'purchase.order.line',
    domain,
    fields: ['price_subtotal', 'currency_id', 'order_id', 'product_id'],
  });

  const withProduct = lines.filter((l): l is LineRow & { product_id: [number, string] } => Boolean(l.product_id));

  const orderIds = [...new Set(withProduct.map((l) => l.order_id[0]))];
  const productIds = [...new Set(withProduct.map((l) => l.product_id[0]))];

  type OrderRow = { id: number; date_order: string };
  type ProductRow = { id: number; categ_id: [number, string] | false };

  const [orders, products] = await Promise.all([
    orderIds.length
      ? searchReadAll<OrderRow>({ model: 'purchase.order', domain: [['id', 'in', orderIds]], fields: ['date_order'] })
      : Promise.resolve([]),
    productIds.length
      ? searchReadAll<ProductRow>({ model: 'product.product', domain: [['id', 'in', productIds]], fields: ['categ_id'] })
      : Promise.resolve([]),
  ]);

  const orderDateById = new Map(orders.map((o) => [o.id, o.date_order]));
  const categIdByProductId = new Map(
    products.filter((p) => p.categ_id).map((p) => [p.id, (p.categ_id as [number, string])[0]])
  );

  // `product.product.categ_id`'s tuple label is the full hierarchical path
  // ("Materia Prima / Madera"), not the plain category name shown in the
  // filter dropdown ("Madera") or the one Accounting will likely use when
  // budget positions get named — re-read the clean `name` field directly
  // from product.category so both stay consistent.
  const categoryIds = [...new Set(categIdByProductId.values())];
  type CategoryRow = { id: number; name: string };
  const categories = categoryIds.length
    ? await searchReadAll<CategoryRow>({ model: 'product.category', domain: [['id', 'in', categoryIds]], fields: ['name'] })
    : [];
  const categoryNameById = new Map(categories.map((c) => [c.id, c.name]));

  const result: EnrichedSpendLine[] = [];
  for (const line of withProduct) {
    const categId = categIdByProductId.get(line.product_id[0]);
    const categoryName = categId !== undefined ? categoryNameById.get(categId) : undefined;
    const dateOrder = orderDateById.get(line.order_id[0]);
    if (categId === undefined || !categoryName || !dateOrder) continue; // orphaned reference, skip rather than mis-bucket

    const currency = line.currency_id[1] === 'USD' ? 'USD' : 'ARS';
    result.push({
      month: dateOrder.slice(0, 7),
      categoryId: categId,
      categoryName,
      currency,
      amount: line.price_subtotal,
    });
  }
  return result;
}

interface EnrichedBudgetLine {
  month: string;
  categoryName: string;
  amount: number;
}

/**
 * Purchase-category budgets under the COMPRAS analytic account. As of this
 * writing there is no data here yet (confirmed empty against the live
 * instance) — every category comes back "sin presupuesto cargado" until
 * Accounting loads it. `planned_amount` is assumed ARS (the company
 * currency); budgets for USD-loaded categories (chemicals) are
 * intentionally NOT matched here until it's confirmed what currency those
 * will be entered in — seeing "no budget" for now is correct, not a bug.
 */
async function fetchBudgetLines(startDate: string, endDateExclusive: string): Promise<EnrichedBudgetLine[]> {
  const analyticAccountId = await getComprasAnalyticAccountId();
  if (!analyticAccountId) return [];

  type BudgetLineRow = {
    id: number;
    general_budget_id: [number, string] | false;
    date_from: string;
    planned_amount: number;
  };

  const rows = await searchReadAll<BudgetLineRow>({
    model: 'crossovered.budget.lines',
    domain: [
      ['analytic_account_id', '=', analyticAccountId],
      ['date_from', '<', endDateExclusive],
      ['date_to', '>=', startDate],
    ],
    fields: ['general_budget_id', 'date_from', 'planned_amount'],
  });

  return rows
    .filter((r): r is BudgetLineRow & { general_budget_id: [number, string] } => Boolean(r.general_budget_id))
    .map((r) => ({
      month: r.date_from.slice(0, 7),
      categoryName: r.general_budget_id[1],
      amount: r.planned_amount,
    }));
}

function normalizeCategoryName(name: string): string {
  return name.trim().toLowerCase();
}

/** Real vs. budget for every category with activity in one month, split by currency (never blended). */
export async function getCategoryBudgetCompliance(
  monthKey: string,
  categoryId?: number
): Promise<CategoryBudgetStatus[]> {
  const { start, endExclusive } = monthBounds(monthKey);

  const [spendLines, budgetLines] = await Promise.all([
    fetchSpendLines(start, endExclusive, categoryId),
    fetchBudgetLines(start, endExclusive),
  ]);

  const budgetByCategoryName = new Map<string, number>();
  for (const b of budgetLines) {
    const key = normalizeCategoryName(b.categoryName);
    budgetByCategoryName.set(key, (budgetByCategoryName.get(key) ?? 0) + b.amount);
  }

  const spendByCategory = new Map<string, { categoryId: number; categoryName: string; currency: PurchaseCurrency; amount: number }>();
  for (const line of spendLines) {
    const key = `${line.categoryId}|${line.currency}`;
    const existing = spendByCategory.get(key);
    if (existing) {
      existing.amount += line.amount;
    } else {
      spendByCategory.set(key, {
        categoryId: line.categoryId,
        categoryName: line.categoryName,
        currency: line.currency,
        amount: line.amount,
      });
    }
  }

  const results: CategoryBudgetStatus[] = [];
  for (const entry of spendByCategory.values()) {
    // Budget matching is currency-agnostic on purpose only for ARS
    // categories — see fetchBudgetLines' doc comment on why USD categories
    // don't attempt a match yet.
    const budgetAmount =
      entry.currency === 'ARS' ? budgetByCategoryName.get(normalizeCategoryName(entry.categoryName)) ?? null : null;
    const compliancePct = budgetAmount && budgetAmount > 0 ? (entry.amount / budgetAmount) * 100 : null;

    results.push({
      categoryId: entry.categoryId,
      categoryName: entry.categoryName,
      currency: entry.currency,
      realAmount: entry.amount,
      budgetAmount: budgetAmount && budgetAmount > 0 ? budgetAmount : null,
      compliancePct,
      status: complianceStatus(compliancePct),
    });
  }

  return results.sort((a, b) => b.realAmount - a.realAmount);
}

/** Monthly aggregate compliance trend, kept separate per currency (ARS totals, USD totals). */
export async function getMonthlyComplianceTrend(monthsBack: number, categoryId?: number): Promise<MonthlyCompliancePoint[]> {
  const months = lastMonthKeys(monthsBack);
  const firstMonth = months[0] ?? lastMonthKeys(1)[0]!;
  const lastMonth = months[months.length - 1] ?? firstMonth;
  const rangeStart = monthBounds(firstMonth).start;
  const rangeEndExclusive = monthBounds(lastMonth).endExclusive;

  const [spendLines, budgetLines] = await Promise.all([
    fetchSpendLines(rangeStart, rangeEndExclusive, categoryId),
    fetchBudgetLines(rangeStart, rangeEndExclusive),
  ]);

  const budgetByMonth = new Map<string, number>(); // "YYYY-MM" -> ARS total (only ARS categories match, see above)
  for (const b of budgetLines) {
    budgetByMonth.set(b.month, (budgetByMonth.get(b.month) ?? 0) + b.amount);
  }

  const realByMonthCurrency = new Map<string, number>(); // "YYYY-MM|CUR" -> total
  const realArsByMonth = new Map<string, number>(); // for compliance, ARS-only spend vs ARS-only budget
  for (const l of spendLines) {
    const key = `${l.month}|${l.currency}`;
    realByMonthCurrency.set(key, (realByMonthCurrency.get(key) ?? 0) + l.amount);
    if (l.currency === 'ARS') {
      realArsByMonth.set(l.month, (realArsByMonth.get(l.month) ?? 0) + l.amount);
    }
  }

  const points: MonthlyCompliancePoint[] = [];
  for (const month of months) {
    for (const currency of ['ARS', 'USD'] as const) {
      const totalReal = realByMonthCurrency.get(`${month}|${currency}`) ?? 0;
      const totalBudget = currency === 'ARS' ? budgetByMonth.get(month) ?? null : null;
      const compliancePct = totalBudget && totalBudget > 0 ? (realArsByMonth.get(month) ?? 0) / totalBudget * 100 : null;
      points.push({ month, currency, totalReal, totalBudget, compliancePct });
    }
  }
  return points;
}
