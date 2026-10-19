import { useState } from 'react';
import type { DehydratedState } from '@tanstack/react-query';
import QueryProvider from '@/components/QueryProvider';
import { useApiQuery } from '@/components/dashboard/useApiQuery';
import { addDaysIso } from '@/lib/date';
import LastUpdated from '@/components/shared/LastUpdated';
import PlanProduccionCard from './PlanProduccionCard';
import PlanProduccionTrendChart from './PlanProduccionTrendChart';
import PlanProduccionAcumuladoTable from './PlanProduccionAcumuladoTable';
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

const EMPTY_GAUGE: PlanProduccionGauge = { planificado: 0, planificadoAHoy: 0, producido: 0, cerrado: 0, objetivo: 0, planificadoPct: 0, cumplimientoPct: 0, cerradoPct: 0 };
const EMPTY_DIARIA: PlanProduccionDailyRow[] = [];

function PlanProduccionInner({ initialPeriodKind, initialDate }: { initialPeriodKind: PlanProduccionPeriodKind; initialDate: string }) {
  const [periodKind, setPeriodKind] = useState<PlanProduccionPeriodKind>(initialPeriodKind);
  const [date, setDate] = useState<string>(initialDate);

  const query = useApiQuery<PlanProduccionResult>(
    ['plan-produccion', periodKind, date],
    `/api/plan-produccion?${new URLSearchParams({ period: periodKind, date })}`
  );

  const diariaQuery = useApiQuery<PlanProduccionDailyRow[]>(
    ['plan-produccion-diaria', periodKind, date],
    `/api/plan-produccion-diaria?${new URLSearchParams({ period: periodKind, date })}`
  );

  // El acumulado siempre se arma por MES (o por año en la vista Año), nunca
  // por semana: "Día"/"Semana" comparten semana ISO en `diariaQuery` (ver
  // trendBounds en plan-produccion.ts, pensado para el gráfico de
  // tendencia), pero eso hacía que el acumulado se cortara a mitad de mes y
  // pareciera "retroceder" al cambiar de día seleccionado — confirmado con
  // el usuario que es un comportamiento raro. Esta query es independiente
  // del período elegido arriba para evitar justamente eso.
  const acumuladoPeriodKind: PlanProduccionPeriodKind = periodKind === 'year' ? 'year' : 'month';
  const acumuladoQuery = useApiQuery<PlanProduccionDailyRow[]>(
    ['plan-produccion-diaria', acumuladoPeriodKind, date],
    `/api/plan-produccion-diaria?${new URLSearchParams({ period: acumuladoPeriodKind, date })}`
  );

  // Hasta qué fecha se corta el acumulado. Para "Día"/"Semana" es la fecha
  // (o el domingo de la semana) que el usuario eligió arriba, no la fecha
  // real de hoy — si no, elegir el día 9 pero ver el acumulado hasta el 19
  // (hoy) confunde: parece que "viaja al futuro" respecto de lo que se
  // seleccionó. Para "Mes"/"Año" no hay un día puntual elegido, así que se
  // usa hoy (acotado solo por si ese mes/año ya terminó o todavía no
  // empezó, que ya lo resuelve el propio filtro `<= cutoff` de la tabla).
  const today = new Date().toISOString().slice(0, 10);
  const candidate = periodKind === 'day' ? date : periodKind === 'week' ? addDaysIso(date, 6) : today;
  const cutoff = candidate < today ? candidate : today;

  const trendTitle =
    periodKind === 'year'
      ? `Tendencia mensual ${date.slice(0, 4)}`
      : periodKind === 'month'
        ? `Tendencia diaria ${date.slice(0, 7)}`
        : `Tendencia diaria — semana ${dateToWeekValue(date)}`;

  const chartTitle = periodKind === 'year' ? trendTitle : `${trendTitle} · solo días laborables`;

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
          <PlanProduccionCard title="Living" gauge={query.data?.living ?? EMPTY_GAUGE} unit="UE" periodKind={periodKind} />
          <PlanProduccionCard title="Colchones" gauge={query.data?.colchones ?? EMPTY_GAUGE} unit="u" periodKind={periodKind} />
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
          <PlanProduccionTrendChart title={`Living — ${chartTitle}`} rows={diariaQuery.data ?? EMPTY_DIARIA} pick={(r) => r.living} monthly={periodKind === 'year'} soloLaborables />
          <PlanProduccionTrendChart title={`Colchones — ${chartTitle}`} rows={diariaQuery.data ?? EMPTY_DIARIA} pick={(r) => r.colchones} monthly={periodKind === 'year'} soloLaborables />
        </div>
      )}

      {acumuladoQuery.isError && (
        <p className="rounded border border-red-900 bg-red-950/50 p-3 text-sm text-red-300">
          No se pudo cargar el acumulado: {(acumuladoQuery.error as Error).message}
        </p>
      )}

      {acumuladoQuery.isLoading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="h-56 w-full animate-pulse-slow rounded-lg bg-slate-800/60" />
          <div className="h-56 w-full animate-pulse-slow rounded-lg bg-slate-800/60" />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <PlanProduccionAcumuladoTable title={`Living — acumulado ${acumuladoPeriodKind === 'year' ? 'mensual' : 'del mes'}`} rows={acumuladoQuery.data ?? EMPTY_DIARIA} pick={(r) => r.living} monthly={acumuladoPeriodKind === 'year'} unit="UE" cutoff={cutoff} />
          <PlanProduccionAcumuladoTable title={`Colchones — acumulado ${acumuladoPeriodKind === 'year' ? 'mensual' : 'del mes'}`} rows={acumuladoQuery.data ?? EMPTY_DIARIA} pick={(r) => r.colchones} monthly={acumuladoPeriodKind === 'year'} unit="u" cutoff={cutoff} />
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
