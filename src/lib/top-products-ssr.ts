import { QueryClient, dehydrate, type DehydratedState } from '@tanstack/react-query';
import { getTopProductsByCategory, type TopProductsRange } from './odoo/top-products';

/** Mirrors the other tabs' SSR pattern: prefetch server-side under the same query key the client island uses, so the first paint has real numbers instead of skeletons. */
export async function buildTopProductsDehydratedState(range: TopProductsRange): Promise<DehydratedState> {
  const queryClient = new QueryClient();

  await queryClient.query({
    queryKey: ['top-products', range],
    queryFn: () => getTopProductsByCategory(range),
  });

  return dehydrate(queryClient);
}
