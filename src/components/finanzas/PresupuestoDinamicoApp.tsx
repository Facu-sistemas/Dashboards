import { useState } from 'react';
import type { DehydratedState } from '@tanstack/react-query';
import QueryProvider from '../QueryProvider';
import { useApiQuery } from '../dashboard/useApiQuery';
import LastUpdated from '../shared/LastUpdated';
import CategoryInsumoTree from './CategoryInsumoTree';
import ComplianceSummaryChart from './ComplianceSummaryChart';
import FueraDeAlcanceTable from './FueraDeAlcanceTable';
import GapsPanel from './GapsPanel';
import ConsensoInputsForm from './ConsensoInputsForm';
import { monthLabel } from './presupuesto-dinamico-utils';
import type { PresupuestoDinamicoResult, FueraDeAlcanceResult, PresupuestoDinamicoInputs } from './types';

interface Props {
  initialYear: number;
  dehydratedState?: DehydratedState;
}

function yearOptions(initialYear: number): number[] {
  const currentYear = new Date().getUTCFullYear();
  const years = new Set([initialYear, currentYear, currentYear + 1]);
  return [...years].sort((a, b) => a - b);
}

const MONTH_NUMBERS = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'));

function PresupuestoDinamicoInner({ initialYear }: { initialYear: number }) {
  const [year, setYear] = useState(initialYear);
  const [monthFilter, setMonthFilter] = useState(''); // '' = todo el año; else "01".."12"
  const [showInputs, setShowInputs] = useState(false);
  const [recalculating, setRecalculating] = useState(false);

  const resumenQuery = useApiQuery<PresupuestoDinamicoResult>(
    ['presupuesto-dinamico-resumen', year],
    `/api/presupuesto-dinamico-resumen?${new URLSearchParams({ year: String(year) })}`
  );
  const fueraDeAlcanceQuery = useApiQuery<FueraDeAlcanceResult>(
    ['presupuesto-dinamico-fuera-de-alcance', year],
    `/api/presupuesto-dinamico-fuera-de-alcance?${new URLSearchParams({ year: String(year) })}`
  );
  const inputsQuery = useApiQuery<PresupuestoDinamicoInputs>(
    ['presupuesto-dinamico-inputs', year],
    `/api/presupuesto-dinamico-inputs?${new URLSearchParams({ year: String(year) })}`,
    { enabled: showInputs }
  );

  const data = resumenQuery.data;

  // "Recalcular": forces the server past its short in-memory TTL cache
  // (2-10 min depending on the sub-fetch — see cache.ts) instead of making
  // the user wait it out, e.g. right after confirming a purchase order or
  // fixing a cost in Odoo. The first request just discards its result —
  // its only job is to clear the cache — the refetches after it are what
  // actually update the UI, through react-query's normal state so
  // `dataUpdatedAt` (LastUpdated) stays accurate.
  async function handleRecalcular() {
    setRecalculating(true);
    try {
      await fetch(`/api/presupuesto-dinamico-resumen?${new URLSearchParams({ year: String(year), force: 'true' })}`, {
        headers: { Accept: 'application/json' },
      });
      await Promise.all([resumenQuery.refetch(), fueraDeAlcanceQuery.refetch()]);
    } finally {
      setRecalculating(false);
    }
  }

  // "Mes" narrows which month columns render, decoupled from "Año" (a
  // month number persists across year switches instead of resetting) —
  // purely a client-side view filter, the year's full data is already
  // fetched, so this never triggers a refetch.
  const allMonths = data?.months ?? [];
  const selectedMonthKey = monthFilter ? `${year}-${monthFilter}` : null;
  const displayMonths = selectedMonthKey ? allMonths.filter((m) => m === selectedMonthKey) : allMonths;
  const displaySummaryPoints = selectedMonthKey
    ? (data?.monthlyComplianceSummary ?? []).filter((p) => p.month === selectedMonthKey)
    : data?.monthlyComplianceSummary ?? [];
  const displayMissingConsensoMonths = selectedMonthKey
    ? (data?.missingConsensoMonths ?? []).filter((m) => m === selectedMonthKey)
    : data?.missingConsensoMonths ?? [];
  const displayMissingTcMonths = selectedMonthKey
    ? (data?.missingTcMonths ?? []).filter((m) => m === selectedMonthKey)
    : data?.missingTcMonths ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm text-slate-300">
            Año
            <select
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className="min-w-[8rem] rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-100 focus:border-brand-500 focus:outline-none"
            >
              {yearOptions(initialYear).map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm text-slate-300">
            Mes
            <select
              value={monthFilter}
              onChange={(e) => setMonthFilter(e.target.value)}
              className="min-w-[10rem] rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-100 focus:border-brand-500 focus:outline-none"
            >
              <option value="">Todo el año</option>
              {MONTH_NUMBERS.map((m) => (
                <option key={m} value={m}>
                  {monthLabel(`${year}-${m}`)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => setShowInputs((v) => !v)}
            className="rounded border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800"
          >
            {showInputs ? 'Ocultar' : 'Cargar'} consenso / TC
          </button>
          <button
            type="button"
            onClick={handleRecalcular}
            disabled={recalculating}
            className="rounded border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {recalculating ? 'Recalculando…' : 'Recalcular'}
          </button>
          <LastUpdated dataUpdatedAt={resumenQuery.dataUpdatedAt} />
        </div>
      </div>

      {resumenQuery.isError && (
        <p className="rounded border border-red-900 bg-red-950/50 p-3 text-sm text-red-300">
          No se pudieron cargar los datos: {(resumenQuery.error as Error).message}
        </p>
      )}

      {showInputs && (
        <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          {inputsQuery.isLoading ? (
            <div className="h-32 w-full animate-pulse-slow rounded-lg bg-slate-800/60" />
          ) : inputsQuery.data ? (
            <ConsensoInputsForm
              year={year}
              months={data?.months ?? []}
              inputs={inputsQuery.data}
              onSaved={() => {
                inputsQuery.refetch();
                resumenQuery.refetch();
              }}
            />
          ) : (
            <p className="text-sm text-red-400">No se pudieron cargar los inputs guardados.</p>
          )}
        </section>
      )}

      <section className="flex flex-col gap-4 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <h3 className="text-sm font-medium text-slate-300">% Cumplimiento total por mes</h3>
        {resumenQuery.isLoading ? (
          <div className="h-[240px] w-full animate-pulse-slow rounded-lg bg-slate-800/60" />
        ) : (
          <ComplianceSummaryChart points={displaySummaryPoints} />
        )}
      </section>

      <section className="flex flex-col gap-4 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <h3 className="text-sm font-medium text-slate-300">Categoría → Insumo, por mes / trimestre / año</h3>
        {resumenQuery.isLoading ? (
          <div className="h-64 w-full animate-pulse-slow rounded-lg bg-slate-800/60" />
        ) : (
          <CategoryInsumoTree categories={data?.categories ?? []} months={displayMonths} year={year} />
        )}
      </section>

      <section className="flex flex-col gap-4 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <h3 className="text-sm font-medium text-slate-300">Gaps pendientes</h3>
        {resumenQuery.isLoading ? (
          <div className="h-24 w-full animate-pulse-slow rounded-lg bg-slate-800/60" />
        ) : (
          <GapsPanel
            gaps={data?.gaps ?? []}
            missingConsensoMonths={displayMissingConsensoMonths}
            missingTcMonths={displayMissingTcMonths}
            modelosSinBomReconocido={data?.modelosSinBomReconocido ?? []}
          />
        )}
      </section>

      <section className="flex flex-col gap-4 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <h3 className="text-sm font-medium text-slate-300">Fuera de alcance (no es materia prima)</h3>
        {fueraDeAlcanceQuery.isLoading ? (
          <div className="h-32 w-full animate-pulse-slow rounded-lg bg-slate-800/60" />
        ) : (
          <FueraDeAlcanceTable categories={fueraDeAlcanceQuery.data?.categories ?? []} />
        )}
      </section>
    </div>
  );
}

/** Entry point mounted as an Astro client island (`client:load`), same pattern as the other Comercial tabs. */
export default function PresupuestoDinamicoApp({ dehydratedState, initialYear }: Props) {
  return (
    <QueryProvider dehydratedState={dehydratedState}>
      <PresupuestoDinamicoInner initialYear={initialYear} />
    </QueryProvider>
  );
}
