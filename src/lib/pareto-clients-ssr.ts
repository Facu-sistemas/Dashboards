import { QueryClient, dehydrate, type DehydratedState } from '@tanstack/react-query';
import { getParetoClients, type ParetoRange } from './odoo/pareto-clients';

/** Mirrors the other tabs' SSR pattern: prefetch server-side under the same query key the client island uses, so the first paint has real numbers instead of skeletons. */
export async function buildParetoClientsDehydratedState(range: ParetoRange): Promise<DehydratedState> {
  const queryClient = new QueryClient();

  await queryClient.query({
    queryKey: ['pareto-clients', range],
    queryFn: () => getParetoClients(range),
  });

  return dehydrate(queryClient);
}
