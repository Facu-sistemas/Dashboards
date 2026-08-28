import { useState } from 'react';
import type { DehydratedState } from '@tanstack/react-query';
import QueryProvider from '../QueryProvider';
import { useApiQuery } from '../dashboard/useApiQuery';
import { useChartTheme } from '../shared/useChartTheme';
import TopProductsChart from './TopProductsChart';
import type { TopProductsRange, TopProductsResult } from './types';

interface Props {
  initialRange: TopProductsRange;
  dehydratedState?: DehydratedState;
}

const RANGE_OPTIONS: { value: TopProductsRange; label: string }[] = [
  { value: 'all', label: 'Histórico completo' },
  { value: 'this-year', label: 'Este año' },
  { value: 'last-12-months', label: 'Últimos 12 meses' },
  { value: 'last-6-months', label: 'Últimos 6 meses' },
];

function TopProductsInner({ initialRange }: { initialRange: TopProductsRange }) {
  const [range, setRange] = useState<TopProductsRange>(initialRange);
  const chartTheme = useChartTheme();

  const query = useApiQuery<TopProductsResult>(
    ['top-products', range],
    `/api/top-products?${new URLSearchParams({ range })}`
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end gap-4 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <label className="flex flex-col gap-1 text-sm text-slate-300">
          Período
          <select
            value={range}
            onChange={(e) => setRange(e.target.value as TopProductsRange)}
            className="min-w-[10rem] rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-100 focus:border-brand-500 focus:outline-none"
          >
            {RANGE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {query.isError && (
        <p className="rounded border border-red-900 bg-red-950/50 p-3 text-sm text-red-300">
          No se pudieron cargar los datos: {(query.error as Error).message}
        </p>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {query.isLoading ? (
          <>
            <div className="h-[420px] w-full animate-pulse-slow rounded-lg bg-slate-800/60" />
            <div className="h-[420px] w-full animate-pulse-slow rounded-lg bg-slate-800/60" />
          </>
        ) : (
          <>
            <TopProductsChart title="Colchones" rows={query.data?.colchones ?? []} color={chartTheme.primary} />
            <TopProductsChart title="Living" rows={query.data?.living ?? []} color={chartTheme.secondary} />
          </>
        )}
      </div>
    </div>
  );
}

/** Entry point mounted as an Astro client island (`client:load`), same pattern as the other tabs. */
export default function TopProductsApp({ dehydratedState, initialRange }: Props) {
  return (
    <QueryProvider dehydratedState={dehydratedState}>
      <TopProductsInner initialRange={initialRange} />
    </QueryProvider>
  );
}
