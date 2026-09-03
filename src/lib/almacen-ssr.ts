import { QueryClient, dehydrate, type DehydratedState } from '@tanstack/react-query';
import { getUltimosMovimientos, getWarehouseLayout } from './odoo/almacen';

/** Mirrors the other tabs' SSR pattern — layout and last-movements are prefetched; per-location stock is click-driven. */
export async function buildAlmacenLayoutDehydratedState(): Promise<DehydratedState> {
  const queryClient = new QueryClient();

  await Promise.all([
    queryClient.query({
      queryKey: ['almacen-layout'],
      queryFn: () => getWarehouseLayout(),
    }),
    queryClient.query({
      queryKey: ['almacen-movimientos'],
      queryFn: () => getUltimosMovimientos(),
    }),
  ]);

  return dehydrate(queryClient);
}
