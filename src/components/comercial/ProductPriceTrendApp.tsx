import { useState } from 'react';
import type { DehydratedState } from '@tanstack/react-query';
import QueryProvider from '../QueryProvider';
import { useApiQuery } from '../dashboard/useApiQuery';
import ProductSearchTable from './ProductSearchTable';
import ProductPriceChart from './ProductPriceChart';
import type { ProductPriceTrend } from './types';

interface Props {
  dehydratedState?: DehydratedState;
}

function ProductPriceTrendInner() {
  const [selected, setSelected] = useState<{ id: number; name: string } | null>(null);

  const trendQuery = useApiQuery<ProductPriceTrend>(
    ['product-price-trend', selected?.id ?? null],
    selected ? `/api/product-price-trend?product_id=${selected.id}` : '',
    { enabled: selected !== null }
  );

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[360px_1fr]">
      <ProductSearchTable selectedProductId={selected?.id ?? null} onSelect={(id, name) => setSelected({ id, name })} />

      <section className="flex flex-col gap-4 rounded-lg border border-slate-800 bg-slate-900 p-4">
        {!selected ? (
          <p className="py-16 text-center text-sm text-slate-500">
            Elegí un producto de la lista para ver su historial de precio.
          </p>
        ) : trendQuery.isLoading ? (
          <div className="h-[320px] w-full animate-pulse-slow rounded-lg bg-slate-800/60" />
        ) : trendQuery.isError ? (
          <p className="text-sm text-red-400">No se pudo cargar el historial de {selected.name}.</p>
        ) : !trendQuery.data?.hasHistory ? (
          <div className="py-16 text-center">
            <p className="text-slate-200">{selected.name}</p>
            <p className="mt-1 text-sm text-slate-500">
              Sin historial disponible — no tiene cambios de precio ni ventas registradas.
            </p>
          </div>
        ) : (
          <>
            <h3 className="text-sm font-medium text-slate-300">{selected.name}</h3>
            <ProductPriceChart points={trendQuery.data.points} />
          </>
        )}
      </section>
    </div>
  );
}

/** Entry point mounted as an Astro client island (`client:load`), same pattern as DashboardApp/FacturacionApp. */
export default function ProductPriceTrendApp({ dehydratedState }: Props) {
  return (
    <QueryProvider dehydratedState={dehydratedState}>
      <ProductPriceTrendInner />
    </QueryProvider>
  );
}
