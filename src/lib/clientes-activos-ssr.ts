import { QueryClient, dehydrate, type DehydratedState } from '@tanstack/react-query';
import { getClientesActivos, getTendenciaMensual, getUltimasVentas, type ClientesActivosPeriodo } from './odoo/clientes-activos';

/** Mirrors the other tabs' SSR pattern: prefetch server-side under the same query key the client island uses. */
export async function buildClientesActivosDehydratedState(periodo: ClientesActivosPeriodo): Promise<DehydratedState> {
  const queryClient = new QueryClient();

  // `false` en las queries de abajo es el mismo default con el que arranca
  // `todasNC` del lado del cliente (ClientesActivosApp.tsx) — tiene que
  // matchear la query key exacta que arma el cliente o la hidratación no
  // encuentra los datos precargados y vuelve a pedirlos desde cero.
  await Promise.all([
    queryClient.query({
      queryKey: ['clientes-activos', periodo, false],
      queryFn: () => getClientesActivos(periodo, false),
    }),
    queryClient.query({
      queryKey: ['clientes-activos-ultimas-ventas'],
      queryFn: () => getUltimasVentas(),
    }),
    queryClient.query({
      queryKey: ['clientes-activos-tendencia', false],
      queryFn: () => getTendenciaMensual(false),
    }),
  ]);

  return dehydrate(queryClient);
}
