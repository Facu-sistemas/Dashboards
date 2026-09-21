import { QueryClient, dehydrate, type DehydratedState } from '@tanstack/react-query';
import { getClientesActivos, getTendenciaMensual, getUltimasVentas, type ClientesActivosPeriodo } from './odoo/clientes-activos';

/** Mirrors the other tabs' SSR pattern: prefetch server-side under the same query key the client island uses. */
export async function buildClientesActivosDehydratedState(periodo: ClientesActivosPeriodo): Promise<DehydratedState> {
  const queryClient = new QueryClient();

  await Promise.all([
    queryClient.query({
      queryKey: ['clientes-activos', periodo],
      queryFn: () => getClientesActivos(periodo),
    }),
    queryClient.query({
      queryKey: ['clientes-activos-ultimas-ventas'],
      queryFn: () => getUltimasVentas(),
    }),
    queryClient.query({
      queryKey: ['clientes-activos-tendencia'],
      queryFn: () => getTendenciaMensual(),
    }),
  ]);

  return dehydrate(queryClient);
}
