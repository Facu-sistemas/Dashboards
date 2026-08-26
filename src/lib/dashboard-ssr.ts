import { QueryClient, dehydrate, type DehydratedState } from '@tanstack/react-query';
import {
  getCategoryBudgetCompliance,
  getMonthlyComplianceTrend,
  getProductCategories,
} from './odoo/purchase-budget';
import { getUsdToArsRate } from './odoo/currency';
import type { DashboardFilters } from '../components/dashboard/types';

const TREND_MONTHS = 6;

/**
 * Runs entirely on the server (called from an .astro frontmatter). Prefetches
 * the same query keys the client island uses, then serializes the resulting
 * cache so the browser hydrates with data already in hand — no loading
 * skeleton flash on a fresh F5, while filter changes afterwards still hit
 * `/api/*` from the client as usual.
 */
export async function buildDehydratedState(filters: DashboardFilters): Promise<DehydratedState> {
  const queryClient = new QueryClient();

  await Promise.allSettled([
    queryClient.query({
      queryKey: ['purchase-budget', filters.month, filters.categoryId],
      queryFn: () => getCategoryBudgetCompliance(filters.month, filters.categoryId),
    }),
    queryClient.query({
      queryKey: ['purchase-budget-trend', TREND_MONTHS, filters.categoryId],
      queryFn: () => getMonthlyComplianceTrend(TREND_MONTHS, filters.categoryId),
    }),
    queryClient.query({ queryKey: ['categories'], queryFn: () => getProductCategories() }),
    queryClient.query({ queryKey: ['fx-rate'], queryFn: () => getUsdToArsRate() }),
  ]);

  return dehydrate(queryClient);
}
