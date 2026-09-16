import { QueryClient, dehydrate, type DehydratedState } from '@tanstack/react-query';
import { getPoliticaVsReal } from './odoo/politica-vs-real';

/** Mirrors the other tabs' SSR pattern: prefetch server-side under the same query key the client island uses. */
export async function buildPoliticaVsRealDehydratedState(): Promise<DehydratedState> {
  const queryClient = new QueryClient();

  await queryClient.query({
    queryKey: ['politica-vs-real'],
    queryFn: () => getPoliticaVsReal(),
  });

  return dehydrate(queryClient);
}
