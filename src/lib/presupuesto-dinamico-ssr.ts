import { QueryClient, dehydrate, type DehydratedState } from '@tanstack/react-query';
import { getPresupuestoDinamicoData, getFueraDeAlcance } from './odoo/presupuesto-dinamico';
import { getConsensoUnidades, getTcAsumido, consensoByMonthUnitMap, tcByMonthMap } from './supabase/presupuesto-inputs';

/** Mirrors the other tabs' SSR pattern: prefetch server-side under the same query keys the client island uses, so the first paint has real numbers instead of skeletons. */
export async function buildPresupuestoDinamicoDehydratedState(year: number): Promise<DehydratedState> {
  const queryClient = new QueryClient();

  const [consensoRows, tcRows] = await Promise.all([getConsensoUnidades(year), getTcAsumido(year)]);
  const consensoMap = consensoByMonthUnitMap(consensoRows);
  const tcMap = tcByMonthMap(tcRows);

  await Promise.all([
    queryClient.query({
      queryKey: ['presupuesto-dinamico-resumen', year],
      queryFn: () => getPresupuestoDinamicoData(year, consensoMap, tcMap),
    }),
    queryClient.query({
      queryKey: ['presupuesto-dinamico-fuera-de-alcance', year],
      queryFn: () => getFueraDeAlcance(year),
    }),
  ]);

  return dehydrate(queryClient);
}
