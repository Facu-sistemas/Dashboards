import { useState } from 'react';
import type { DehydratedState } from '@tanstack/react-query';
import QueryProvider from '../QueryProvider';
import { useApiQuery } from '../dashboard/useApiQuery';
import LastUpdated from '../shared/LastUpdated';
import TicketsPorTipoChart from './TicketsPorTipoChart';
import TicketsPorPrioridadChart from './TicketsPorPrioridadChart';
import TicketsMensualChart from './TicketsMensualChart';
import type { CalidadRange, TicketsSoporteResult } from './types';

interface Props {
  initialRange: CalidadRange;
  dehydratedState?: DehydratedState;
}

const RANGE_OPTIONS: { value: CalidadRange; label: string }[] = [
  { value: 'all', label: 'Histórico completo' },
  { value: 'this-year', label: 'Este año' },
  { value: 'last-12-months', label: 'Últimos 12 meses' },
  { value: 'last-6-months', label: 'Últimos 6 meses' },
];

function TicketsSoporteInner({ initialRange }: { initialRange: CalidadRange }) {
  const [range, setRange] = useState<CalidadRange>(initialRange);

  const query = useApiQuery<TicketsSoporteResult>(
    ['tickets-soporte', range],
    `/api/tickets-soporte?${new URLSearchParams({ range })}`
  );

  const data = query.data;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <label className="flex flex-col gap-1 text-sm text-slate-300">
          Período
          <select
            value={range}
            onChange={(e) => setRange(e.target.value as CalidadRange)}
            className="min-w-[10rem] rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-100 focus:border-brand-500 focus:outline-none"
          >
            {RANGE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <LastUpdated dataUpdatedAt={query.dataUpdatedAt} />
      </div>

      {query.isError && (
        <p className="rounded border border-red-900 bg-red-950/50 p-3 text-sm text-red-300">
          No se pudieron cargar los datos: {(query.error as Error).message}
        </p>
      )}

      {!query.isLoading && data && (
        <p className="text-sm text-slate-400">
          <span className="font-medium text-slate-200">{data.total}</span> tickets en el período seleccionado.
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="flex flex-col gap-4 rounded-lg border border-slate-800 bg-slate-900 p-4">
          <h3 className="text-sm font-medium text-slate-300">Tickets por Tipo</h3>
          {query.isLoading ? (
            <div className="h-[240px] w-full animate-pulse-slow rounded-lg bg-slate-800/60" />
          ) : (
            <>
              <TicketsPorTipoChart rows={data?.porTipo ?? []} />
              {(data?.porTipo.find((r) => r.tipo === 'Sin tipo')?.cantidad ?? 0) > 0 && (
                <p className="text-xs text-slate-500">
                  "Sin tipo" son tickets sin el campo Tipo cargado — no es un tipo real, es un hueco de carga.
                </p>
              )}
            </>
          )}
        </section>

        <section className="flex flex-col gap-4 rounded-lg border border-slate-800 bg-slate-900 p-4">
          <h3 className="text-sm font-medium text-slate-300">Tickets por Prioridad</h3>
          {query.isLoading ? (
            <div className="h-[240px] w-full animate-pulse-slow rounded-lg bg-slate-800/60" />
          ) : (
            <TicketsPorPrioridadChart rows={data?.porPrioridad ?? []} />
          )}
        </section>
      </div>

      <section className="flex flex-col gap-4 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <h3 className="text-sm font-medium text-slate-300">Volumen mensual — últimos 12 meses</h3>
        {query.isLoading ? (
          <div className="h-[280px] w-full animate-pulse-slow rounded-lg bg-slate-800/60" />
        ) : (
          <TicketsMensualChart points={data?.mensual ?? []} />
        )}
      </section>
    </div>
  );
}

/** Entry point mounted as an Astro client island (`client:load`), same pattern as the other tabs. */
export default function TicketsSoporteApp({ dehydratedState, initialRange }: Props) {
  return (
    <QueryProvider dehydratedState={dehydratedState}>
      <TicketsSoporteInner initialRange={initialRange} />
    </QueryProvider>
  );
}
