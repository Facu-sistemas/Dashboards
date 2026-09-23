import { QueryClient, dehydrate, type DehydratedState } from '@tanstack/react-query';
import { getCarteraClientes } from './odoo/cartera-clientes';

/** Mirrors the other tabs' SSR pattern: prefetch server-side under the same query key the client island uses. */
export async function buildCarteraClientesDehydratedState(): Promise<DehydratedState> {
  const queryClient = new QueryClient();

  // 'pedidos' es el mismo default con el que arranca el estado del lado del
  // cliente (CarteraClientesApp.tsx) — tiene que matchear la query key
  // exacta que arma el cliente o la hidratación no encuentra los datos
  // precargados y vuelve a pedirlos desde cero.
  await queryClient.query({
    queryKey: ['cartera-clientes', 'pedidos'],
    queryFn: () => getCarteraClientes('pedidos'),
  });

  return dehydrate(queryClient);
}
