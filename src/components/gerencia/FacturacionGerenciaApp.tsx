import { useMemo, useState } from 'react';
import type { DehydratedState } from '@tanstack/react-query';
import QueryProvider from '../QueryProvider';
import { useApiQuery } from '../dashboard/useApiQuery';
import LastUpdated from '../shared/LastUpdated';
import VentasGerenciaKpiCard from './VentasGerenciaKpiCard';
import VentasGerenciaChart from './VentasGerenciaChart';
import DesvioMensualChart from './DesvioMensualChart';
import FacturacionMontoChart from './FacturacionMontoChart';
import PeriodPicker, { idxsForPeriodo } from './PeriodPicker';
import CumplimientoBars from './CumplimientoBars';
import DiasHabilesStrip from './DiasHabilesStrip';

interface Props {
  dehydratedState?: DehydratedState;
}

interface FacturacionGerenciaResult {
  year: number;
  months: string[];
  mesesConDatos: number;
  diasTranscurridos: number[];
  diasTotal: number[];
  real: {
    sillones: number[];
    colchones: number[];
    block: number[];
    sillonesPesos: number[];
    colchonesPesos: number[];
    blockPesos: number[];
    reventaPesos: number[];
    fletePesos: number[];
    totalPesos: number[];
  };
  objetivo: { sillones: number[]; colchones: number[]; block: number[]; totalPesos: number[] };
}

// Sillón equivalente: mismo factor que Ventas (1 sillón = 3 colchones = 60kg
// de block) — Facturación comparte esa convención con Ventas, a diferencia
// de Producción (ver ProduccionGerenciaApp.tsx, EQ_COL_PROD = 10).
const EQ_COL = 3;
const EQ_BLO = 60;

