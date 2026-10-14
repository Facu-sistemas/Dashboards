import { useMemo, useState } from 'react';
import type { DehydratedState } from '@tanstack/react-query';
import QueryProvider from '@/components/QueryProvider';
import { useApiQuery } from '@/components/dashboard/useApiQuery';
import LastUpdated from '@/components/shared/LastUpdated';
import ReparacionesVsProduccionChart from './ReparacionesVsProduccionChart';
import HorasYRecuperadoChart from './HorasYRecuperadoChart';
import type { CalidadRange, ReparacionesResult } from './types';

interface Props {
  dehydratedState?: DehydratedState;
}

interface Seleccion {
  from: string;
  to: string;
}

const RANGE_OPTIONS: { value: CalidadRange; label: string }[] = [
  { value: 'all', label: 'Histórico completo' },
  { value: 'this-year', label: 'Este año' },
  { value: 'last-12-months', label: 'Últimos 12 meses' },
  { value: 'last-6-months', label: 'Últimos 6 meses' },
];

/** Rango de meses que cubre cada atajo, sobre los meses que hay cargados (ordenados de más viejo a más nuevo). */
function rangoDeAtajo(range: CalidadRange, months: string[]): Seleccion {
  const first = months[0] ?? '';
  const last = months[months.length - 1] ?? '';
  if (range === 'all') return { from: first, to: last };
  if (range === 'this-year') return { from: months.find((m) => m.slice(0, 4) === last.slice(0, 4)) ?? first, to: last };
  const n = range === 'last-6-months' ? 6 : 12;
  return { from: months[Math.max(0, months.length - n)] ?? first, to: last };
}

/** Deja en los resultados solo los meses elegidos y recalcula los totales a partir de ellos. */
function filtrarMeses(data: ReparacionesResult, sel: Seleccion): ReparacionesResult {
  const enRango = (p: { month: string }) => p.month >= sel.from && p.month <= sel.to;
  const livingMensual = data.living.mensual.filter(enRango);
  const colchonMensual = data.colchon.mensual.filter(enRango);
  const suma = <T,>(rows: T[], f: (r: T) => number) => rows.reduce((acc, r) => acc + f(r), 0);
  return {
    ...data,
    living: {
      totalReparaciones: suma(livingMensual, (p) => p.cantidadReparaciones),
      totalHoras: suma(livingMensual, (p) => p.horasReparacion),
      totalRecuperado: suma(livingMensual, (p) => p.totalRecuperado),
      totalUnidadesFabricadas: suma(livingMensual, (p) => p.unidadesFabricadas),
      mensual: livingMensual,
    },
    colchon: {
      totalNotasCredito: suma(colchonMensual, (p) => p.cantidadNotasCredito),
      totalMontoNotasCredito: suma(colchonMensual, (p) => p.montoNotasCredito),
      totalHoras: suma(colchonMensual, (p) => p.horasReparacion),
      totalUnidadesFabricadas: suma(colchonMensual, (p) => p.unidadesFabricadas),
      mensual: colchonMensual,
    },
  };
}

const money = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
const numero = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });

