import { QueryClient, dehydrate, type DehydratedState } from '@tanstack/react-query';
import { getVentasGerencia } from './odoo/ventas-gerencia';

/** Mirrors the other tabs' SSR pattern: prefetch server-side under the same query key the client island uses. */
export async function buildVentasGerenciaDehydratedState(): Promise<DehydratedState> {
  const queryClient = new QueryClient();

  await queryClient.query({
    queryKey: ['ventas-gerencia'],
    queryFn: () => getVentasGerencia(),
  });

  return dehydrate(queryClient);
}
