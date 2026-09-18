import { useMemo, useState } from 'react';
import type { DehydratedState } from '@tanstack/react-query';
import QueryProvider from '../QueryProvider';
import { useApiQuery } from '../dashboard/useApiQuery';
import LastUpdated from '../shared/LastUpdated';
import VentasGerenciaKpiCard from './VentasGerenciaKpiCard';
import VentasGerenciaChart from './VentasGerenciaChart';
import PeriodPicker, { idxsForPeriodo } from './PeriodPicker';

interface Props {
  dehydratedState?: DehydratedState;
}

interface ProduccionGerenciaResult {
  year: number;
  months: string[];
  mesesConDatos: number;
  diasTranscurridos: number[];
  diasTotal: number[];
  real: { sillones: number[]; colchones: number[] };
  objetivo: { sillones: number[]; colchones: number[] };
}

// Producción usa una relación colchón/sillón distinta de Ventas/Facturación
// (1 sillón = 10 colchones, no 3) — misma convención que el tablero
// original (public/data/index.html, EQ_COL_PROD), surge de las propias
// filas "Consensuado equivalente Unidades" de la planilla de objetivos.
const EQ_COL_PROD = 10;

function eqSillones(sillones: number, colchones: number): number {
  return sillones + colchones / EQ_COL_PROD;
}

function sum(arr: number[], idxs: number[]): number {
  return idxs.reduce((a, i) => a + (arr[i] ?? 0), 0);
}

function objetivoProrrateado(objetivoMensual: number[], diasTranscurridos: number[], diasTotal: number[], idxs: number[]): number {
  let total = 0;
  for (const i of idxs) {
    const dt = diasTranscurridos[i] ?? 0;
    const dm = diasTotal[i] ?? 0;
    if (!dm) continue;
    total += (objetivoMensual[i] ?? 0) * (dt / dm);
  }
  return total;
}

function eqObjetivoProrrateado(objetivo: ProduccionGerenciaResult['objetivo'], diasTranscurridos: number[], diasTotal: number[], idxs: number[]): number {
  let total = 0;
  for (const i of idxs) {
    const dt = diasTranscurridos[i] ?? 0;
    const dm = diasTotal[i] ?? 0;
    if (!dm) continue;
    total += eqSillones(objetivo.sillones[i] ?? 0, objetivo.colchones[i] ?? 0) * (dt / dm);
  }
  return total;
}

function ProduccionGerenciaInner() {
  const query = useApiQuery<ProduccionGerenciaResult>(['produccion-gerencia'], '/api/produccion-gerencia');
  const data = query.data;
  const nMeses = data?.mesesConDatos ?? 12;
  const [periodo, setPeriodo] = useState('ACU');

  const idxs = useMemo(() => idxsForPeriodo(periodo, nMeses), [periodo, nMeses]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="text-xs text-slate-400">
            {data?.year ?? ''} · unidades reales terminadas en planta (Odoo, mrp.production), objetivo desde el tablero de gestión de Odoo.
          </p>
          <LastUpdated dataUpdatedAt={query.dataUpdatedAt} />
        </div>
        {data && <PeriodPicker nMeses={nMeses} periodo={periodo} onChange={setPeriodo} />}
      </div>

      {query.isError && (
        <p className="rounded border border-red-900 bg-red-950/50 p-3 text-sm text-red-300">
          No se pudieron cargar los datos: {(query.error as Error).message}
        </p>
      )}

      {query.isLoading || !data ? (
        <div className="h-64 w-full animate-pulse-slow rounded-lg bg-slate-800/60" />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <VentasGerenciaKpiCard
              label="Sillones eq."
              real={sum(data.real.sillones, idxs)}
              objetivoProrrateado={objetivoProrrateado(data.objetivo.sillones, data.diasTranscurridos, data.diasTotal, idxs)}
              unidad="u"
            />
            <VentasGerenciaKpiCard
              label="Colchones"
              real={sum(data.real.colchones, idxs)}
              objetivoProrrateado={objetivoProrrateado(data.objetivo.colchones, data.diasTranscurridos, data.diasTotal, idxs)}
              unidad="u"
            />
            <VentasGerenciaKpiCard
              label="Total eq. sillones"
              real={eqSillones(sum(data.real.sillones, idxs), sum(data.real.colchones, idxs))}
              objetivoProrrateado={eqObjetivoProrrateado(data.objetivo, data.diasTranscurridos, data.diasTotal, idxs)}
              unidad="u eq."
              destacado
            />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <VentasGerenciaChart title="Sillones eq." real={data.real.sillones} objetivo={data.objetivo.sillones} nMeses={nMeses} />
            <VentasGerenciaChart title="Colchones" real={data.real.colchones} objetivo={data.objetivo.colchones} nMeses={nMeses} />
          </div>
        </>
      )}
    </div>
  );
}

/** Entry point mounted as an Astro client island (`client:load`), same pattern as the other tabs. */
export default function ProduccionGerenciaApp({ dehydratedState }: Props) {
  return (
    <QueryProvider dehydratedState={dehydratedState}>
      <ProduccionGerenciaInner />
    </QueryProvider>
  );
}
