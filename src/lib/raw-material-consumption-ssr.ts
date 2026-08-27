import { QueryClient, dehydrate, type DehydratedState } from '@tanstack/react-query';
import { getRawMaterialConsumption, type ConsumptionLookbackDays } from './odoo/raw-material-consumption';

/** Mirrors the other tabs' SSR pattern: prefetch server-side under the same query key the client island uses. */
export async function buildRawMaterialConsumptionDehydratedState(
  categoryId: number | null,
  lookbackDays: ConsumptionLookbackDays,
  onlyLow: boolean
): Promise<DehydratedState> {
  const queryClient = new QueryClient();

  await queryClient.query({
    queryKey: ['raw-material-consumption', categoryId, lookbackDays, onlyLow],
    queryFn: () => getRawMaterialConsumption(categoryId, lookbackDays, onlyLow),
  });

  return dehydrate(queryClient);
}
