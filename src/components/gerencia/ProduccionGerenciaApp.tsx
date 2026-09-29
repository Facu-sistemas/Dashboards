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
import MedidaToggle, { seriesPorMedida, type Medida } from './MedidaToggle';
import UeVsCantidadChart from './UeVsCantidadChart';

interface Props {
  dehydratedState?: DehydratedState;
}

interface ProduccionGerenciaResult {
  year: number;
  months: string[];
  mesesConDatos: number;
  diasTranscurridos: number[];
  diasTotal: number[];
  real: { sillonesUE: number[]; sillonesCant: number[]; colchonesUE: number[]; colchonesCant: number[] };
  objetivo: { sillones: number[]; colchones: number[] };
  objetivoTotalAnual: { sillones: number; colchones: number };
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

function pctOf(real: number, objetivoProrr: number): number | null {
  return objetivoProrr > 0 ? (real / objetivoProrr) * 100 : null;
}

function eqSillonesMonthly(sillones: number[], colchones: number[]): number[] {
  return sillones.map((_, i) => eqSillones(sillones[i] ?? 0, colchones[i] ?? 0));
}

function ProduccionGerenciaInner() {
  const query = useApiQuery<ProduccionGerenciaResult>(['produccion-gerencia'], '/api/produccion-gerencia');
  const data = query.data;
  const nMeses = data?.mesesConDatos ?? 12;
  const [periodo, setPeriodo] = useState('ACU');
  const [medida, setMedida] = useState<Medida>('ue');

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
        {data && <MedidaToggle medida={medida} onChange={setMedida} />}
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
          const series = seriesPorMedida(medida, data.real, data.objetivo, data.objetivoTotalAnual);
          const kpi = (s: typeof series.sillones) => ({
            real: sum(s.real, idxs),
            obj: s.objetivo ? objetivoProrrateado(s.objetivo, data.diasTranscurridos, data.diasTotal, idxs) : 0,
          });
          const sillones = kpi(series.sillones);
          const colchones = kpi(series.colchones);
          // El total equivalente no sigue el toggle: sillones en UE + colchones en unidades, igual que la planilla de objetivos.
          const totalEq = {
            real: eqSillones(sum(data.real.sillonesUE, idxs), sum(data.real.colchonesCant, idxs)),
            obj: eqObjetivoProrrateado(data.objetivo, data.diasTranscurridos, data.diasTotal, idxs),
          };
          const eqRealMonthly = eqSillonesMonthly(data.real.sillonesUE, data.real.colchonesCant);
          const eqObjMonthly = eqSillonesMonthly(data.objetivo.sillones, data.objetivo.colchones);

          return (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {[series.sillones, series.colchones].map((s, i) => {
                  const k = i === 0 ? sillones : colchones;
                  return (
                    <VentasGerenciaKpiCard key={s.label} label={s.label} real={k.real} objetivoProrrateado={k.obj} unidad="u" sinObjetivo={!s.objetivo} objetivoAnual={s.objetivoAnual} nota={s.nota} />
                  );
                })}
                <VentasGerenciaKpiCard
                  label="Total eq. sillones"
                  real={totalEq.real}
                  objetivoProrrateado={totalEq.obj}
                  unidad="u eq."
                  destacado
                  objetivoAnual={eqSillones(data.objetivoTotalAnual.sillones, data.objetivoTotalAnual.colchones)}
                />
              </div>

              <CumplimientoBars
                rows={[
                  { label: series.sillones.label, pct: pctOf(sillones.real, sillones.obj), real: sillones.real, objetivo: sillones.obj, sinObjetivo: !series.sillones.objetivo },
                  { label: series.colchones.label, pct: pctOf(colchones.real, colchones.obj), real: colchones.real, objetivo: colchones.obj, sinObjetivo: !series.colchones.objetivo },
                  { label: 'Total equivalente (unid.)', pct: pctOf(totalEq.real, totalEq.obj), real: totalEq.real, objetivo: totalEq.obj, destacado: true },
                ]}
                nota="Barra hasta 180% · línea = 100% · Total equivalente = sillones + colchones/10."
              />

              <div className="flex flex-col gap-4">
                {[series.sillones, series.colchones].map((s) => (
                  <div key={s.label} className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                    <VentasGerenciaChart title={s.label} real={s.real} objetivo={s.objetivo} nMeses={nMeses} />
                    <DesvioMensualChart title={s.label} real={s.real} objetivo={s.objetivo} notaSinObjetivo={s.nota} diasTranscurridos={data.diasTranscurridos} diasTotal={data.diasTotal} nMeses={nMeses} />
                  </div>
                ))}
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <UeVsCantidadChart title="Sillones" ue={data.real.sillonesUE} cantidad={data.real.sillonesCant} nMeses={nMeses} />
                  <UeVsCantidadChart title="Colchones" ue={data.real.colchonesUE} cantidad={data.real.colchonesCant} nMeses={nMeses} />
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
export default function ProduccionGerenciaApp({ dehydratedState }: Props) {
  return (
    <QueryProvider dehydratedState={dehydratedState}>
      <ProduccionGerenciaInner />
    </QueryProvider>
  );
}
