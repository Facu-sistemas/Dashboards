import { useEffect, useState } from 'react';
import { useApiQuery } from '../dashboard/useApiQuery';
import type { ModeloCarpinteriaPage } from './types';

// Must match carpinteria-ssr.ts's PAGE_SIZE so the first page hydrates from SSR instead of refetching.
const PAGE_SIZE = 20;
const DEBOUNCE_MS = 300;

interface Props {
  selectedModelo: string | null;
  onSelect: (name: string) => void;
}

export default function ModeloSearchTable({ selectedModelo, onSelect }: Props) {
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

  const query = useApiQuery<ModeloCarpinteriaPage>(
    ['carpinteria-modelos', debouncedQuery, page],
    `/api/carpinteria-modelos?${new URLSearchParams({ q: debouncedQuery, limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE) })}`
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
        placeholder="Buscar modelo de sillón..."
        className="rounded border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-100 placeholder:text-slate-600 focus:border-brand-500 focus:outline-none"
      />

      <div className="max-h-96 overflow-y-auto rounded border border-slate-800">
        <table className="w-full border-collapse text-sm">
          <tbody>
            {query.isLoading ? (
              <tr>
                <td className="py-6 text-center text-slate-500">Cargando…</td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td className="py-6 text-center text-slate-500">Sin resultados.</td>
              </tr>
            ) : (
              items.map((m) => (
                <tr
                  key={m.name}
                  onClick={() => onSelect(m.name)}
                  className={`cursor-pointer border-b border-slate-800/60 last:border-0 hover:bg-slate-800/60 ${
                    selectedModelo === m.name ? 'bg-brand-500/10' : ''
                  }`}
                >
                  <td className="py-2 px-3 text-slate-200">{m.name}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>{total} modelos</span>
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
