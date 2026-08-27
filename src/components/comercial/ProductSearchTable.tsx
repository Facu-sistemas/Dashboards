import { useEffect, useState } from 'react';
import { useApiQuery } from '../dashboard/useApiQuery';
import type { SellableProductPage } from './types';

interface Props {
  selectedProductId: number | null;
  onSelect: (id: number, name: string) => void;
}

// Must match product-price-trend-ssr.ts's PAGE_SIZE so the first page hydrates from SSR instead of refetching.
const PAGE_SIZE = 20;
const DEBOUNCE_MS = 300;

const money = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });

export default function ProductSearchTable({ selectedProductId, onSelect }: Props) {
  const [searchInput, setSearchInput] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [page, setPage] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedQuery(searchInput.trim());
      setPage(0);
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [searchInput]);

  const query = useApiQuery<SellableProductPage>(
    ['sellable-products', debouncedQuery, page],
    `/api/products?${new URLSearchParams({ q: debouncedQuery, limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE) })}`
  );

  const items = query.data?.items ?? [];
  const total = query.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-slate-800 bg-slate-900 p-4">
      <input
        type="text"
        value={searchInput}
        onChange={(e) => setSearchInput(e.target.value)}
        placeholder="Buscar producto por nombre..."
        className="rounded border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-100 placeholder:text-slate-600 focus:border-brand-500 focus:outline-none"
      />

      <div className="max-h-96 overflow-y-auto rounded border border-slate-800">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 bg-slate-900">
            <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="py-2 pl-3 pr-2 font-medium">Producto</th>
              <th className="py-2 pr-3 font-medium">Precio de lista</th>
            </tr>
          </thead>
          <tbody>
            {query.isLoading ? (
              <tr>
                <td colSpan={2} className="py-6 text-center text-slate-500">
                  Cargando…
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={2} className="py-6 text-center text-slate-500">
                  Sin resultados.
                </td>
              </tr>
            ) : (
              items.map((p) => (
                <tr
                  key={p.id}
                  onClick={() => onSelect(p.id, p.name)}
                  className={`cursor-pointer border-b border-slate-800/60 last:border-0 hover:bg-slate-800/60 ${
                    selectedProductId === p.id ? 'bg-brand-500/10' : ''
                  }`}
                >
                  <td className="py-2 pl-3 pr-2 text-slate-200">{p.name}</td>
                  <td className="py-2 pr-3 text-slate-300">{money.format(p.listPrice)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>{total} productos</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={page === 0}
            onClick={() => setPage((p) => p - 1)}
            className="rounded border border-slate-700 px-2 py-1 disabled:opacity-40"
          >
            Anterior
          </button>
          <span>
            Página {page + 1} de {totalPages}
          </span>
          <button
            type="button"
            disabled={page + 1 >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="rounded border border-slate-700 px-2 py-1 disabled:opacity-40"
          >
            Siguiente
          </button>
        </div>
      </div>
    </div>
  );
}