function nombreMes(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const name = new Date(y!, m! - 1, 1).toLocaleDateString('es-AR', { month: 'long' });
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${y}`;
}

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
        <KpiCard label="Unidades equivalentes fabricadas" value={numero.format(data.totalUnidadesFabricadas)} />
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
          fabricadoLabel="Unidades equivalentes fabricadas"
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

      <section className="flex flex-col gap-4 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <div>
          <h3 className="text-sm font-medium text-slate-300">Devoluciones por mes: Garantía vs. Calidad</h3>
          <p className="mt-1 text-xs text-slate-500">
            Mismas notas de crédito de Colchón de arriba, separadas por motivo. Garantía = motivo "Garantía"; Calidad = no
            conformidad (producto). Suma ambas empresas (Frontera Living y Presupuesto).
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-left text-xs text-slate-500">
                <th className="py-2 pr-4 font-medium">Mes</th>
                <th className="px-2 py-2 text-right font-medium">Garantía (cant.)</th>
                <th className="px-2 py-2 text-right font-medium">Garantía ($)</th>
                <th className="px-2 py-2 text-right font-medium">Calidad (cant.)</th>
                <th className="px-2 py-2 text-right font-medium">Calidad ($)</th>
                <th className="py-2 pl-2 text-right font-medium">Total ($)</th>
              </tr>
            </thead>
            <tbody className="text-slate-200">
              {[...data.mensual].reverse().map((p) => (
                <tr key={p.month} className="border-b border-slate-800/60">
                  <td className="py-2 pr-4">{nombreMes(p.month)}</td>
                  <td className="px-2 py-2 text-right">{numero.format(p.cantidadGarantia)}</td>
                  <td className="px-2 py-2 text-right">{money.format(p.montoGarantia)}</td>
                  <td className="px-2 py-2 text-right">{numero.format(p.cantidadCalidad)}</td>
                  <td className="px-2 py-2 text-right">{money.format(p.montoCalidad)}</td>
                  <td className="py-2 pl-2 text-right font-semibold">{money.format(p.montoNotasCredito)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function ReparacionesColchonesInner() {
  // Siempre se trae el histórico completo; el período se elige acá, sin volver a consultar.
  const query = useApiQuery<ReparacionesResult>(['reparaciones', 'all'], `/api/reparaciones-colchones?${new URLSearchParams({ range: 'all' })}`);
  const [seleccion, setSeleccion] = useState<Seleccion | null>(null);

  const full = query.data;
  const monthsAsc = useMemo(
    () => (full ? [...new Set([...full.living.mensual, ...full.colchon.mensual].map((p) => p.month))].sort() : []),
    [full]
  );
  const sel = seleccion ?? rangoDeAtajo('last-12-months', monthsAsc);
  const data = useMemo(() => (full ? filtrarMeses(full, sel) : null), [full, sel.from, sel.to]);

  const atajoActivo = (r: CalidadRange) => {
    const x = rangoDeAtajo(r, monthsAsc);
    return x.from === sel.from && x.to === sel.to;
  };
  // El desplegable marca un mes solo cuando se está viendo uno; con un atajo queda en "—".
  const mesUnico = sel.from === sel.to ? sel.from : '';

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex flex-wrap items-center gap-2">
            {RANGE_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => setSeleccion(rangoDeAtajo(o.value, monthsAsc))}
                className={`rounded border px-3 py-1.5 text-sm ${
                  atajoActivo(o.value) ? 'border-brand-500 bg-brand-500 font-medium text-white' : 'border-slate-700 text-slate-300 hover:bg-slate-800'
                }`}
              >
                {o.label}
              </button>
            ))}
            <label className="flex items-center gap-2 text-sm text-slate-300">
              Mes
              <select
                value={mesUnico}
                onChange={(e) => e.target.value && setSeleccion({ from: e.target.value, to: e.target.value })}
                className="min-w-[12rem] rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-100 focus:border-brand-500 focus:outline-none"
              >
                <option value="">—</option>
                {[...monthsAsc].reverse().map((m) => (
                  <option key={m} value={m}>
                    {nombreMes(m)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
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
              Hay {numero.format(data.totalSinSector)} reparaciones adicionales en el histórico sin un producto Living/Colchón
              identificable (sin producto cargado, PI, Servicio, Reventa, etc.) — no se cruzan contra una producción propia.
            </p>
          )}
        </>
      ) : null}
    </div>
  );
}

/** Entry point mounted as an Astro client island (`client:load`), same pattern as the other tabs. */
export default function ReparacionesColchonesApp({ dehydratedState }: Props) {
  return (
    <QueryProvider dehydratedState={dehydratedState}>
      <ReparacionesColchonesInner />
    </QueryProvider>
  );
}
