import { useMemo, useState } from 'react';
import type { DehydratedState } from '@tanstack/react-query';
import QueryProvider from '../QueryProvider';
import { useApiQuery } from '../dashboard/useApiQuery';
import LastUpdated from '../shared/LastUpdated';
import { analizarSobrantes, tieneRetazosDisponibles, type Bloque } from '../../lib/multicorte-calc';
import MulticorteBlockVisual from './MulticorteBlockVisual';

interface Props {
  dehydratedState?: DehydratedState;
}

interface PlanResponse {
  bloques: Bloque[];
  sinMatch: string[];
}

interface DiaOption {
  date: string;
  label: string;
  count: number;
  sinAgendar: boolean;
}

type TipoFiltro = 'todos' | 'enteros' | 'parciales';

function RefreshIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
      <path d="M20 11a8 8 0 0 0-14.6-4.6M4 4v5h5" />
      <path d="M4 13a8 8 0 0 0 14.6 4.6M20 20v-5h-5" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
      <path d="M12 3v12" />
      <path d="M7 10l5 5 5-5" />
      <path d="M4 19h16" />
    </svg>
  );
}

function BlockCard({ bloque, index, checked, onToggle }: { bloque: Bloque; index: number; checked: boolean; onToggle: (index: number) => void }) {
  const { disponibles, scrap } = useMemo(() => analizarSobrantes(bloque), [bloque]);

  return (
    <details className="rounded-lg border border-slate-800 bg-slate-900/60">
      <summary className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3 text-sm text-slate-200">
        <span>
          📦 {bloque.colorBloque.toUpperCase()} — {bloque.anchoBloqueCm}x{bloque.largoBloqueCm}x{bloque.altoBloqueCm} cm — Aprovechamiento:{' '}
          <strong>{bloque.eficiencia.toFixed(1)}%</strong>
        </span>
        <input
          type="checkbox"
          checked={checked}
          onChange={() => onToggle(index)}
          onClick={(e) => e.stopPropagation()}
          className="h-4 w-4 shrink-0 accent-brand-500"
        />
      </summary>

      <div className="border-t border-slate-800 p-4">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Placas que salen por bloque</h4>
            <ul className="space-y-1 text-sm text-slate-300">
              {bloque.placasDetalle.map((d, i) => (
                <li key={i}>- {d}</li>
              ))}
            </ul>
          </div>
          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Análisis de sobrantes</h4>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <div className="mb-1 font-semibold text-emerald-400">Disponible</div>
                {disponibles.length === 0 && <p className="text-slate-500">No hay sobrantes disponibles.</p>}
                {disponibles.map((s, i) => (
                  <p key={i} className="text-slate-300">
                    {s.anchoCm}x{s.largoCm}x{s.espesorCm} cm ({s.eje}) ({s.cantidad}x)
                  </p>
                ))}
              </div>
              <div>
                <div className="mb-1 font-semibold text-amber-400">Scrap</div>
                {scrap.length === 0 && <p className="text-slate-500">No hay scrap.</p>}
                {scrap.map((s, i) => (
                  <p key={i} className="text-slate-300">
                    {s.anchoCm}x{s.largoCm}x{s.espesorCm} cm ({s.eje}) ({s.cantidad}x)
                  </p>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-4">
          <MulticorteBlockVisual bloque={bloque} />
        </div>
      </div>
    </details>
  );
}

function MulticorteInner() {
  const diasQuery = useApiQuery<DiaOption[]>(['multicorte-dias'], '/api/multicorte-dias');
  const dias = diasQuery.data ?? [];

  const [diaFiltro, setDiaFiltro] = useState('Todos');
  const planPath = diaFiltro === 'Todos' ? '/api/multicorte-plan' : `/api/multicorte-plan?date=${diaFiltro}`;
  const planQuery = useApiQuery<PlanResponse>(['multicorte-plan', diaFiltro], planPath);
  const bloques = planQuery.data?.bloques ?? [];
  const sinMatch = planQuery.data?.sinMatch ?? [];

  const [colorFiltro, setColorFiltro] = useState('Todos');
  const [tipoFiltro, setTipoFiltro] = useState<TipoFiltro>('todos');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const colores = useMemo(() => [...new Set(bloques.map((b) => b.colorBloque))].sort(), [bloques]);

  const filtered = useMemo(() => {
    return bloques
      .map((b, index) => ({ b, index }))
      .filter(({ b }) => colorFiltro === 'Todos' || b.colorBloque === colorFiltro)
      .filter(({ b }) => {
        if (tipoFiltro === 'todos') return true;
        const tieneRetazos = tieneRetazosDisponibles(b);
        return tipoFiltro === 'parciales' ? tieneRetazos : !tieneRetazos;
      });
  }, [bloques, colorFiltro, tipoFiltro]);

  const grouped = useMemo(() => {
    const map = new Map<string, { b: Bloque; index: number }[]>();
    for (const item of filtered) {
      const arr = map.get(item.b.colorBloque) ?? [];
      arr.push(item);
      map.set(item.b.colorBloque, arr);
    }
    return [...map.entries()];
  }, [filtered]);

  function toggle(index: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  function selectAllVisible() {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const { index } of filtered) next.add(index);
      return next;
    });
  }

  function deselectAllVisible() {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const { index } of filtered) next.delete(index);
      return next;
    });
  }

  async function exportarExcel() {
    const seleccionados = bloques.filter((_, i) => selected.has(i));
    if (seleccionados.length === 0) {
      setExportError('Seleccioná al menos un bloque para exportar.');
      return;
    }
    setExportError(null);
    setExporting(true);
    try {
      const res = await fetch('/api/multicorte-export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(seleccionados),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? 'No se pudo generar el Excel');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'plan-multicorte.xlsx';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'No se pudo generar el Excel');
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-400">
            Día de planificación:
            <select
              value={diaFiltro}
              onChange={(e) => setDiaFiltro(e.target.value)}
              className="rounded border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-sm text-slate-100 focus:border-brand-500 focus:outline-none"
            >
              <option value="Todos">Todos (acumulado)</option>
              {dias.map((d) => (
                <option key={d.date} value={d.date}>
                  {d.label} ({d.count})
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-400">
            Color:
            <select
              value={colorFiltro}
              onChange={(e) => setColorFiltro(e.target.value)}
              className="rounded border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-sm text-slate-100 focus:border-brand-500 focus:outline-none"
            >
              <option value="Todos">Todos</option>
              {colores.map((c) => (
                <option key={c} value={c}>
                  {c.toUpperCase()}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-400">
            Tipo:
            <select
              value={tipoFiltro}
              onChange={(e) => setTipoFiltro(e.target.value as TipoFiltro)}
              className="rounded border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-sm text-slate-100 focus:border-brand-500 focus:outline-none"
            >
              <option value="todos">Todos</option>
              <option value="enteros">Solo enteros</option>
              <option value="parciales">Solo parciales (con sobrante)</option>
            </select>
          </label>
          <button
            type="button"
            onClick={() => void planQuery.refetch()}
            className="inline-flex items-center gap-1.5 rounded border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-slate-500"
          >
            <RefreshIcon /> Recalcular
          </button>
        </div>
        <LastUpdated dataUpdatedAt={planQuery.dataUpdatedAt} />
      </div>

      {diasQuery.isError && <p className="text-sm text-red-400">No se pudo cargar los días de planificación desde Odoo.</p>}
      {planQuery.isError && <p className="text-sm text-red-400">No se pudo cargar el plan desde Odoo.</p>}

      {sinMatch.length > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-300">
          <strong>{sinMatch.length} producto(s) con demanda sin match en la base técnica:</strong>
          <ul className="ml-4 mt-1 list-disc text-xs">
            {sinMatch.slice(0, 8).map((p, i) => (
              <li key={i}>{p}</li>
            ))}
            {sinMatch.length > 8 && <li>...y {sinMatch.length - 8} más</li>}
          </ul>
        </div>
      )}

      {planQuery.isLoading && <div className="h-40 w-full animate-pulse-slow rounded-lg bg-slate-800/60" />}

      {!planQuery.isLoading && !planQuery.isError && bloques.length === 0 && (
        <p className="rounded-lg border border-dashed border-slate-800 bg-slate-900/40 p-10 text-center text-sm text-slate-500">
          No hay demanda pendiente que matchee la base técnica ahora mismo.
        </p>
      )}

      {!planQuery.isLoading && grouped.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-slate-400">
              {filtered.length} bloque(s) — {selected.size} seleccionado(s)
            </span>
            <button type="button" onClick={selectAllVisible} className="rounded border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-slate-500">
              Seleccionar visibles
            </button>
            <button type="button" onClick={deselectAllVisible} className="rounded border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-slate-500">
              Deseleccionar visibles
            </button>
            <button
              type="button"
              onClick={() => void exportarExcel()}
              disabled={exporting}
              className="inline-flex items-center gap-1.5 rounded bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-500 disabled:opacity-50"
            >
              <DownloadIcon /> {exporting ? 'Generando…' : 'Preparar Excel'}
            </button>
          </div>
          {exportError && <p className="text-sm text-red-400">{exportError}</p>}

          {grouped.map(([color, items]) => (
            <div key={color} className="flex flex-col gap-3">
              <h3 className="text-sm font-semibold text-slate-300">
                {color.toUpperCase()} ({items.length})
              </h3>
              {items.map(({ b, index }) => (
                <BlockCard key={index} bloque={b} index={index} checked={selected.has(index)} onToggle={toggle} />
              ))}
            </div>
          ))}
        </>
      )}
    </div>
  );
}

/** Entry point mounted as an Astro client island, same pattern as the other Producción tabs. */
export default function MulticorteApp({ dehydratedState }: Props) {
  return (
    <QueryProvider dehydratedState={dehydratedState}>
      <MulticorteInner />
    </QueryProvider>
  );
}
