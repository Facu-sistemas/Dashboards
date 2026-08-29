import { useMemo, useState } from 'react';
import type { DehydratedState } from '@tanstack/react-query';
import QueryProvider from '../QueryProvider';
import FilterBar from './FilterBar';
import FxRateBadge from './FxRateBadge';
import LastUpdated from '../shared/LastUpdated';
import CurrencySection from './CurrencySection';
import ComplianceTrendChart from './ComplianceTrendChart';
import { useApiQuery } from './useApiQuery';
import type { CategoryBudgetStatus, DashboardFilters, MonthlyCompliancePoint } from './types';

interface Props {
  initialFilters: DashboardFilters;
  dehydratedState?: DehydratedState;
}

const TREND_MONTHS = 6;

function DashboardInner({ initialFilters }: Pick<Props, 'initialFilters'>) {
  const [filters, setFilters] = useState<DashboardFilters>(initialFilters);

  const complianceQuery = useApiQuery<CategoryBudgetStatus[]>(
    ['purchase-budget', filters.month, filters.categoryId],
    `/api/purchase-budget?${new URLSearchParams({
      month: filters.month,
      ...(filters.categoryId ? { category_id: String(filters.categoryId) } : {}),
    })}`
  );

  const trendQuery = useApiQuery<MonthlyCompliancePoint[]>(
    ['purchase-budget-trend', TREND_MONTHS, filters.categoryId],
    `/api/purchase-budget-trend?${new URLSearchParams({
      months: String(TREND_MONTHS),
      ...(filters.categoryId ? { category_id: String(filters.categoryId) } : {}),
    })}`
  );

  const arsRows = useMemo(() => complianceQuery.data?.filter((r) => r.currency === 'ARS') ?? [], [complianceQuery.data]);
  const usdRows = useMemo(() => complianceQuery.data?.filter((r) => r.currency === 'USD') ?? [], [complianceQuery.data]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <FilterBar filters={filters} onChange={setFilters} />
        <div className="flex items-center gap-3">
          <FxRateBadge />
          <LastUpdated dataUpdatedAt={complianceQuery.dataUpdatedAt} />
        </div>
      </div>

      {complianceQuery.isError && (
        <p className="rounded border border-red-900 bg-red-950/50 p-3 text-sm text-red-300">
          No se pudieron cargar los datos de compras: {(complianceQuery.error as Error).message}
        </p>
      )}

      <CurrencySection currency="ARS" rows={arsRows} isLoading={complianceQuery.isLoading} />
      <CurrencySection currency="USD" rows={usdRows} isLoading={complianceQuery.isLoading} />

      <section className="flex flex-col gap-4 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <h2 className="text-sm font-medium text-slate-300">Tendencia mensual — últimos {TREND_MONTHS} meses</h2>
        {trendQuery.isLoading ? (
          <div className="h-[280px] w-full animate-pulse-slow rounded-lg bg-slate-800/60" />
        ) : trendQuery.isError ? (
          <p className="text-sm text-red-400">No se pudo cargar la tendencia mensual.</p>
        ) : (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <ComplianceTrendChart currency="ARS" points={trendQuery.data ?? []} />
            <ComplianceTrendChart currency="USD" points={trendQuery.data ?? []} />
          </div>
        )}
      </section>
    </div>
  );
}

/**
 * Entry point mounted as an Astro client island (`client:load`). Filter
 * changes re-fetch through the local `/api/*` routes without a full page
 * navigation; the first render's data comes from SSR via `dehydratedState`
 * so there's no loading flash on a fresh F5.
 */
export default function DashboardApp({ dehydratedState, ...rest }: Props) {
  return (
    <QueryProvider dehydratedState={dehydratedState}>
      <DashboardInner {...rest} />
    </QueryProvider>
  );
}
