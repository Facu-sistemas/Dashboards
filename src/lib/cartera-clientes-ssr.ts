import { QueryClient, dehydrate, type DehydratedState } from '@tanstack/react-query';
import { getCarteraClientes } from './odoo/cartera-clientes';

/** Mirrors the other tabs' SSR pattern: prefetch server-side under the same query key the client island uses. */
export async function buildCarteraClientesDehydratedState(): Promise<DehydratedState> {
  const queryClient = new QueryClient();

  await queryClient.query({
    queryKey: ['cartera-clientes'],
    queryFn: () => getCarteraClientes(),
  });

  return dehydrate(queryClient);
}
