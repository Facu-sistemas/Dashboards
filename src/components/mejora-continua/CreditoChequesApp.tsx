import { useMemo, useState } from 'react';
import type { DehydratedState } from '@tanstack/react-query';
import QueryProvider from '../QueryProvider';
import { useApiQuery } from '../dashboard/useApiQuery';
import LastUpdated from '../shared/LastUpdated';
import { formatCompactCurrency } from '../gerencia/format';
import CreditoChequesTable, { type CreditoSortBy } from './CreditoChequesTable';
import CreditoChequesChart from './CreditoChequesChart';
import type { CreditoClientesData } from '../../lib/odoo/credito-clientes';

interface Props {
  dehydratedState?: DehydratedState;
}

function KpiCard({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-lg border p-4 ${highlight ? 'border-brand-500/40 bg-brand-500/5' : 'border-slate-800 bg-slate-900'}`}>
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${highlight ? 'text-brand-400' : 'text-slate-100'}`}>{value}</p>
    </div>
  );
}

function CreditoChequesInner() {
  const [sortBy, setSortBy] = useState<CreditoSortBy>('totalCredito');
  const [selectedPartnerId, setSelectedPartnerId] = useState<number | null>(null);

  const query = useApiQuery<CreditoClientesData>(['credito-clientes'], '/api/credito-clientes');
  const data = query.data;

  const selectedClient = useMemo(
    () => data?.clientes.find((c) => c.partnerId === selectedPartnerId) ?? null,
    [data, selectedPartnerId]
  );

  const chartData = selectedPartnerId !== null ? data?.chequesPorMesPorCliente[selectedPartnerId] ?? [] : data?.chequesPorMes ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">Solo lectura — datos de Odoo (deudores por ventas, cheques de terceros en cartera y pedidos confirmados sin entregar).</p>
        <LastUpdated dataUpdatedAt={query.dataUpdatedAt} />
      </div>

      {query.isError && (
        <p className="rounded border border-red-900 bg-red-950/50 p-3 text-sm text-red-300">
          No se pudieron cargar los datos: {(query.error as Error).message}
        </p>
      )}

      {query.isLoading || !data ? (
        <div className="h-24 w-full animate-pulse-slow rounded-lg bg-slate-800/60" />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard label="Total por Cobrar" value={formatCompactCurrency(data.totales.totalPorCobrar)} />
          <KpiCard label="Cheques Activos" value={formatCompactCurrency(data.totales.totalChequesActivos)} />
          <KpiCard label="Pedidos Pendientes (c/IVA)" value={formatCompactCurrency(data.totales.pedidosPendientesConIva)} />
          <KpiCard label="Total Crédito" value={formatCompactCurrency(data.totales.totalCredito)} highlight />
        </div>
      )}

      <section className="flex flex-col gap-4 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-medium text-slate-300">Distribución de cheques por mes</h3>
            <p className="text-xs text-slate-500">
              {selectedClient ? `${selectedClient.partnerName} — ` : 'Todos los clientes — '}
              cheques en cartera por fecha de pago, mes actual en adelante.
            </p>
          </div>
          {selectedPartnerId !== null && (
            <button
              type="button"
              onClick={() => setSelectedPartnerId(null)}
              className="rounded border border-slate-700 px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-800"
            >
              Ver todos los clientes
            </button>
          )}
        </div>
        {query.isLoading || !data ? (
          <div className="h-64 w-full animate-pulse-slow rounded-lg bg-slate-800/60" />
        ) : (
          <CreditoChequesChart data={chartData} />
        )}
      </section>

      <section className="flex flex-col gap-4 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <h3 className="text-sm font-medium text-slate-300">Clientes</h3>
        <p className="-mt-2 text-xs text-slate-500">Click en un cliente para ver su distribución de cheques arriba.</p>
        {query.isLoading || !data ? (
          <div className="h-64 w-full animate-pulse-slow rounded-lg bg-slate-800/60" />
        ) : (
          <CreditoChequesTable
            rows={data.clientes}
            chequesPorMesPorCliente={data.chequesPorMesPorCliente}
            selectedPartnerId={selectedPartnerId}
            onSelectClient={(id) => setSelectedPartnerId((prev) => (prev === id ? null : id))}
            sortBy={sortBy}
            onSortByChange={setSortBy}
          />
        )}
      </section>
    </div>
  );
}

/** Entry point mounted as an Astro client island (`client:load`), same pattern as the other tabs. */
export default function CreditoChequesApp({ dehydratedState }: Props) {
  return (
    <QueryProvider dehydratedState={dehydratedState}>
      <CreditoChequesInner />
    </QueryProvider>
  );
}
