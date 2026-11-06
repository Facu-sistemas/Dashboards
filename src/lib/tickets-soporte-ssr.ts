import { QueryClient, dehydrate, type DehydratedState } from '@tanstack/react-query';
import { getTicketsSoporte } from './odoo/calidad';

/** Mirrors the other tabs' SSR pattern: prefetch server-side under the same query key the client island uses. */
export async function buildTicketsSoporteDehydratedState(desde: string, hasta: string): Promise<DehydratedState> {
  const queryClient = new QueryClient();

  await queryClient.query({
    queryKey: ['tickets-soporte', desde, hasta],
    queryFn: () => getTicketsSoporte(desde, hasta),
  });

  return dehydrate(queryClient);
}
