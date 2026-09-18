import { useMemo, useState } from 'react';
import type { DehydratedState } from '@tanstack/react-query';
import QueryProvider from '../QueryProvider';
import { useApiQuery } from '../dashboard/useApiQuery';
import LastUpdated from '../shared/LastUpdated';
import VentasGerenciaKpiCard from './VentasGerenciaKpiCard';
import VentasGerenciaChart from './VentasGerenciaChart';

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

const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const TRIMESTRES: [string, number[]][] = [
  ['T1', [0, 1, 2]],
  ['T2', [3, 4, 5]],
  ['T3', [6, 7, 8]],
  ['T4', [9, 10, 11]],
];

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

interface PeriodPickerProps {
  nMeses: number;
  periodo: string;
  onChange: (p: string) => void;
}

function PeriodPicker({ nMeses, periodo, onChange }: PeriodPickerProps) {
  const btnClass = (active: boolean, disabled: boolean) =>
    `rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
      disabled
        ? 'cursor-not-allowed border-slate-800 text-slate-700'
        : active
          ? 'border-brand-500 bg-brand-500 text-white'
          : 'border-slate-700 bg-slate-950 text-slate-300 hover:border-brand-500/50'
    }`;

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Mes</span>
        {MESES.map((mes, i) => {
          const disabled = i >= nMeses;
          return (
            <button
              key={mes}
              type="button"
              disabled={disabled}
              className={btnClass(periodo === `M${i}`, disabled)}
              onClick={() => onChange(`M${i}`)}
            >
              {mes}
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Período</span>
        {TRIMESTRES.map(([key, idxs]) => {
          const disabled = !idxs.some((i) => i < nMeses);
          return (
            <button key={key} type="button" disabled={disabled} className={btnClass(periodo === key, disabled)} onClick={() => onChange(key)}>
              {key}
            </button>
          );
        })}
        <button type="button" className={btnClass(periodo === 'ACU', false)} onClick={() => onChange('ACU')}>
          Acumulado
        </button>
      </div>
    </div>
  );
}

function VentasGerenciaInner() {
  const query = useApiQuery<VentasGerenciaResult>(['ventas-gerencia'], '/api/ventas-gerencia');
  const data = query.data;
  const nMeses = data?.mesesConDatos ?? 12;
  const [periodo, setPeriodo] = useState('ACU');

  const idxs = useMemo(() => {
    if (periodo === 'ACU') return Array.from({ length: nMeses }, (_, i) => i);
    if (periodo.startsWith('M')) {
      const i = Number(periodo.slice(1));
      return i < nMeses ? [i] : [];
    }
    const trimestre = TRIMESTRES.find(([key]) => key === periodo);
    return trimestre ? trimestre[1].filter((i) => i < nMeses) : [];
  }, [periodo, nMeses]);

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

      {query.isError && (
        <p className="rounded border border-red-900 bg-red-950/50 p-3 text-sm text-red-300">
          No se pudieron cargar los datos: {(query.error as Error).message}
        </p>
      )}

      {query.isLoading || !data ? (
        <div className="h-64 w-full animate-pulse-slow rounded-lg bg-slate-800/60" />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
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
              label="Block (kg)"
              real={sum(data.real.block, idxs)}
              objetivoProrrateado={objetivoProrrateado(data.objetivo.block, data.diasTranscurridos, data.diasTotal, idxs)}
              unidad="kg"
            />
            <VentasGerenciaKpiCard
              label="Reventa $"
              real={sum(data.real.reventa, idxs)}
              objetivoProrrateado={objetivoProrrateado(data.objetivo.reventa, data.diasTranscurridos, data.diasTotal, idxs)}
              format="currency"
            />
            <VentasGerenciaKpiCard
              label="Total eq. sillones"
              real={eqSillones(sum(data.real.sillones, idxs), sum(data.real.colchones, idxs), sum(data.real.block, idxs))}
              objetivoProrrateado={eqObjetivoProrrateado(data.objetivo, data.diasTranscurridos, data.diasTotal, idxs)}
              unidad="u eq."
              destacado
            />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <VentasGerenciaChart title="Sillones eq." real={data.real.sillones} objetivo={data.objetivo.sillones} nMeses={nMeses} />
            <VentasGerenciaChart title="Colchones" real={data.real.colchones} objetivo={data.objetivo.colchones} nMeses={nMeses} />
            <VentasGerenciaChart title="Block (kg)" real={data.real.block} objetivo={data.objetivo.block} nMeses={nMeses} />
            <VentasGerenciaChart title="Reventa ($)" real={data.real.reventa} objetivo={data.objetivo.reventa} nMeses={nMeses} format="currency" />
          </div>
        </>
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
