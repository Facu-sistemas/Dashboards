import { useMemo, useState } from 'react';
import { computeMovimiento, type Categoria, type ClienteStat, type Estado, type Movimiento, type Snapshot } from './cartera-clientes-calc';
import { formatCompactCurrency } from '../gerencia/format';

interface Props {
  snap: Snapshot;
  snapPrev: Snapshot;
  clients: string[];
  vendors: string[];
}

type SortKey = 'nombre' | 'cat' | 'estado' | 'movimiento' | 'ultima' | 'dias' | 'monto' | 'ordenes' | 'vendedor';

const PAGE_SIZE = 25;

const ESTADOS: Estado[] = ['Activo', 'Dormido', 'Perdido', 'Nuevo'];
const CATS: Categoria[] = ['A', 'B', 'C'];
const MOVIMIENTOS: Movimiento[] = ['Recuperado', 'Nuevo (primera compra)', 'Caído', 'Sin cambio'];

const ESTADO_PILL: Record<Estado, string> = {
  Activo: 'bg-status-green/15 text-status-green',
  Dormido: 'bg-status-yellow/15 text-status-yellow',
  Perdido: 'bg-status-red/15 text-status-red',
  Nuevo: 'bg-brand-500/15 text-brand-400',
};

const MOVIMIENTO_PILL: Partial<Record<Movimiento, string>> = {
  Recuperado: 'bg-status-green/15 text-status-green',
  Caído: 'bg-status-red/15 text-status-red',
  'Nuevo (primera compra)': 'bg-brand-500/15 text-brand-400',
};

function CheckGroup<T extends string>({
  options,
  selected,
  onToggle,
  onClear,
  label,
}: {
  options: T[];
  selected: Set<T>;
  onToggle: (v: T) => void;
  onClear: () => void;
  label: string;
}) {
  return (
    <details className="relative">
      <summary className="cursor-pointer list-none rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-300 hover:border-brand-500/60">
        {label}
        {selected.size > 0 ? ` (${selected.size})` : ''}
      </summary>
      <div className="absolute z-10 mt-1 flex min-w-[10rem] flex-col gap-1 rounded border border-slate-700 bg-slate-900 p-2 shadow-lg">
        {options.map((o) => (
          <label key={o} className="flex items-center gap-2 text-xs text-slate-300">
            <input type="checkbox" checked={selected.has(o)} onChange={() => onToggle(o)} />
            {o}
          </label>
        ))}
        {selected.size > 0 && (
          <button type="button" onClick={onClear} className="mt-1 text-left text-[11px] text-slate-500 hover:text-slate-300">
            Limpiar selección
          </button>
        )}
      </div>
    </details>
  );
}

