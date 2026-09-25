import type { DehydratedState } from '@tanstack/react-query';
import QueryProvider from '../QueryProvider';
import { useApiQuery } from '../dashboard/useApiQuery';
import LastUpdated from '../shared/LastUpdated';
import DistribucionChequesMatrix from './DistribucionChequesMatrix';
import type { CreditoClientesData } from '../../lib/odoo/credito-clientes';

interface Props {
  dehydratedState?: DehydratedState;
}

function DistribucionChequesInner() {
  // Mismo query key que Crédito y Cheques ('credito-clientes') — un solo
  // fetch/prefetch a Odoo alimenta ambas vistas de esta misma área.
  const query = useApiQuery<CreditoClientesData>(['credito-clientes'], '/api/credito-clientes');

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">
          Cheques de terceros en cartera (no depositados/entregados/vendidos/rechazados), por cliente y mes de pago.
        </p>
        <LastUpdated dataUpdatedAt={query.dataUpdatedAt} />
      </div>

      {query.isError && (
        <p className="rounded border border-red-900 bg-red-950/50 p-3 text-sm text-red-300">
          No se pudieron cargar los datos: {(query.error as Error).message}
        </p>
      )}

      {query.isLoading || !query.data ? (
        <div className="h-64 w-full animate-pulse-slow rounded-lg bg-slate-800/60" />
      ) : (
        <DistribucionChequesMatrix data={query.data} />
      )}
    </div>
  );
}

/** Entry point mounted as an Astro client island (`client:load`), same pattern as the other tabs. */
export default function DistribucionChequesApp({ dehydratedState }: Props) {
  return (
    <QueryProvider dehydratedState={dehydratedState}>
      <DistribucionChequesInner />
    </QueryProvider>
  );
}
