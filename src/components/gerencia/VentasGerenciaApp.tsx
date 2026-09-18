import { useMemo, useState } from 'react';
import type { DehydratedState } from '@tanstack/react-query';
import QueryProvider from '../QueryProvider';
import { useApiQuery } from '../dashboard/useApiQuery';
import LastUpdated from '../shared/LastUpdated';
import VentasGerenciaKpiCard from './VentasGerenciaKpiCard';
import VentasGerenciaChart from './VentasGerenciaChart';
import DesvioMensualChart from './DesvioMensualChart';
import PeriodPicker, { idxsForPeriodo } from './PeriodPicker';
import CumplimientoBars from './CumplimientoBars';
import DiasHabilesStrip from './DiasHabilesStrip';

interface Props {
  dehydratedState?: DehydratedState;
}

interface VentasGerenciaResult {
  year: number;
  months: string[];
  mesesConDatos: number;
  diasTranscurridos: number[];
  diasTotal: number[];
  real: { sillones: number[]; colchones: number[]; block: number[]; reventa: number[] };
  objetivo: { sillones: number[]; colchones: number[]; block: number[]; reventa: number[] };
}

// Sillón equivalente: 1 sillón = 3 colchones = 60kg de block, mismo factor
// que usa el tablero original (public/data/index.html, EQ_COL/EQ_BLO) para
// la KPI "Total eq. sillones". La reventa se mide en $ y queda afuera del
// equivalente en unidades.
const EQ_COL = 3;
const EQ_BLO = 60;

function eqSillones(sillones: number, colchones: number, block: number): number {
  return sillones + colchones / EQ_COL + block / EQ_BLO;
}

function sum(arr: number[], idxs: number[]): number {
  return idxs.reduce((a, i) => a + (arr[i] ?? 0), 0);
}

/** Objetivo prorrateado a días hábiles transcurridos, sumado sobre los meses elegidos — mismo cálculo que objProp() en tabla.gs. */
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

function eqObjetivoProrrateado(objetivo: VentasGerenciaResult['objetivo'], diasTranscurridos: number[], diasTotal: number[], idxs: number[]): number {
  let total = 0;
  for (const i of idxs) {
    const dt = diasTranscurridos[i] ?? 0;
    const dm = diasTotal[i] ?? 0;
    if (!dm) continue;
    total += eqSillones(objetivo.sillones[i] ?? 0, objetivo.colchones[i] ?? 0, objetivo.block[i] ?? 0) * (dt / dm);
  }
  return total;
}

function pctOf(real: number, objetivoProrr: number): number | null {
  return objetivoProrr > 0 ? (real / objetivoProrr) * 100 : null;
}

/** Serie mensual (12 meses) del total equivalente en sillones, real u objetivo. */
function eqSillonesMonthly(sillones: number[], colchones: number[], block: number[]): number[] {
  return sillones.map((_, i) => eqSillones(sillones[i] ?? 0, colchones[i] ?? 0, block[i] ?? 0));
}

