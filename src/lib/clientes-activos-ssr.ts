import { QueryClient, dehydrate, type DehydratedState } from '@tanstack/react-query';
import { getClientesActivos, getTendenciaMensual, getUltimasVentas, type ClientesActivosPeriodo } from './odoo/clientes-activos';

/** Mirrors the other tabs' SSR pattern: prefetch server-side under the same query key the client island uses. */
export async function buildClientesActivosDehydratedState(periodo: ClientesActivosPeriodo): Promise<DehydratedState> {
  const queryClient = new QueryClient();

  // 'pedidos' (fuente), `false` (todasNC) y '' (companyIds) son los mismos
  // defaults con los que arranca el estado del lado del cliente
  // (ClientesActivosApp.tsx) — tienen que matchear la query key exacta que
  // arma el cliente o la hidratación no encuentra los datos precargados y
  // vuelve a pedirlos desde cero.
  await Promise.all([
    queryClient.query({
      queryKey: ['clientes-activos', periodo, false, '', 'pedidos'],
      queryFn: () => getClientesActivos(periodo, false, undefined, 'pedidos'),
    }),
    queryClient.query({
      queryKey: ['clientes-activos-ultimas-ventas', '', 'pedidos'],
      queryFn: () => getUltimasVentas(undefined, 'pedidos'),
    }),
    queryClient.query({
      queryKey: ['clientes-activos-tendencia', false, '', 'pedidos'],
      queryFn: () => getTendenciaMensual(false, undefined, 'pedidos'),
    }),
  ]);

  return dehydrate(queryClient);
}
