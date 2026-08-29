import { useState } from 'react';
import type { DehydratedState } from '@tanstack/react-query';
import QueryProvider from '../QueryProvider';
import { useApiQuery } from '../dashboard/useApiQuery';
import LastUpdated from '../shared/LastUpdated';
import RawMaterialTable from './RawMaterialTable';
import MaterialStatRow from './MaterialStatRow';
import MaterialHistoryChart from './MaterialHistoryChart';
import type { ConsumptionLookbackDays, MaterialHistory, RawMaterialConsumptionResult, RawMaterialRow } from './types';

interface Props {
  initialCategoryId: number | null;
  initialLookbackDays: ConsumptionLookbackDays;
  initialOnlyLow: boolean;
  dehydratedState?: DehydratedState;
}

const LOOKBACK_OPTIONS: { value: ConsumptionLookbackDays; label: string }[] = [
  { value: 30, label: 'Últimos 30 días' },
  { value: 60, label: 'Últimos 60 días' },
  { value: 90, label: 'Últimos 90 días' },
  { value: 180, label: 'Últimos 180 días' },
];

function RawMaterialConsumptionInner({
  initialCategoryId,
  initialLookbackDays,
  initialOnlyLow,
}: {
  initialCategoryId: number | null;
  initialLookbackDays: ConsumptionLookbackDays;
  initialOnlyLow: boolean;
}) {
  const [categoryId, setCategoryId] = useState<number | null>(initialCategoryId);
  const [lookbackDays, setLookbackDays] = useState<ConsumptionLookbackDays>(initialLookbackDays);
  const [onlyLow, setOnlyLow] = useState(initialOnlyLow);
  const [selected, setSelected] = useState<RawMaterialRow | null>(null);

  const query = useApiQuery<RawMaterialConsumptionResult>(
    ['raw-material-consumption', categoryId, lookbackDays, onlyLow],
    `/api/raw-material-consumption?${new URLSearchParams({
      ...(categoryId ? { category_id: String(categoryId) } : {}),
      lookback_days: String(lookbackDays),
      only_low: String(onlyLow),
    })}`
  );

  const historyQuery = useApiQuery<MaterialHistory>(
    ['raw-material-history', selected?.productId ?? null],
    selected ? `/api/raw-material-history?product_id=${selected.productId}` : '',
    { enabled: selected !== null }
  );

  const categories = query.data?.categories ?? [];
  const rows = query.data?.rows ?? [];
  const lowCount = query.data?.lowCount ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1 text-sm text-slate-300">
          Categoría de materia prima
          <select
            value={categoryId ?? ''}
            onChange={(e) => setCategoryId(e.target.value ? Number(e.target.value) : null)}
            className="min-w-[12rem] rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-100 focus:border-brand-500 focus:outline-none"
          >
            <option value="">Todas</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm text-slate-300">
          Ventana de consumo
          <select
            value={lookbackDays}
            onChange={(e) => setLookbackDays(Number(e.target.value) as ConsumptionLookbackDays)}
            className="min-w-[10rem] rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-100 focus:border-brand-500 focus:outline-none"
          >
            {LOOKBACK_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-2 pb-1.5 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={onlyLow}
            onChange={(e) => setOnlyLow(e.target.checked)}
            className="h-4 w-4 rounded border-slate-700 bg-slate-950 accent-brand-500"
          />
          Solo en alerta
        </label>
        </div>

        <LastUpdated dataUpdatedAt={query.dataUpdatedAt} />
      </div>

      {query.isError && (
        <p className="rounded border border-red-900 bg-red-950/50 p-3 text-sm text-red-300">
          No se pudieron cargar los datos: {(query.error as Error).message}
        </p>
      )}

      <section className="flex flex-col gap-4 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-medium text-slate-300">Ordenado por urgencia (menos días hasta quiebre primero)</h3>
          {!query.isLoading && (
            <span className={lowCount > 0 ? 'text-sm text-red-400' : 'text-sm text-slate-500'}>
              {lowCount} insumo{lowCount === 1 ? '' : 's'} en alerta
            </span>
          )}
        </div>
        {query.isLoading ? (
          <div className="h-64 w-full animate-pulse-slow rounded-lg bg-slate-800/60" />
        ) : (
          <RawMaterialTable rows={rows} selectedId={selected?.productId ?? null} onSelect={setSelected} />
        )}
      </section>

      {selected && (
        <section className="flex flex-col gap-4 rounded-lg border border-slate-800 bg-slate-900 p-4">
          <h3 className="text-sm font-medium text-slate-300">{selected.productName}</h3>

          <MaterialStatRow material={selected} />

          <div>
            <h4 className="mb-2 text-xs uppercase tracking-wide text-slate-500">Tendencia de consumo mensual</h4>
            {historyQuery.isLoading ? (
              <div className="h-[280px] w-full animate-pulse-slow rounded-lg bg-slate-800/60" />
            ) : historyQuery.isError ? (
              <p className="text-sm text-red-400">No se pudo cargar el historial de {selected.productName}.</p>
            ) : historyQuery.data ? (
              <MaterialHistoryChart points={historyQuery.data.points} reorderPoint={selected.reorderPoint} />
            ) : null}
          </div>
        </section>
      )}
    </div>
  );
}

/** Entry point mounted as an Astro client island (`client:load`), same pattern as the other tabs. */
export default function RawMaterialConsumptionApp({
  dehydratedState,
  initialCategoryId,
  initialLookbackDays,
  initialOnlyLow,
}: Props) {
  return (
    <QueryProvider dehydratedState={dehydratedState}>
      <RawMaterialConsumptionInner
        initialCategoryId={initialCategoryId}
        initialLookbackDays={initialLookbackDays}
        initialOnlyLow={initialOnlyLow}
      />
    </QueryProvider>
  );
}