function VentasGerenciaInner() {
  const query = useApiQuery<VentasGerenciaResult>(['ventas-gerencia'], '/api/ventas-gerencia');
  const data = query.data;
  const nMeses = data?.mesesConDatos ?? 12;
  const [periodo, setPeriodo] = useState('ACU');

  const idxs = useMemo(() => idxsForPeriodo(periodo, nMeses), [periodo, nMeses]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="text-xs text-slate-400">
            {data?.year ?? ''} · unidades/$ reales desde Odoo (pedidos confirmados), objetivo desde el tablero de gestión de Odoo.
          </p>
          <LastUpdated dataUpdatedAt={query.dataUpdatedAt} />
        </div>
        {data && <PeriodPicker nMeses={nMeses} periodo={periodo} onChange={setPeriodo} />}
      </div>

      {data && <DiasHabilesStrip diasTranscurridos={data.diasTranscurridos} diasTotal={data.diasTotal} idxs={idxs} />}

      {query.isError && (
        <p className="rounded border border-red-900 bg-red-950/50 p-3 text-sm text-red-300">
          No se pudieron cargar los datos: {(query.error as Error).message}
        </p>
      )}

      {query.isLoading || !data ? (
        <div className="h-64 w-full animate-pulse-slow rounded-lg bg-slate-800/60" />
      ) : (
        (() => {
          const sillones = { real: sum(data.real.sillones, idxs), obj: objetivoProrrateado(data.objetivo.sillones, data.diasTranscurridos, data.diasTotal, idxs) };
          const colchones = { real: sum(data.real.colchones, idxs), obj: objetivoProrrateado(data.objetivo.colchones, data.diasTranscurridos, data.diasTotal, idxs) };
          const block = { real: sum(data.real.block, idxs), obj: objetivoProrrateado(data.objetivo.block, data.diasTranscurridos, data.diasTotal, idxs) };
          const reventa = { real: sum(data.real.reventa, idxs), obj: objetivoProrrateado(data.objetivo.reventa, data.diasTranscurridos, data.diasTotal, idxs) };
          const totalEq = {
            real: eqSillones(sillones.real, colchones.real, block.real),
            obj: eqObjetivoProrrateado(data.objetivo, data.diasTranscurridos, data.diasTotal, idxs),
          };
          const eqRealMonthly = eqSillonesMonthly(data.real.sillones, data.real.colchones, data.real.block);
          const eqObjMonthly = eqSillonesMonthly(data.objetivo.sillones, data.objetivo.colchones, data.objetivo.block);

          return (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <VentasGerenciaKpiCard label="Sillones eq." real={sillones.real} objetivoProrrateado={sillones.obj} unidad="u" />
                <VentasGerenciaKpiCard label="Colchones" real={colchones.real} objetivoProrrateado={colchones.obj} unidad="u" />
                <VentasGerenciaKpiCard label="Block (kg)" real={block.real} objetivoProrrateado={block.obj} unidad="kg" />
                <VentasGerenciaKpiCard label="Reventa $" real={reventa.real} objetivoProrrateado={reventa.obj} format="currency" />
                <VentasGerenciaKpiCard label="Total eq. sillones" real={totalEq.real} objetivoProrrateado={totalEq.obj} unidad="u eq." destacado />
              </div>

              <CumplimientoBars
                rows={[
                  { label: 'Sillones eq.', pct: pctOf(sillones.real, sillones.obj), real: sillones.real, objetivo: sillones.obj },
                  { label: 'Colchones', pct: pctOf(colchones.real, colchones.obj), real: colchones.real, objetivo: colchones.obj },
                  { label: 'Block kg', pct: pctOf(block.real, block.obj), real: block.real, objetivo: block.obj },
                  { label: 'Reventa $', pct: pctOf(reventa.real, reventa.obj), real: reventa.real, objetivo: reventa.obj, format: 'currency' },
                  { label: 'Total equivalente (unid.)', pct: pctOf(totalEq.real, totalEq.obj), real: totalEq.real, objetivo: totalEq.obj, destacado: true },
                ]}
                nota="Barra hasta 180% · línea = 100% · Reventa se mide en $ y no forma parte del total equivalente en unidades."
              />

              <div className="flex flex-col gap-4">
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <VentasGerenciaChart title="Sillones eq." real={data.real.sillones} objetivo={data.objetivo.sillones} nMeses={nMeses} />
                  <DesvioMensualChart title="Sillones eq." real={data.real.sillones} objetivo={data.objetivo.sillones} diasTranscurridos={data.diasTranscurridos} diasTotal={data.diasTotal} nMeses={nMeses} />
                </div>
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <VentasGerenciaChart title="Colchones" real={data.real.colchones} objetivo={data.objetivo.colchones} nMeses={nMeses} />
                  <DesvioMensualChart title="Colchones" real={data.real.colchones} objetivo={data.objetivo.colchones} diasTranscurridos={data.diasTranscurridos} diasTotal={data.diasTotal} nMeses={nMeses} />
                </div>
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <VentasGerenciaChart title="Block (kg)" real={data.real.block} objetivo={data.objetivo.block} nMeses={nMeses} />
                  <DesvioMensualChart title="Block (kg)" real={data.real.block} objetivo={data.objetivo.block} diasTranscurridos={data.diasTranscurridos} diasTotal={data.diasTotal} nMeses={nMeses} />
                </div>
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <VentasGerenciaChart title="Reventa ($)" real={data.real.reventa} objetivo={data.objetivo.reventa} nMeses={nMeses} format="currency" />
                  <DesvioMensualChart title="Reventa ($)" real={data.real.reventa} objetivo={data.objetivo.reventa} diasTranscurridos={data.diasTranscurridos} diasTotal={data.diasTotal} nMeses={nMeses} format="currency" />
                </div>
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <VentasGerenciaChart title="Total equivalente (sillones)" real={eqRealMonthly} objetivo={eqObjMonthly} nMeses={nMeses} />
                  <DesvioMensualChart title="Total equivalente (sillones)" real={eqRealMonthly} objetivo={eqObjMonthly} diasTranscurridos={data.diasTranscurridos} diasTotal={data.diasTotal} nMeses={nMeses} />
                </div>
              </div>
            </>
          );
        })()
      )}
    </div>
  );
}

/** Entry point mounted as an Astro client island (`client:load`), same pattern as the other tabs. */
export default function VentasGerenciaApp({ dehydratedState }: Props) {
  return (
    <QueryProvider dehydratedState={dehydratedState}>
      <VentasGerenciaInner />
    </QueryProvider>
  );
}
