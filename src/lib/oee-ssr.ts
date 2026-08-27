import { QueryClient, dehydrate, type DehydratedState } from '@tanstack/react-query';
import { getOeeSummary, type OeeGranularity, type OeeCategoryFilter } from './odoo/oee';

/** Mirrors the other tabs' SSR pattern: prefetch server-side under the same query key the client island uses. */
export async function buildOeeDehydratedState(granularity: OeeGranularity, category: OeeCategoryFilter): Promise<DehydratedState> {
  const queryClient = new QueryClient();

  await queryClient.query({
    queryKey: ['oee', granularity, category],
    queryFn: () => getOeeSummary(granularity, category),
  });

  return dehydrate(queryClient);
}