export default function CarteraClientTable({ snap, snapPrev, clients, vendors }: Props) {
  const [search, setSearch] = useState('');
  const [fEstado, setFEstado] = useState<Set<Estado>>(new Set());
  const [fCat, setFCat] = useState<Set<Categoria>>(new Set());
  const [fMov, setFMov] = useState<Set<Movimiento>>(new Set());
  const [fVend, setFVend] = useState('');
  const [sort, setSort] = useState<{ k: SortKey; dir: 1 | -1 }>({ k: 'monto', dir: -1 });
  const [page, setPage] = useState(0);

  const toggle = <T,>(set: Set<T>, setter: (s: Set<T>) => void) => (v: T) => {
    const next = new Set(set);
    next.has(v) ? next.delete(v) : next.add(v);
    setter(next);
  };

  const rows = useMemo(() => {
    const searchUpper = search.toUpperCase();
    let list = snap.clientStats.map((c) => ({ c, movimiento: computeMovimiento(c, snapPrev.byCi) }));

    if (searchUpper) list = list.filter((r) => clients[r.c.ci]!.toUpperCase().includes(searchUpper));
    if (fEstado.size > 0) list = list.filter((r) => fEstado.has(r.c.estado));
    if (fCat.size > 0) list = list.filter((r) => fCat.has(r.c.cat));
    if (fMov.size > 0) list = list.filter((r) => fMov.has(r.movimiento as Movimiento));
    if (fVend) list = list.filter((r) => vendors[r.c.vendor] === fVend);

    const dir = sort.dir;
    list.sort((a, b) => {
      switch (sort.k) {
        case 'nombre':
          return dir * clients[a.c.ci]!.localeCompare(clients[b.c.ci]!);
        case 'cat':
          return dir * a.c.cat.localeCompare(b.c.cat);
        case 'estado':
          return dir * a.c.estado.localeCompare(b.c.estado);
        case 'movimiento':
          return dir * a.movimiento.localeCompare(b.movimiento);
        case 'ultima':
          return dir * a.c.lastDate.localeCompare(b.c.lastDate);
        case 'dias':
          return dir * (a.c.daysSince - b.c.daysSince);
        case 'ordenes':
          return dir * (a.c.nOrdersTotal - b.c.nOrdersTotal);
        case 'vendedor':
          return dir * (vendors[a.c.vendor] ?? '').localeCompare(vendors[b.c.vendor] ?? '');
        case 'monto':
        default:
          return dir * (a.c.paretoTotal - b.c.paretoTotal);
      }
    });

    return list;
  }, [snap, snapPrev, clients, vendors, search, fEstado, fCat, fMov, fVend, sort]);

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const clampedPage = Math.min(page, totalPages - 1);
  const pageRows = rows.slice(clampedPage * PAGE_SIZE, clampedPage * PAGE_SIZE + PAGE_SIZE);

  function onHeaderClick(k: SortKey) {
    setPage(0);
    setSort((prev) => (prev.k === k ? { k, dir: (prev.dir * -1) as 1 | -1 } : { k, dir: -1 }));
  }

  function resetPage<T>(setter: (v: T) => void) {
    return (v: T) => {
      setPage(0);
      setter(v);
    };
  }

  const headers: { k: SortKey; label: string }[] = [
    { k: 'nombre', label: 'Cliente' },
    { k: 'cat', label: 'Cat.' },
    { k: 'estado', label: 'Estado' },
    { k: 'movimiento', label: 'Movimiento' },
    { k: 'ultima', label: 'Última compra' },
    { k: 'dias', label: 'Días s/compra' },
    { k: 'monto', label: 'Monto (ventana)' },
    { k: 'ordenes', label: 'Órdenes' },
    { k: 'vendedor', label: 'Vendedor' },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          placeholder="Buscar cliente…"
          value={search}
          onChange={(e) => {
            setPage(0);
            setSearch(e.target.value);
          }}
          className="w-56 rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-100 focus:border-brand-500 focus:outline-none"
        />
        <CheckGroup
          label="Estado"
          options={ESTADOS}
          selected={fEstado}
          onToggle={resetPage(toggle(fEstado, setFEstado))}
          onClear={() => {
            setPage(0);
            setFEstado(new Set());
          }}
        />
        <CheckGroup
          label="Categoría"
          options={CATS}
          selected={fCat}
          onToggle={resetPage(toggle(fCat, setFCat))}
          onClear={() => {
            setPage(0);
            setFCat(new Set());
          }}
        />
        <CheckGroup
          label="Movimiento"
          options={MOVIMIENTOS}
          selected={fMov}
          onToggle={resetPage(toggle(fMov, setFMov))}
          onClear={() => {
            setPage(0);
            setFMov(new Set());
          }}
        />
        <select
          value={fVend}
          onChange={(e) => {
            setPage(0);
            setFVend(e.target.value);
          }}
          className="rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-100 focus:border-brand-500 focus:outline-none"
        >
          <option value="">Todos los vendedores</option>
          {[...vendors].sort().map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-900">
        <table className="w-full min-w-[820px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wide text-slate-500">
              {headers.map((h) => (
                <th
                  key={h.k}
                  onClick={() => onHeaderClick(h.k)}
                  className="cursor-pointer select-none py-2 px-3 font-medium hover:text-slate-300"
                >
                  {h.label}
                  {sort.k === h.k ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 && (
              <tr>
                <td colSpan={headers.length} className="py-8 text-center text-sm text-slate-500">
                  Sin clientes para estos filtros.
                </td>
              </tr>
            )}
            {pageRows.map(({ c, movimiento }) => (
              <tr key={c.ci} className="border-b border-slate-800/60 last:border-0 hover:bg-slate-800/40">
                <td className="py-2 px-3 text-slate-200">{clients[c.ci]}</td>
                <td className="py-2 px-3">
                  <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs font-semibold text-slate-300">{c.cat}</span>
                </td>
                <td className="py-2 px-3">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${ESTADO_PILL[c.estado]}`}>{c.estado}</span>
                </td>
                <td className="py-2 px-3">
                  {MOVIMIENTO_PILL[movimiento] ? (
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${MOVIMIENTO_PILL[movimiento]}`}>{movimiento}</span>
                  ) : (
                    <span className="text-xs text-slate-500">{movimiento}</span>
                  )}
                </td>
                <td className="py-2 px-3 font-mono text-xs text-slate-400">{c.lastDate}</td>
                <td className="py-2 px-3 font-mono text-xs text-slate-300">{c.daysSince}</td>
                <td className="py-2 px-3 font-mono text-xs text-slate-300">{formatCompactCurrency(c.paretoTotal)}</td>
                <td className="py-2 px-3 font-mono text-xs text-slate-300">{c.nOrdersTotal}</td>
                <td className="py-2 px-3 text-xs text-slate-400">{vendors[c.vendor] ?? 'Sin asignar'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>
          {rows.length} clientes · página {clampedPage + 1} de {totalPages}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={clampedPage === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            className="rounded border border-slate-700 px-2 py-1 disabled:opacity-30"
          >
            ← Anterior
          </button>
          <button
            type="button"
            disabled={clampedPage >= totalPages - 1}
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            className="rounded border border-slate-700 px-2 py-1 disabled:opacity-30"
          >
            Siguiente →
          </button>
        </div>
      </div>
    </div>
  );
}

export type { ClienteStat };
