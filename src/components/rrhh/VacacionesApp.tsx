import { useMemo, useState } from 'react';
import type { DehydratedState } from '@tanstack/react-query';
import QueryProvider from '../QueryProvider';
import { useApiQuery } from '../dashboard/useApiQuery';
import LastUpdated from '../shared/LastUpdated';
import VacacionesTable from './VacacionesTable';
import { formatNumber } from '../gerencia/format';
import { RRHH_VACACIONES_QUERY_KEY } from '../../lib/rrhh-vacaciones-ssr';
import type { RrhhVacacionesResult } from '../../lib/odoo/rrhh-vacaciones';

interface Props {
  dehydratedState?: DehydratedState;
}

type FiltroAnomalia = 'todas' | 'anomalias' | 'negativo' | 'alto';

const FILTRO_OPTIONS: { value: FiltroAnomalia; label: string }[] = [
  { value: 'anomalias', label: 'Solo con anomalías' },
  { value: 'negativo', label: 'Solo saldo negativo' },
  { value: 'alto', label: 'Solo acumulación alta' },
  { value: 'todas', label: 'Todos los empleados' },
];

function VacacionesInner() {
  const query = useApiQuery<RrhhVacacionesResult>(RRHH_VACACIONES_QUERY_KEY, '/api/rrhh-vacaciones');
  const [filtro, setFiltro] = useState<FiltroAnomalia>('anomalias');
  const [departamento, setDepartamento] = useState<string>('');
  const [busqueda, setBusqueda] = useState('');

  const data = query.data;
  const departamentos = useMemo(() => {
    if (!data) return [];
    const set = new Set<string>();
    for (const r of data.rows) if (r.departamento) set.add(r.departamento);
    return [...set].sort((a, b) => a.localeCompare(b, 'es'));
  }, [data]);

  const rows = useMemo(() => {
    if (!data) return [];
    const q = busqueda.trim().toLowerCase();
    return data.rows.filter((r) => {
      if (filtro === 'anomalias' && r.anomalia === 'ok') return false;
      if (filtro === 'negativo' && r.anomalia !== 'negativo') return false;
      if (filtro === 'alto' && r.anomalia !== 'alto') return false;
      if (departamento && r.departamento !== departamento) return false;
      if (q && !r.nombre.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [data, filtro, departamento, busqueda]);

  const totalNegativo = data?.rows.filter((r) => r.anomalia === 'negativo').length ?? 0;
  const totalAlto = data?.rows.filter((r) => r.anomalia === 'alto').length ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <div className="flex flex-wrap items-end gap-6">
          <label className="flex flex-col gap-1 text-sm text-slate-300">
            Anomalía
            <select
              value={filtro}
              onChange={(e) => setFiltro(e.target.value as FiltroAnomalia)}
              className="min-w-[12rem] rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-100 focus:border-brand-500 focus:outline-none"
            >
              {FILTRO_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm text-slate-300">
            Departamento
            <select
              value={departamento}
              onChange={(e) => setDepartamento(e.target.value)}
              className="min-w-[14rem] rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-100 focus:border-brand-500 focus:outline-none"
            >
              <option value="">Todos</option>
              {departamentos.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm text-slate-300">
            Buscar
            <input
              type="text"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Nombre del empleado"
              className="w-56 rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-100 placeholder:text-slate-600 focus:border-brand-500 focus:outline-none"
            />
          </label>
        </div>
        <LastUpdated dataUpdatedAt={query.dataUpdatedAt} />
      </div>

      {query.isError && (
        <p className="rounded border border-red-900 bg-red-950/50 p-3 text-sm text-red-300">
          No se pudieron cargar los datos: {(query.error as Error).message}
        </p>
      )}

      {query.isLoading ? (
        <div className="h-24 w-full animate-pulse-slow rounded-lg bg-slate-800/60" />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">Empleados activos</p>
            <p className="mt-1 text-2xl font-semibold text-slate-100">{formatNumber(data?.totalEmpleados ?? 0)}</p>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">Con saldo negativo</p>
            <p className="mt-1 text-2xl font-semibold text-red-400">{formatNumber(totalNegativo)}</p>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">Con acumulación alta</p>
            <p className="mt-1 text-2xl font-semibold text-amber-400">{formatNumber(totalAlto)}</p>
          </div>
        </div>
      )}

      <section className="flex flex-col gap-4 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <h3 className="text-sm font-medium text-slate-300">
          Empleados {data ? `(${formatNumber(rows.length)} de ${formatNumber(data.totalEmpleados)})` : ''}
        </h3>
        <p className="text-xs text-slate-500">Click en una fila para ver el detalle de contrato, horas cargadas y vacaciones.</p>
        {query.isLoading ? (
          <div className="h-64 w-full animate-pulse-slow rounded-lg bg-slate-800/60" />
        ) : (
          <VacacionesTable rows={rows} today={data?.generatedAt ?? ''} />
        )}
      </section>
    </div>
  );
}

/** Entry point mounted as an Astro client island (`client:load`), same pattern as the other tabs. */
export default function VacacionesApp({ dehydratedState }: Props) {
  return (
    <QueryProvider dehydratedState={dehydratedState}>
      <VacacionesInner />
    </QueryProvider>
  );
}
