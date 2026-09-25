import { QueryClient, dehydrate, type DehydratedState } from '@tanstack/react-query';
import { getTicketsSoporte, type NotasCreditoEmpresa } from './odoo/calidad';
import type { DateRangePreset } from './date';

/** Mirrors the other tabs' SSR pattern: prefetch server-side under the same query key the client island uses. */
export async function buildTicketsSoporteDehydratedState(
  range: DateRangePreset,
  notasCreditoEmpresa: NotasCreditoEmpresa = 'all'
): Promise<DehydratedState> {
  const queryClient = new QueryClient();

  await queryClient.query({
    queryKey: ['tickets-soporte', range, notasCreditoEmpresa],
    queryFn: () => getTicketsSoporte(range, notasCreditoEmpresa),
  });

  return dehydrate(queryClient);
}
