import { useState } from 'react';
import type { DehydratedState } from '@tanstack/react-query';
import QueryProvider from '../QueryProvider';
import { useApiQuery } from '../dashboard/useApiQuery';
import LastUpdated from '../shared/LastUpdated';
import PlanProduccionCard from './PlanProduccionCard';
import PlanProduccionTrendChart from './PlanProduccionTrendChart';
import { dateToWeekValue, weekValueToDate } from './isoWeek';
import type { PlanProduccionDailyRow, PlanProduccionGauge, PlanProduccionPeriodKind, PlanProduccionResult } from './types';

interface Props {
  initialPeriodKind: PlanProduccionPeriodKind;
  initialDate: string;
  dehydratedState?: DehydratedState;
}

const PERIOD_OPTIONS: { value: PlanProduccionPeriodKind; label: string }[] = [
  { value: 'day', label: 'Día' },
  { value: 'week', label: 'Semana' },
  { value: 'month', label: 'Mes' },
  { value: 'year', label: 'Año' },
];

const EMPTY_GAUGE: PlanProduccionGauge = { planificado: 0, producido: 0, cerrado: 0, cumplimientoPct: 0, cerradoPct: 0 };
const EMPTY_DIARIA: PlanProduccionDailyRow[] = [];

function PlanProduccionInner({ initialPeriodKind, initialDate }: { initialPeriodKind: PlanProduccionPeriodKind; initialDate: string }) {
  const [periodKind, setPeriodKind] = useState<PlanProduccionPeriodKind>(initialPeriodKind);
  const [date, setDate] = useState<string>(initialDate);

  const query = useApiQuery<PlanProduccionResult>(
    ['plan-produccion', periodKind, date],
    `/api/plan-produccion?${new URLSearchParams({ period: periodKind, date })}`
  );

  const diariaQuery = useApiQuery<PlanProduccionDailyRow[]>(
    ['plan-produccion-diaria', date.slice(0, 7)],
    `/api/plan-produccion-diaria?${new URLSearchParams({ date })}`
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <div className="flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-1 text-sm text-slate-300">
            Período
            <select
              value={periodKind}
              onChange={(e) => setPeriodKind(e.target.value as PlanProduccionPeriodKind)}
              className="min-w-[9rem] rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-100 focus:border-brand-500 focus:outline-none"
            >
              {PERIOD_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>

          {periodKind === 'day' && (
            <label className="flex flex-col gap-1 text-sm text-slate-300">
              Fecha
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-100 focus:border-brand-500 focus:outline-none"
              />
            </label>
          )}

          {periodKind === 'week' && (
            <label className="flex flex-col gap-1 text-sm text-slate-300">
              Semana
              <input
                type="week"
                value={dateToWeekValue(date)}
                onChange={(e) => setDate(weekValueToDate(e.target.value))}
                className="rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-100 focus:border-brand-500 focus:outline-none"
              />
            </label>
          )}

          {periodKind === 'month' && (
            <label className="flex flex-col gap-1 text-sm text-slate-300">
              Mes
              <input
                type="month"
                value={date.slice(0, 7)}
                onChange={(e) => setDate(`${e.target.value}-01`)}
                className="rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-100 focus:border-brand-500 focus:outline-none"
              />
            </label>
          )}

          {periodKind === 'year' && (
            <label className="flex flex-col gap-1 text-sm text-slate-300">
              Año
              <input
                type="number"
                value={date.slice(0, 4)}
                onChange={(e) => setDate(`${e.target.value}-01-01`)}
                className="w-24 rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-100 focus:border-brand-500 focus:outline-none"
              />
            </label>
          )}
        </div>

        <LastUpdated dataUpdatedAt={query.dataUpdatedAt} />
      </div>

      {query.isError && (
        <p className="rounded border border-red-900 bg-red-950/50 p-3 text-sm text-red-300">
          No se pudieron cargar los datos: {(query.error as Error).message}
        </p>
      )}

      {query.isLoading ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="h-40 w-full animate-pulse-slow rounded-lg bg-slate-800/60" />
          <div className="h-40 w-full animate-pulse-slow rounded-lg bg-slate-800/60" />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <PlanProduccionCard title="Living" gauge={query.data?.living ?? EMPTY_GAUGE} unit="UE" />
          <PlanProduccionCard title="Colchones" gauge={query.data?.colchones ?? EMPTY_GAUGE} unit="u" />
        </div>
      )}

      {diariaQuery.isError && (
        <p className="rounded border border-red-900 bg-red-950/50 p-3 text-sm text-red-300">
          No se pudo cargar la tendencia diaria: {(diariaQuery.error as Error).message}
        </p>
      )}

      {diariaQuery.isLoading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="h-72 w-full animate-pulse-slow rounded-lg bg-slate-800/60" />
          <div className="h-72 w-full animate-pulse-slow rounded-lg bg-slate-800/60" />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <PlanProduccionTrendChart title={`Living — Tendencia ${date.slice(0, 7)}`} rows={diariaQuery.data ?? EMPTY_DIARIA} pick={(r) => r.living} unit="UE" />
          <PlanProduccionTrendChart title={`Colchones — Tendencia ${date.slice(0, 7)}`} rows={diariaQuery.data ?? EMPTY_DIARIA} pick={(r) => r.colchones} unit="u" />
        </div>
      )}
    </div>
  );
}

/** Entry point mounted as an Astro client island (`client:load`), same pattern as the other tabs. */
export default function PlanProduccionApp({ dehydratedState, initialPeriodKind, initialDate }: Props) {
  return (
    <QueryProvider dehydratedState={dehydratedState}>
      <PlanProduccionInner initialPeriodKind={initialPeriodKind} initialDate={initialDate} />
    </QueryProvider>
  );
}
