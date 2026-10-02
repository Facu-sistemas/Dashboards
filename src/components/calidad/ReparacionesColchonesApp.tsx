import { useState } from 'react';
import type { DehydratedState } from '@tanstack/react-query';
import QueryProvider from '../QueryProvider';
import { useApiQuery } from '../dashboard/useApiQuery';
import LastUpdated from '../shared/LastUpdated';
import ReparacionesVsProduccionChart from './ReparacionesVsProduccionChart';
import HorasYRecuperadoChart from './HorasYRecuperadoChart';
import type { CalidadRange, ReparacionesResult } from './types';

interface Props {
  initialRange: CalidadRange;
  dehydratedState?: DehydratedState;
}

const RANGE_OPTIONS: { value: CalidadRange; label: string }[] = [
  { value: 'all', label: 'Histórico completo' },
  { value: 'this-year', label: 'Este año' },
  { value: 'last-12-months', label: 'Últimos 12 meses' },
  { value: 'last-6-months', label: 'Últimos 6 meses' },
];

const money = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
const numero = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });

function SectorHeader({ sectorName, accent }: { sectorName: string; accent: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${accent}`} />
      <h2 className="text-base font-semibold uppercase tracking-wide text-slate-200">{sectorName}</h2>
      <div className="h-px flex-1 bg-slate-800" />
    </div>
  );
}

function KpiCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-semibold text-slate-100">{value}</p>
    </div>
  );
}

function LivingSection({ data }: { data: ReparacionesResult['living'] }) {
  const puntosVsProduccion = data.mensual.map((p) => ({
    month: p.month,
    unidadesFabricadas: p.unidadesFabricadas,
    cantidad: p.cantidadReparaciones,
    ratio: p.reparacionesPorMilUnidades,
  }));
  const puntosMontoHoras = data.mensual.map((p) => ({ month: p.month, monto: p.totalRecuperado, horas: p.horasReparacion }));

  return (
    <div className="flex flex-col gap-4">
      <SectorHeader sectorName="Living" accent="bg-brand-500" />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KpiCard label="Reparaciones" value={numero.format(data.totalReparaciones)} />
        <KpiCard label="Sillones fabricados" value={numero.format(data.totalUnidadesFabricadas)} />
        <KpiCard label="Horas de reparación" value={`${numero.format(data.totalHoras)} hs`} />
        <KpiCard label="Plata recuperada" value={money.format(data.totalRecuperado)} />
      </div>

      <section className="flex flex-col gap-4 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <div>
          <h3 className="text-sm font-medium text-slate-300">Reparaciones de Living vs. sillones fabricados</h3>
          <p className="mt-1 text-xs text-slate-500">
            Cruza las órdenes de reparación de Living (devoluciones, `repair.order`) contra lo fabricado ese mismo mes. La
            línea es la tasa: cuántas reparaciones hubo por cada 1000 unidades fabricadas. Sujeto a revisión — a diferencia
            de Colchón, todavía no se confirmó una fuente más completa para Living.
          </p>
        </div>
        <ReparacionesVsProduccionChart
          points={puntosVsProduccion}
          fabricadoLabel="Sillones fabricados"
          cantidadLabel="Reparaciones"
          ratioLabel="Reparaciones por c/1000 fabricadas"
        />
      </section>

      <section className="flex flex-col gap-4 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <h3 className="text-sm font-medium text-slate-300">Horas de reparación y plata recuperada</h3>
        <HorasYRecuperadoChart points={puntosMontoHoras} montoLabel="Plata recuperada" />
      </section>
    </div>
  );
}

function ColchonSection({ data }: { data: ReparacionesResult['colchon'] }) {
  const puntosVsProduccion = data.mensual.map((p) => ({
    month: p.month,
    unidadesFabricadas: p.unidadesFabricadas,
    cantidad: p.cantidadNotasCredito,
    ratio: p.notasCreditoPorMilUnidades,
  }));
  const puntosMontoHoras = data.mensual.map((p) => ({ month: p.month, monto: p.montoNotasCredito, horas: p.horasReparacion }));

  return (
    <div className="flex flex-col gap-4">
      <SectorHeader sectorName="Colchón" accent="bg-accent-emerald" />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KpiCard label="Notas de crédito" value={numero.format(data.totalNotasCredito)} />
        <KpiCard label="Colchones fabricados" value={numero.format(data.totalUnidadesFabricadas)} />
        <KpiCard label="Horas de reparación" value={`${numero.format(data.totalHoras)} hs`} />
        <KpiCard label="Monto de notas de crédito" value={money.format(data.totalMontoNotasCredito)} />
      </div>

      <section className="flex flex-col gap-4 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <div>
          <h3 className="text-sm font-medium text-slate-300">Notas de crédito de Colchón vs. colchones fabricados</h3>
          <p className="mt-1 text-xs text-slate-500">
            A pedido de Calidad, Colchón usa Notas de Crédito por Garantía + No conformidad (motivo "Calidad" en Odoo) en
            vez de órdenes de reparación — tienen mejor cobertura de carga. Cruzadas contra lo fabricado ese mismo mes. La
            línea es la tasa: cuántas notas de crédito hubo por cada 1000 colchones fabricados. El campo Sector/Motivo recién
            se empezó a cargar en Odoo en septiembre 2026, así que todavía hay un solo mes de historia — va a crecer un mes
            por vez.
          </p>
        </div>
        <ReparacionesVsProduccionChart
          points={puntosVsProduccion}
          fabricadoLabel="Colchones fabricados"
          cantidadLabel="Notas de crédito"
          ratioLabel="Notas de crédito por c/1000 fabricadas"
        />
      </section>

      <section className="flex flex-col gap-4 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <div>
          <h3 className="text-sm font-medium text-slate-300">Monto de notas de crédito y horas de reparación</h3>
          <p className="mt-1 text-xs text-slate-500">
            El monto sale de las mismas notas de crédito de arriba. Las horas siguen viniendo de `repair.order` (único
            lugar donde se cargan) — no son necesariamente las mismas órdenes que generaron esas notas de crédito.
          </p>
        </div>
        <HorasYRecuperadoChart points={puntosMontoHoras} montoLabel="Monto de notas de crédito" />
      </section>
    </div>
  );
}

function ReparacionesColchonesInner({ initialRange }: { initialRange: CalidadRange }) {
  const [range, setRange] = useState<CalidadRange>(initialRange);

  const query = useApiQuery<ReparacionesResult>(
    ['reparaciones', range],
    `/api/reparaciones-colchones?${new URLSearchParams({ range })}`
  );

  const data = query.data;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <label className="flex flex-col gap-1 text-sm text-slate-300">
          Período
          <select
            value={range}
            onChange={(e) => setRange(e.target.value as CalidadRange)}
            className="min-w-[10rem] rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-100 focus:border-brand-500 focus:outline-none"
          >
            {RANGE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <LastUpdated dataUpdatedAt={query.dataUpdatedAt} />
      </div>

      {query.isError && (
        <p className="rounded border border-red-900 bg-red-950/50 p-3 text-sm text-red-300">
          No se pudieron cargar los datos: {(query.error as Error).message}
        </p>
      )}

      {query.isLoading ? (
        <div className="h-[600px] w-full animate-pulse-slow rounded-lg bg-slate-800/60" />
      ) : data ? (
        <>
          <LivingSection data={data.living} />
          <ColchonSection data={data.colchon} />
          {data.totalSinSector > 0 && (
            <p className="text-xs text-slate-500">
              Hay {numero.format(data.totalSinSector)} reparaciones adicionales en el período sin un producto Living/Colchón
              identificable (sin producto cargado, PI, Servicio, Reventa, etc.) — no se cruzan contra una producción propia.
            </p>
          )}
        </>
      ) : null}
    </div>
  );
}

/** Entry point mounted as an Astro client island (`client:load`), same pattern as the other tabs. */
export default function ReparacionesColchonesApp({ dehydratedState, initialRange }: Props) {
  return (
    <QueryProvider dehydratedState={dehydratedState}>
      <ReparacionesColchonesInner initialRange={initialRange} />
    </QueryProvider>
  );
}
