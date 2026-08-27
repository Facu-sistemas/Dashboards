import { QueryClient, dehydrate, type DehydratedState } from '@tanstack/react-query';
import { getFacturacionComparison, getFacturacionTrend } from './odoo/facturacion';

const TREND_MONTHS = 12;

/** Mirrors dashboard-ssr.ts's pattern: prefetch server-side under the same query keys the client island uses, so the first paint has real numbers instead of skeletons. */
export async function buildFacturacionDehydratedState(month: string): Promise<DehydratedState> {
  const queryClient = new QueryClient();

  await Promise.allSettled([
    queryClient.query({
      queryKey: ['facturacion', month],
      queryFn: () => getFacturacionComparison(month),
    }),
    queryClient.query({
      queryKey: ['facturacion-trend', TREND_MONTHS],
      queryFn: () => getFacturacionTrend(TREND_MONTHS),
    }),
  ]);

  return dehydrate(queryClient);
}
