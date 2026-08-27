import { QueryClient, dehydrate, type DehydratedState } from '@tanstack/react-query';
import { searchSellableProducts } from './odoo/product-price-trend';

// Must match ProductSearchTable.tsx's PAGE_SIZE and initial query key exactly,
// or the client mounts with an empty cache and refetches instead of hydrating.
const PAGE_SIZE = 20;

/** Prefetches just the first, unfiltered page of sellable products — no product is selected on first load, so there's no trend to prefetch yet. */
export async function buildProductListDehydratedState(): Promise<DehydratedState> {
  const queryClient = new QueryClient();

  await queryClient.query({
    queryKey: ['sellable-products', '', 0],
    queryFn: () => searchSellableProducts(undefined, PAGE_SIZE, 0),
  });

  return dehydrate(queryClient);
}
