import { QueryClient, dehydrate, type DehydratedState } from '@tanstack/react-query';
import { getProduccionGerencia } from './odoo/produccion-gerencia';

/** Mirrors the other tabs' SSR pattern: prefetch server-side under the same query key the client island uses. */
export async function buildProduccionGerenciaDehydratedState(): Promise<DehydratedState> {
  const queryClient = new QueryClient();

  await queryClient.query({
    queryKey: ['produccion-gerencia'],
    queryFn: () => getProduccionGerencia(),
  });

  return dehydrate(queryClient);
}
