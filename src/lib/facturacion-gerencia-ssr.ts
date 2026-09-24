import { QueryClient, dehydrate, type DehydratedState } from '@tanstack/react-query';
import { getFacturacionGerencia } from './odoo/facturacion-gerencia';

/** Mirrors the other tabs' SSR pattern: prefetch server-side under the same query key the client island uses. */
export async function buildFacturacionGerenciaDehydratedState(): Promise<DehydratedState> {
  const queryClient = new QueryClient();

  await queryClient.query({
    queryKey: ['facturacion-gerencia'],
    queryFn: () => getFacturacionGerencia(),
  });

  return dehydrate(queryClient);
}
