import { QueryClient, dehydrate, type DehydratedState } from '@tanstack/react-query';
import { getClientesActivos, getUltimasVentas, type ClientesActivosMeses } from './odoo/clientes-activos';

/** Mirrors the other tabs' SSR pattern: prefetch server-side under the same query key the client island uses. */
export async function buildClientesActivosDehydratedState(meses: ClientesActivosMeses): Promise<DehydratedState> {
  const queryClient = new QueryClient();

  await Promise.all([
    queryClient.query({
      queryKey: ['clientes-activos', meses],
      queryFn: () => getClientesActivos(meses),
    }),
    queryClient.query({
      queryKey: ['clientes-activos-ultimas-ventas'],
      queryFn: () => getUltimasVentas(),
    }),
  ]);

  return dehydrate(queryClient);
}