function eqSillones(sillones: number, colchones: number, block: number): number {
  return sillones + colchones / EQ_COL + block / EQ_BLO;
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

function eqObjetivoProrrateado(objetivo: FacturacionGerenciaResult['objetivo'], diasTranscurridos: number[], diasTotal: number[], idxs: number[]): number {
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

function eqSillonesMonthly(sillones: number[], colchones: number[], block: number[]): number[] {
  return sillones.map((_, i) => eqSillones(sillones[i] ?? 0, colchones[i] ?? 0, block[i] ?? 0));
}

function FacturacionGerenciaInner() {
  const query = useApiQuery<FacturacionGerenciaResult>(['facturacion-gerencia'], '/api/facturacion-gerencia');
  const data = query.data;
  const nMeses = data?.mesesConDatos ?? 12;
  const [periodo, setPeriodo] = useState('ACU');

  const idxs = useMemo(() => idxsForPeriodo(periodo, nMeses), [periodo, nMeses]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="text-xs text-slate-400">
            {data?.year ?? ''} · unidades y $ reales desde Odoo (facturas de cliente posteadas), objetivo desde el tablero de gestión de
            Odoo.
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
          const totalEq = {
            real: eqSillones(sillones.real, colchones.real, block.real),
            obj: eqObjetivoProrrateado(data.objetivo, data.diasTranscurridos, data.diasTotal, idxs),
          };
          const eqRealMonthly = eqSillonesMonthly(data.real.sillones, data.real.colchones, data.real.block);
          const eqObjMonthly = eqSillonesMonthly(data.objetivo.sillones, data.objetivo.colchones, data.objetivo.block);

          const totalPesos = { real: sum(data.real.totalPesos, idxs), obj: objetivoProrrateado(data.objetivo.totalPesos, data.diasTranscurridos, data.diasTotal, idxs) };
          const sillonesPesos = sum(data.real.sillonesPesos, idxs);
          const colchonesPesos = sum(data.real.colchonesPesos, idxs);
          const blockPesos = sum(data.real.blockPesos, idxs);
          const reventaPesos = sum(data.real.reventaPesos, idxs);
          const fletePesos = sum(data.real.fletePesos, idxs);

          return (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <VentasGerenciaKpiCard label="Sillones eq." real={sillones.real} objetivoProrrateado={sillones.obj} unidad="u" />
                <VentasGerenciaKpiCard label="Colchones" real={colchones.real} objetivoProrrateado={colchones.obj} unidad="u" />
                <VentasGerenciaKpiCard label="Block (kg)" real={block.real} objetivoProrrateado={block.obj} unidad="kg" />
                <VentasGerenciaKpiCard label="Total eq. sillones" real={totalEq.real} objetivoProrrateado={totalEq.obj} unidad="u eq." destacado />
              </div>

              <CumplimientoBars
                rows={[
                  { label: 'Sillones eq.', pct: pctOf(sillones.real, sillones.obj), real: sillones.real, objetivo: sillones.obj },
                  { label: 'Colchones', pct: pctOf(colchones.real, colchones.obj), real: colchones.real, objetivo: colchones.obj },
                  { label: 'Block kg', pct: pctOf(block.real, block.obj), real: block.real, objetivo: block.obj },
                  { label: 'Total equivalente (unid.)', pct: pctOf(totalEq.real, totalEq.obj), real: totalEq.real, objetivo: totalEq.obj, destacado: true },
                ]}
                nota="Facturación en unidades (facturas de cliente posteadas) · Barra hasta 180% · línea = 100%."
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
                  <VentasGerenciaChart title="Total equivalente (sillones)" real={eqRealMonthly} objetivo={eqObjMonthly} nMeses={nMeses} />
                  <DesvioMensualChart title="Total equivalente (sillones)" real={eqRealMonthly} objetivo={eqObjMonthly} diasTranscurridos={data.diasTranscurridos} diasTotal={data.diasTotal} nMeses={nMeses} />
                </div>
              </div>

              <div>
                <h3 className="mb-3 border-b border-slate-800 pb-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  Facturación en $
                </h3>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <VentasGerenciaKpiCard label="Total facturado $" real={totalPesos.real} objetivoProrrateado={totalPesos.obj} format="currency" destacado />
                  <VentasGerenciaKpiCard label="Sillones $" real={sillonesPesos} objetivoProrrateado={0} format="currency" sinObjetivo />
                  <VentasGerenciaKpiCard label="Colchones $" real={colchonesPesos} objetivoProrrateado={0} format="currency" sinObjetivo />
                  <VentasGerenciaKpiCard label="Block $" real={blockPesos} objetivoProrrateado={0} format="currency" sinObjetivo />
                  <VentasGerenciaKpiCard label="Reventa $" real={reventaPesos} objetivoProrrateado={0} format="currency" sinObjetivo />
                  <VentasGerenciaKpiCard label="Flete $" real={fletePesos} objetivoProrrateado={0} format="currency" sinObjetivo />
                </div>
                <p className="mt-3 text-[10px] text-slate-500">
                  El tablero de gestión de Odoo solo define objetivo para el total facturado en $, no por categoría — por eso el desglose
                  (Sillones/Colchones/Block/Reventa/Flete) muestra solo el real.
                </p>
              </div>

              <div className="flex flex-col gap-4">
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <VentasGerenciaChart title="Total facturado ($)" real={data.real.totalPesos} objetivo={data.objetivo.totalPesos} nMeses={nMeses} format="currency" />
                  <DesvioMensualChart title="Total facturado ($)" real={data.real.totalPesos} objetivo={data.objetivo.totalPesos} diasTranscurridos={data.diasTranscurridos} diasTotal={data.diasTotal} nMeses={nMeses} format="currency" />
                </div>
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <FacturacionMontoChart title="Sillones ($)" real={data.real.sillonesPesos} nMeses={nMeses} />
                  <FacturacionMontoChart title="Colchones ($)" real={data.real.colchonesPesos} nMeses={nMeses} />
                </div>
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <FacturacionMontoChart title="Block ($)" real={data.real.blockPesos} nMeses={nMeses} />
                  <FacturacionMontoChart title="Reventa ($)" real={data.real.reventaPesos} nMeses={nMeses} />
                </div>
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <FacturacionMontoChart title="Flete ($)" real={data.real.fletePesos} nMeses={nMeses} />
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
export default function FacturacionGerenciaApp({ dehydratedState }: Props) {
  return (
    <QueryProvider dehydratedState={dehydratedState}>
      <FacturacionGerenciaInner />
    </QueryProvider>
  );
}
