import { useState } from 'react';
import type { DehydratedState } from '@tanstack/react-query';
import QueryProvider from '../QueryProvider';
import { useApiQuery } from '../dashboard/useApiQuery';
import OeeGaugeCard from './OeeGaugeCard';
import OeeMonthlySummary from './OeeMonthlySummary';
import OeeOrderList from './OeeOrderList';
import LastUpdated from '../shared/LastUpdated';
import { dateToWeekValue, weekValueToDate } from './isoWeek';
import type { OeeCategoryGauge, OeePeriodKind, OeeResult } from './types';

interface Props {
  initialPeriodKind: OeePeriodKind;
  initialDate: string;
  dehydratedState?: DehydratedState;
}

const PERIOD_OPTIONS: { value: OeePeriodKind; label: string }[] = [
  { value: 'day', label: 'Día' },
  { value: 'week', label: 'Semana' },
  { value: 'month', label: 'Mes' },
];

const EMPTY_GAUGE: OeeCategoryGauge = { planned: 0, produced: 0, pctComplete: 0 };

function OeeInner({ initialPeriodKind, initialDate }: { initialPeriodKind: OeePeriodKind; initialDate: string }) {
  const [periodKind, setPeriodKind] = useState<OeePeriodKind>(initialPeriodKind);
  const [date, setDate] = useState<string>(initialDate);

  const query = useApiQuery<OeeResult>(
    ['oee', periodKind, date],
    `/api/oee?${new URLSearchParams({ period: periodKind, date })}`
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1 text-sm text-slate-300">
          Período
          <select
            value={periodKind}
            onChange={(e) => setPeriodKind(e.target.value as OeePeriodKind)}
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
        </div>

        <LastUpdated dataUpdatedAt={query.dataUpdatedAt} />
      </div>

      {query.isError && (
        <p className="rounded border border-red-900 bg-red-950/50 p-3 text-sm text-red-300">
          No se pudieron cargar los datos: {(query.error as Error).message}
        </p>
      )}

      {query.isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="h-56 w-full animate-pulse-slow rounded-lg bg-slate-800/60" />
          <div className="h-56 w-full animate-pulse-slow rounded-lg bg-slate-800/60" />
          <div className="h-56 w-full animate-pulse-slow rounded-lg bg-slate-800/60" />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <OeeGaugeCard title="Colchones" gauge={query.data?.colchones ?? EMPTY_GAUGE} />
          <OeeGaugeCard title="Living" gauge={query.data?.living ?? EMPTY_GAUGE} />
          <OeeGaugeCard title="Todos los productos" gauge={query.data?.total ?? EMPTY_GAUGE} />
        </div>
      )}

      {query.isLoading ? (
        <div className="h-48 w-full animate-pulse-slow rounded-lg bg-slate-800/60" />
      ) : (
        query.data && <OeeMonthlySummary rows={query.data.monthly} />
      )}

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
export default function OeeApp({ dehydratedState, initialPeriodKind, initialDate }: Props) {
  return (
    <QueryProvider dehydratedState={dehydratedState}>
      <OeeInner initialPeriodKind={initialPeriodKind} initialDate={initialDate} />
    </QueryProvider>
  );
}
