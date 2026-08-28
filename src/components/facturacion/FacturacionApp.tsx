import { useState } from 'react';
import type { DehydratedState } from '@tanstack/react-query';
import QueryProvider from '../QueryProvider';
import { useApiQuery } from '../dashboard/useApiQuery';
import { monthOptions } from '../shared/monthOptions';
import KpiCard from '../shared/KpiCard';
import ComparisonTable from './ComparisonTable';
import FacturacionSplitPieChart from './FacturacionSplitPieChart';
import FacturacionTrendChart from './FacturacionTrendChart';
import type { FacturacionComparison, FacturacionSource, FacturacionTrendPoint } from './types';

interface Props {
  initialMonth: string;
  dehydratedState?: DehydratedState;
}

const TREND_MONTHS = 12;

const SOURCE_LABELS: Record<FacturacionSource, string> = {
  banco: 'Facturación 1 — Banco',
  efectivo: 'Facturación 2 — Efectivo',
};

function FacturacionInner({ initialMonth }: { initialMonth: string }) {
  const [month, setMonth] = useState(initialMonth);
  const [activeSource, setActiveSource] = useState<FacturacionSource>('banco');

  const query = useApiQuery<FacturacionComparison>(
    ['facturacion', month],
    `/api/facturacion?${new URLSearchParams({ month })}`
  );

  const trendQuery = useApiQuery<FacturacionTrendPoint[]>(
    ['facturacion-trend', TREND_MONTHS],
    `/api/facturacion-trend?${new URLSearchParams({ months: String(TREND_MONTHS) })}`
  );

  const data = query.data;
  const sum = data ? data.banco.total + data.efectivo.total : undefined;
  const activeResult = data?.[activeSource];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end gap-4 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <label className="flex flex-col gap-1 text-sm text-slate-300">
          Período
          <select
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="min-w-[10rem] rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-100 focus:border-brand-500 focus:outline-none"
          >
            {monthOptions().map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {query.isError && (
        <p className="rounded border border-red-900 bg-red-950/50 p-3 text-sm text-red-300">
          No se pudieron cargar los datos de facturación: {(query.error as Error).message}
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard label="Facturación 1 (Banco)" value={data?.banco.total} isLoading={query.isLoading} format="currency" />
        <KpiCard label="Facturación 2 (Efectivo)" value={data?.efectivo.total} isLoading={query.isLoading} format="currency" />
        <KpiCard label="Total (Banco + Efectivo)" value={sum} isLoading={query.isLoading} format="currency" />
      </div>

      <section className="flex flex-col gap-4 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <h3 className="text-sm font-medium text-slate-300">Tendencia mensual — últimos {TREND_MONTHS} meses</h3>
        {trendQuery.isLoading ? (
          <div className="h-[320px] w-full animate-pulse-slow rounded-lg bg-slate-800/60" />
        ) : trendQuery.isError ? (
          <p className="text-sm text-red-400">No se pudo cargar la tendencia mensual.</p>
        ) : (
          <FacturacionTrendChart points={trendQuery.data ?? []} />
        )}
      </section>

      <section className="flex flex-col gap-4 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <h3 className="text-sm font-medium text-slate-300">Composición del total — Banco vs. Efectivo</h3>
        {query.isLoading ? (
          <div className="h-[320px] w-full animate-pulse-slow rounded-lg bg-slate-800/60" />
        ) : data ? (
          <FacturacionSplitPieChart data={data} />
        ) : null}
      </section>

      <section className="flex flex-col gap-4 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-medium text-slate-300">{SOURCE_LABELS[activeSource]}</h3>
          <div className="inline-flex rounded-lg border border-slate-700 bg-slate-950 p-0.5 text-sm">
            {(Object.keys(SOURCE_LABELS) as FacturacionSource[]).map((source) => (
              <button
                key={source}
                type="button"
                onClick={() => setActiveSource(source)}
                className={`rounded-md px-3 py-1 transition-colors ${
                  activeSource === source ? 'bg-slate-800 text-slate-100' : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                {source === 'banco' ? 'Banco' : 'Efectivo'}
              </button>
            ))}
          </div>
        </div>
        <ComparisonTable lines={activeResult?.lines ?? []} isLoading={query.isLoading} />
      </section>
    </div>
  );
}

/** Entry point mounted as an Astro client island (`client:load`), same pattern as DashboardApp. */
export default function FacturacionApp({ dehydratedState, initialMonth }: Props) {
  return (
    <QueryProvider dehydratedState={dehydratedState}>
      <FacturacionInner initialMonth={initialMonth} />
    </QueryProvider>
  );
}
