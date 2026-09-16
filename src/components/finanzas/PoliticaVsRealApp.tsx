import { useState } from 'react';
import type { DehydratedState } from '@tanstack/react-query';
import QueryProvider from '../QueryProvider';
import { useApiQuery } from '../dashboard/useApiQuery';
import LastUpdated from '../shared/LastUpdated';
import PoliticaVsRealChart from './PoliticaVsRealChart';
import PoliticaVsRealTable from './PoliticaVsRealTable';
import type { PoliticaVsRealResult } from './types';

interface Props {
  dehydratedState?: DehydratedState;
}

type Corte = 'categoria' | 'clase_abc';

const UMBRAL_DEFAULT_PCT = 20;

function PoliticaVsRealInner() {
  const [corte, setCorte] = useState<Corte>('categoria');
  const [umbralPct, setUmbralPct] = useState(UMBRAL_DEFAULT_PCT);

  const query = useApiQuery<PoliticaVsRealResult>(['politica-vs-real'], '/api/politica-vs-real');

  const rows = query.data ? (corte === 'categoria' ? query.data.porCategoria : query.data.porClaseAbc) : [];
  const total = query.data?.total ?? null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <div className="flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-1 text-sm text-slate-300">
            Agrupar por
            <select
              value={corte}
              onChange={(e) => setCorte(e.target.value as Corte)}
              className="min-w-[12rem] rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-100 focus:border-brand-500 focus:outline-none"
            >
              <option value="categoria">Categoría de producto</option>
              <option value="clase_abc">Clase ABC</option>
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm text-slate-300">
            Umbral de desviación (%)
            <input
              type="number"
              min={0}
              step={1}
              value={umbralPct}
              onChange={(e) => setUmbralPct(Math.max(0, Number(e.target.value)))}
              className="w-24 rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-100 focus:border-brand-500 focus:outline-none"
            />
          </label>
        </div>

        <LastUpdated dataUpdatedAt={query.dataUpdatedAt} />
      </div>

      <p className="rounded border border-slate-800 bg-slate-900 p-3 text-xs text-slate-400">
        Compara el <strong>Capital Objetivo</strong> (Mínimo de reposición × costo unitario — el piso de
        stock, no el máximo) contra el <strong>Capital Real</strong> (stock físico actual valorizado). No
        mide contra un presupuesto de compras disponible: un exceso de capital no es automáticamente un
        error (puede ser una decisión consciente, ej. consolidar flete) — esta herramienta señala dónde
        mirar primero, no emite un juicio automático.
      </p>

      {query.isError && (
        <p className="rounded border border-red-900 bg-red-950/50 p-3 text-sm text-red-300">
          No se pudieron cargar los datos: {(query.error as Error).message}
        </p>
      )}

      {query.isLoading ? (
        <div className="h-64 w-full animate-pulse-slow rounded-lg bg-slate-800/60" />
      ) : (
        <>
          <PoliticaVsRealChart rows={rows} umbralPct={umbralPct} />
          <PoliticaVsRealTable rows={rows} total={total} umbralPct={umbralPct} />
        </>
      )}
    </div>
  );
}

/** Entry point mounted as an Astro client island (`client:load`), same pattern as the other tabs. */
export default function PoliticaVsRealApp({ dehydratedState }: Props) {
  return (
    <QueryProvider dehydratedState={dehydratedState}>
      <PoliticaVsRealInner />
    </QueryProvider>
  );
}
