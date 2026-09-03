import { QueryClient, dehydrate, type DehydratedState } from '@tanstack/react-query';
import { getPlanProduccion, getPlanProduccionDiaria, type PeriodKind } from './odoo/plan-produccion';

/** Mirrors the other tabs' SSR pattern: prefetch server-side under the same query keys the client island uses. */
export async function buildPlanProduccionDehydratedState(periodKind: PeriodKind, date: string): Promise<DehydratedState> {
  const queryClient = new QueryClient();

  await Promise.all([
    queryClient.query({
      queryKey: ['plan-produccion', periodKind, date],
      queryFn: () => getPlanProduccion(periodKind, date),
    }),
    queryClient.query({
      queryKey: ['plan-produccion-diaria', date.slice(0, 7)],
      queryFn: () => getPlanProduccionDiaria(date),
    }),
  ]);

  return dehydrate(queryClient);
}
