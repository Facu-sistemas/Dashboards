import { useState } from 'react';
import type { DehydratedState } from '@tanstack/react-query';
import QueryProvider from '../QueryProvider';
import { useApiQuery } from '../dashboard/useApiQuery';
import OeeGauge from './OeeGauge';
import OeeOrderList from './OeeOrderList';
import type { OeeCategoryFilter, OeeGranularity, OeeResult } from './types';

interface Props {
  initialGranularity: OeeGranularity;
  initialCategory: OeeCategoryFilter;
  dehydratedState?: DehydratedState;
}

const GRANULARITY_OPTIONS: { value: OeeGranularity; label: string }[] = [
  { value: 'day', label: 'Hoy' },
  { value: 'week', label: 'Esta semana' },
  { value: 'month', label: 'Este mes' },
];

const CATEGORY_OPTIONS: { value: OeeCategoryFilter; label: string }[] = [
  { value: 'all', label: 'Todos los productos' },
  { value: 'colchones', label: 'Colchones' },
  { value: 'living', label: 'Living' },
];

const units = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });

function OeeInner({ initialGranularity, initialCategory }: { initialGranularity: OeeGranularity; initialCategory: OeeCategoryFilter }) {
  const [granularity, setGranularity] = useState<OeeGranularity>(initialGranularity);
  const [category, setCategory] = useState<OeeCategoryFilter>(initialCategory);

  const query = useApiQuery<OeeResult>(
    ['oee', granularity, category],
    `/api/oee?${new URLSearchParams({ granularity, category })}`
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end gap-4 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <label className="flex flex-col gap-1 text-sm text-slate-300">
          Período
          <select
            value={granularity}
            onChange={(e) => setGranularity(e.target.value as OeeGranularity)}
            className="min-w-[9rem] rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-100 focus:border-brand-500 focus:outline-none"
          >
            {GRANULARITY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm text-slate-300">
          Producto
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as OeeCategoryFilter)}
            className="min-w-[10rem] rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-100 focus:border-brand-500 focus:outline-none"
          >
            {CATEGORY_OPTIONS.map((o) => (
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

      <section className="flex flex-col items-center gap-3 rounded-lg border border-slate-800 bg-slate-900 p-6">
        {query.isLoading ? (
          <div className="h-[200px] w-full max-w-xs animate-pulse-slow rounded-lg bg-slate-800/60" />
        ) : (
          <>
            <OeeGauge pct={query.data?.pctComplete ?? 0} />
            <p className="text-sm text-slate-400">
              {units.format(query.data?.producedQty ?? 0)} unidades producidas / {units.format(query.data?.plannedQty ?? 0)} planificadas
            </p>
          </>
        )}
      </section>

      {query.isLoading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="h-72 w-full animate-pulse-slow rounded-lg bg-slate-800/60" />
          <div className="h-72 w-full animate-pulse-slow rounded-lg bg-slate-800/60" />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <OeeOrderList
            title="Cerradas en este período"
            orders={query.data?.closedOrders ?? []}
            total={query.data?.closedTotal ?? 0}
            emptyLabel="Nada cerrado todavía en este período."
          />
          <OeeOrderList
            title="Pendientes de cerrar"
            orders={query.data?.pendingOrders ?? []}
            total={query.data?.pendingTotal ?? 0}
            emptyLabel="No hay órdenes abiertas."
          />
        </div>
      )}
    </div>
  );
}

/** Entry point mounted as an Astro client island (`client:load`), same pattern as the other tabs. */
export default function OeeApp({ dehydratedState, initialGranularity, initialCategory }: Props) {
  return (
    <QueryProvider dehydratedState={dehydratedState}>
      <OeeInner initialGranularity={initialGranularity} initialCategory={initialCategory} />
    </QueryProvider>
  );
}
