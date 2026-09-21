import { useMemo, useState } from 'react';
import type { DehydratedState } from '@tanstack/react-query';
import QueryProvider from '../QueryProvider';
import { useApiQuery } from '../dashboard/useApiQuery';
import LastUpdated from '../shared/LastUpdated';
import ClientesActivosTable, { type ClientesActivosSortBy } from './ClientesActivosTable';
import UltimasVentasCarousel from './UltimasVentasCarousel';
import { formatCompactCurrency, formatNumber } from './format';
import type { ClientesActivosPeriodo, ClientesActivosResult, UltimaVentaRow } from '../../lib/odoo/clientes-activos';

interface Props {
  initialPeriodo: ClientesActivosPeriodo;
  dehydratedState?: DehydratedState;
}

const PERIODO_OPTIONS: { value: ClientesActivosPeriodo; label: string }[] = [
  { value: '30d', label: 'Últimos 30 días' },
  { value: '6m', label: 'Últimos 6 meses' },
  { value: '9m', label: 'Últimos 9 meses' },
];

const CONDICION_DEFAULT = 10;
const CONDICION_MIN = 1;

function ClientesActivosInner({ initialPeriodo }: { initialPeriodo: ClientesActivosPeriodo }) {
  const [periodo, setPeriodo] = useState<ClientesActivosPeriodo>(initialPeriodo);
  const [condicion, setCondicion] = useState(CONDICION_DEFAULT);
  const [sortBy, setSortBy] = useState<ClientesActivosSortBy>('facturado');

  const query = useApiQuery<ClientesActivosResult>(
    ['clientes-activos', periodo],
    `/api/clientes-activos?periodo=${periodo}`
  );
  const ultimasVentasQuery = useApiQuery<UltimaVentaRow[]>(
    ['clientes-activos-ultimas-ventas'],
    '/api/clientes-activos-ultimas-ventas'
  );

  const rows = useMemo(() => {
    const activos = (query.data?.rows ?? []).filter((r) => r.invoiceCount >= condicion);
    const sorted = [...activos].sort((a, b) =>
      sortBy === 'facturado' ? b.amount - a.amount : b.invoiceCount - a.invoiceCount
    );
    return sorted;
  }, [query.data, condicion, sortBy]);

  const top10 = rows.slice(0, 10);
  const totalActivos = rows.length;
  const totalFacturado = rows.reduce((sum, r) => sum + r.amount, 0);
  const totalConDevoluciones = rows.filter((r) => r.creditNoteCount > 0).length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <div className="flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-1 text-sm text-slate-300">
            Período
            <select
              value={periodo}
              onChange={(e) => setPeriodo(e.target.value as ClientesActivosPeriodo)}
              className="min-w-[10rem] rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-100 focus:border-brand-500 focus:outline-none"
            >
              {PERIODO_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm text-slate-300">
            Condición (facturas mín.)
            <input
              type="number"
              min={CONDICION_MIN}
              value={condicion}
              onChange={(e) => setCondicion(Math.max(CONDICION_MIN, Number(e.target.value) || CONDICION_MIN))}
              className="w-28 rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-100 focus:border-brand-500 focus:outline-none"
            />
          </label>
        </div>
        <LastUpdated dataUpdatedAt={query.dataUpdatedAt} />
      </div>

      {query.isError && (
        <p className="rounded border border-red-900 bg-red-950/50 p-3 text-sm text-red-300">
          No se pudieron cargar los datos: {(query.error as Error).message}
        </p>
      )}

      {query.isLoading ? (
        <div className="h-24 w-full animate-pulse-slow rounded-lg bg-slate-800/60" />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">Clientes activos</p>
            <p className="mt-1 text-2xl font-semibold text-slate-100">{formatNumber(totalActivos)}</p>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">Facturado en el período</p>
            <p className="mt-1 text-2xl font-semibold text-slate-100">{formatCompactCurrency(totalFacturado)}</p>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">Con notas de crédito</p>
            <p className="mt-1 text-2xl font-semibold text-amber-400">{formatNumber(totalConDevoluciones)}</p>
          </div>
        </div>
      )}

      <section className="flex flex-col gap-4 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <h3 className="text-sm font-medium text-slate-300">Top 10</h3>
        {query.isLoading ? (
          <div className="h-64 w-full animate-pulse-slow rounded-lg bg-slate-800/60" />
        ) : (
          <ClientesActivosTable rows={top10} periodo={periodo} sortBy={sortBy} onSortByChange={setSortBy} />
        )}
      </section>

      {!ultimasVentasQuery.isLoading && <UltimasVentasCarousel ventas={ultimasVentasQuery.data ?? []} />}

      <section className="flex flex-col gap-4 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <h3 className="text-sm font-medium text-slate-300">Todos los clientes activos ({formatNumber(totalActivos)})</h3>
        {query.isLoading ? (
          <div className="h-64 w-full animate-pulse-slow rounded-lg bg-slate-800/60" />
        ) : (
          <ClientesActivosTable rows={rows} periodo={periodo} sortBy={sortBy} onSortByChange={setSortBy} scrollable />
        )}
      </section>
    </div>
  );
}

/** Entry point mounted as an Astro client island (`client:load`), same pattern as the other Gerencia tabs. */
export default function ClientesActivosApp({ dehydratedState, initialPeriodo }: Props) {
  return (
    <QueryProvider dehydratedState={dehydratedState}>
      <ClientesActivosInner initialPeriodo={initialPeriodo} />
    </QueryProvider>
  );
}
