import { QueryClient, dehydrate, type DehydratedState } from '@tanstack/react-query';
import { getOeeSummary, type OeePeriodKind } from './odoo/oee';

/** Mirrors the other tabs' SSR pattern: prefetch server-side under the same query key the client island uses. */
export async function buildOeeDehydratedState(periodKind: OeePeriodKind, date: string): Promise<DehydratedState> {
  const queryClient = new QueryClient();

  await queryClient.query({
    queryKey: ['oee', periodKind, date],
    queryFn: () => getOeeSummary(periodKind, date),
  });

  return dehydrate(queryClient);
}
