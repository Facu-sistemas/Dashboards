import { QueryClient, dehydrate, type DehydratedState } from '@tanstack/react-query';
import { searchModelosCarpinteria } from './odoo/carpinteria';

// Must match ModeloSearchTable.tsx's PAGE_SIZE and initial query key exactly,
// or the client mounts with an empty cache and refetches instead of hydrating.
const PAGE_SIZE = 20;

/** Prefetches just the first, unfiltered page of modelos — no model is selected on first load, so there's no receta to prefetch yet. */
export async function buildCarpinteriaModelosDehydratedState(): Promise<DehydratedState> {
  const queryClient = new QueryClient();

  await queryClient.query({
    queryKey: ['carpinteria-modelos', '', 0],
    queryFn: () => searchModelosCarpinteria(undefined, PAGE_SIZE, 0),
  });

  return dehydrate(queryClient);
}
