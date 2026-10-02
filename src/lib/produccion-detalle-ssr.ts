import { QueryClient, dehydrate, type DehydratedState } from '@tanstack/react-query';
import { getProduccionDetalle } from './odoo/produccion-detalle';

/** Mirrors the other tabs' SSR pattern: prefetch server-side under the same query key the client island uses. */
export async function buildProduccionDetalleDehydratedState(): Promise<DehydratedState> {
  const queryClient = new QueryClient();

  await queryClient.query({
    queryKey: ['produccion-detalle'],
    queryFn: () => getProduccionDetalle(),
  });

  return dehydrate(queryClient);
}
