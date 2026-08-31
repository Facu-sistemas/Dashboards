import { useMemo, useState } from 'react';
import type { DehydratedState } from '@tanstack/react-query';
import QueryProvider from '../QueryProvider';
import { useApiQuery } from '../dashboard/useApiQuery';
import ModeloSearchTable from './ModeloSearchTable';
import PedidoListonesTable from './PedidoListonesTable';
import LastUpdated from '../shared/LastUpdated';
import type { PedidoAgregado, PedidoListonRow, RecetaListonRow } from './types';

interface Props {
  dehydratedState?: DehydratedState;
}

const numberFmt = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 });

function pedidoKey(medida: string, largoCm: number): string {
  return `${medida}|${largoCm}`;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function CarpinteriaInner() {
  const [selected, setSelected] = useState<string | null>(null);
  const [cantidadInput, setCantidadInput] = useState('');
  const [pedido, setPedido] = useState<Map<string, PedidoListonRow>>(new Map());
  const [historial, setHistorial] = useState<PedidoAgregado[]>([]);
  const [fecha, setFecha] = useState(todayIso());
  const [linea, setLinea] = useState('');
  const [generandoEtiqueta, setGenerandoEtiqueta] = useState(false);
  const [etiquetaError, setEtiquetaError] = useState<string | null>(null);
  const [listUpdatedAt, setListUpdatedAt] = useState<number>(0);

  const recetaQuery = useApiQuery<RecetaListonRow[]>(
    ['carpinteria-receta', selected ?? null],
    selected ? `/api/carpinteria-receta?modelo=${encodeURIComponent(selected)}` : '',
    { enabled: selected !== null }
  );

  const cantidad = Number(cantidadInput);
  const cantidadValida = cantidadInput.trim() !== '' && Number.isFinite(cantidad) && cantidad > 0;
  const receta = recetaQuery.data ?? [];

  function agregarAlPedido() {
    if (!selected || receta.length === 0 || !cantidadValida) return;

    setPedido((prev) => {
      const next = new Map(prev);
      for (const row of receta) {
        const key = pedidoKey(row.medida, row.largoCm);
        const piezas = row.piezasPorUnidad * cantidad;
        const existing = next.get(key);
        if (existing) {
          next.set(key, { ...existing, piezas: existing.piezas + piezas });
        } else {
          next.set(key, { medida: row.medida, largoCm: row.largoCm, piezas, color: row.color });
        }
      }
      return next;
    });

    setHistorial((prev) => [...prev, { modelo: selected, cantidad }]);
    setCantidadInput('');
  }

  function limpiarPedido() {
    setPedido(new Map());
    setHistorial([]);
    setEtiquetaError(null);
  }

  const filas = [...pedido.values()];
  const filas1x2 = filas.filter((f) => f.medida === '1X2').sort((a, b) => a.largoCm - b.largoCm);
  const filasOtras = filas.filter((f) => f.medida !== '1X2').sort((a, b) => a.medida.localeCompare(b.medida) || a.largoCm - b.largoCm);
  const lineaValida = linea.trim() !== '';

  // Sums repeated "agregar al pedido" clicks for the same modelo into one
  // entry — the etiqueta shows "2xAero Rinconero", not two separate lines.
  const modelosAgregados = useMemo(() => {
    const totals = new Map<string, number>();
    for (const h of historial) {
      totals.set(h.modelo, (totals.get(h.modelo) ?? 0) + h.cantidad);
    }
    return [...totals.entries()].map(([modelo, cantidad]) => ({ modelo, cantidad }));
  }, [historial]);

  async function generarEtiqueta() {
    if (historial.length === 0 || !lineaValida) return;
    setGenerandoEtiqueta(true);
    setEtiquetaError(null);
    try {
      const res = await fetch('/api/carpinteria-etiqueta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fecha, linea: linea.trim(), modelos: modelosAgregados, filas1x2, filasOtras }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? 'No se pudo generar el PDF.');
      }
      const filenameHeader = res.headers.get('X-Etiqueta-Filename');
      const filename = filenameHeader ? decodeURIComponent(filenameHeader) : 'etiqueta.pdf';
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setEtiquetaError(err instanceof Error ? err.message : 'No se pudo generar el PDF.');
    } finally {
      setGenerandoEtiqueta(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-end">
        <LastUpdated dataUpdatedAt={recetaQuery.dataUpdatedAt || listUpdatedAt} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[360px_1fr]">
        <ModeloSearchTable selectedModelo={selected} onSelect={(name) => setSelected(name)} onDataUpdatedAt={setListUpdatedAt} />

        <section className="flex flex-col gap-4 rounded-lg border border-slate-800 bg-slate-900 p-4">
          {!selected ? (
            <p className="py-16 text-center text-sm text-slate-500">
              Elegí un modelo de sillón de la lista para ver su receta de listones.
            </p>
          ) : recetaQuery.isLoading ? (
            <div className="h-40 w-full animate-pulse-slow rounded-lg bg-slate-800/60" />
          ) : recetaQuery.isError ? (
            <p className="text-sm text-red-400">No se pudo cargar la receta de {selected}.</p>
          ) : receta.length === 0 ? (
            <p className="text-sm text-slate-500">{selected} no tiene listones cargados.</p>
          ) : (
            <>
              <h3 className="text-sm font-medium text-slate-300">{selected}</h3>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[320px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wide text-slate-500">
                      <th className="py-2 pr-4 font-medium">Medida</th>
                      <th className="py-2 pr-4 font-medium">Largo (cm)</th>
                      <th className="py-2 font-medium">Piezas / unidad</th>
                    </tr>
                  </thead>
                  <tbody>
                    {receta.map((r) => (
                      <tr key={`${r.medida}-${r.largoCm}`} className="border-b border-slate-800/60 last:border-0">
                        <td className="py-2 pr-4 text-slate-200">{r.medida}</td>
                        <td className="py-2 pr-4 text-slate-300">{numberFmt.format(r.largoCm)}</td>
                        <td className="py-2 text-slate-300">{numberFmt.format(r.piezasPorUnidad)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-wrap items-end gap-3 border-t border-slate-800 pt-4">
                <label className="flex flex-col gap-1 text-sm text-slate-300">
                  Cantidad a producir
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={cantidadInput}
                    onChange={(e) => setCantidadInput(e.target.value)}
                    className="w-32 rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-100 focus:border-brand-500 focus:outline-none"
                  />
                </label>
                <button
                  type="button"
                  disabled={!cantidadValida}
                  onClick={agregarAlPedido}
                  className="rounded bg-brand-500 px-4 py-1.5 text-sm font-medium text-slate-950 transition-colors hover:bg-brand-400 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Agregar al pedido
                </button>
              </div>
            </>
          )}
        </section>
      </div>

      <div className="flex flex-col gap-4 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h3 className="text-sm font-medium text-slate-300">Pedido acumulado</h3>

          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-sm text-slate-300">
              Fecha
              <input
                type="date"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
                className="rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-100 focus:border-brand-500 focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-slate-300">
              Línea
              <input
                type="text"
                value={linea}
                onChange={(e) => setLinea(e.target.value)}
                placeholder="Ej: 1"
                className="w-24 rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-100 placeholder:text-slate-600 focus:border-brand-500 focus:outline-none"
              />
            </label>
            <button
              type="button"
              disabled={historial.length === 0 || !lineaValida || generandoEtiqueta}
              onClick={generarEtiqueta}
              className="rounded bg-brand-500 px-4 py-1.5 text-sm font-medium text-slate-950 transition-colors hover:bg-brand-400 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {generandoEtiqueta ? 'Generando…' : 'Generar Etiqueta'}
            </button>
            <button
              type="button"
              disabled={historial.length === 0}
              onClick={limpiarPedido}
              className="rounded border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-red-500 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Limpiar pedido
            </button>
          </div>
        </div>

        {etiquetaError && <p className="text-sm text-red-400">{etiquetaError}</p>}

        {historial.length > 0 && (
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
            {historial.map((h, i) => (
              <li key={i}>
                {h.modelo} × {h.cantidad}
              </li>
            ))}
          </ul>
        )}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <PedidoListonesTable title="Listones 1x2" rows={filas1x2} />
          <PedidoListonesTable title="Otras medidas" rows={filasOtras} />
        </div>
      </div>
    </div>
  );
}

/** Entry point mounted as an Astro client island (`client:load`), same pattern as the other tabs. */
export default function CarpinteriaApp({ dehydratedState }: Props) {
  return (
    <QueryProvider dehydratedState={dehydratedState}>
      <CarpinteriaInner />
    </QueryProvider>
  );
}
