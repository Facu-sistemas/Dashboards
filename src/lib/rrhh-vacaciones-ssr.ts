import { QueryClient, dehydrate, type DehydratedState } from '@tanstack/react-query';
import { getRrhhVacaciones } from './odoo/rrhh-vacaciones';

export const RRHH_VACACIONES_QUERY_KEY = ['rrhh-vacaciones'];

/** Mirrors the other tabs' SSR pattern: prefetch server-side under the same query key the client island uses. */
export async function buildRrhhVacacionesDehydratedState(): Promise<DehydratedState> {
  const queryClient = new QueryClient();

  await queryClient.query({
    queryKey: RRHH_VACACIONES_QUERY_KEY,
    queryFn: () => getRrhhVacaciones(),
  });

  return dehydrate(queryClient);
}
