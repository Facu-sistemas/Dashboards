import { QueryClient, dehydrate, type DehydratedState } from '@tanstack/react-query';
import { getWarehouseLayout } from './odoo/almacen';

/** Mirrors the other tabs' SSR pattern — only the layout is prefetched; per-location stock is click-driven. */
export async function buildAlmacenLayoutDehydratedState(): Promise<DehydratedState> {
  const queryClient = new QueryClient();

  await queryClient.query({
    queryKey: ['almacen-layout'],
    queryFn: () => getWarehouseLayout(),
  });

  return dehydrate(queryClient);
}
