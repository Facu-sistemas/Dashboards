import { QueryClient, dehydrate, type DehydratedState } from '@tanstack/react-query';
import { getReparaciones } from './odoo/calidad';
import type { DateRangePreset } from './date';

/** Mirrors the other tabs' SSR pattern: prefetch server-side under the same query key the client island uses. */
export async function buildReparacionesDehydratedState(range: DateRangePreset): Promise<DehydratedState> {
  const queryClient = new QueryClient();

  await queryClient.query({
    queryKey: ['reparaciones', range],
    queryFn: () => getReparaciones(range),
  });

  return dehydrate(queryClient);
}
