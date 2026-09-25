import { QueryClient, dehydrate, type DehydratedState } from '@tanstack/react-query';
import { getCreditoClientes } from './odoo/credito-clientes';

/** Mirrors the other tabs' SSR pattern: prefetch server-side under the same query key the client island uses. */
export async function buildCreditoClientesDehydratedState(): Promise<DehydratedState> {
  const queryClient = new QueryClient();

  await queryClient.query({
    queryKey: ['credito-clientes'],
    queryFn: () => getCreditoClientes(),
  });

  return dehydrate(queryClient);
}
