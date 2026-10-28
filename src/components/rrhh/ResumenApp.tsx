import { useMemo, useState } from 'react';
import type { DehydratedState } from '@tanstack/react-query';
import QueryProvider from '@/components/QueryProvider';
import { useApiQuery } from '@/components/dashboard/useApiQuery';
import LastUpdated from '@/components/shared/LastUpdated';
import EmpleadoCard from './EmpleadoCard';
import { formatDias, formatHoras } from './format';
import { buildConvenioColors, convenioDe, cumplimiento, resumirPorConvenio } from './resumen-utils';
import { RRHH_VACACIONES_QUERY_KEY } from '@/lib/rrhh-vacaciones-ssr';
import type { EmpleadoVacacionesRow, RrhhVacacionesResult } from '@/lib/odoo/rrhh-vacaciones';

interface Props {
  dehydratedState?: DehydratedState;
}

type Orden = 'banco-desc' | 'banco-asc' | 'horas-desc' | 'cumplimiento-asc' | 'nombre' | 'estado-fichaje';

/** Mismo criterio que el punto del avatar: fichado (0), sin fichar (1), sin datos biométricos (2). */
function rangoFichaje(r: EmpleadoVacacionesRow): number {
  if (!r.tieneBiometricos) return 2;
  return r.fichado ? 0 : 1;
}

const ORDEN_OPTIONS: { value: Orden; label: string }[] = [
  { value: 'banco-desc', label: 'Más horas a favor' },
  { value: 'banco-asc', label: 'Más horas en contra' },
  { value: 'horas-desc', label: 'Más horas cargadas (30 d)' },
  { value: 'cumplimiento-asc', label: 'Menor cumplimiento' },
  { value: 'nombre', label: 'Nombre (A-Z)' },
  { value: 'estado-fichaje', label: 'Estado de fichaje' },
];

function Kpi({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${tone ?? 'text-slate-100'}`}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

function ResumenInner() {
  const query = useApiQuery<RrhhVacacionesResult>(RRHH_VACACIONES_QUERY_KEY, '/api/rrhh-vacaciones');
  const [convenio, setConvenio] = useState('');
  const [departamento, setDepartamento] = useState('');
  const [busqueda, setBusqueda] = useState('');
  const [orden, setOrden] = useState<Orden>('banco-desc');

  const data = query.data;
  // "Ignorar" no aparece en el Resumen (sigue apareciendo en Vacaciones). "Reporte perfecto" aparece, pero sus horas no
  // entran en los KPIs ni en el orden por horas: de esas personas solo importa si están fichadas.
  const allRows = useMemo(() => (data?.rows ?? []).filter((r) => r.estadoResumen !== 'ignorar'), [data]);
  const conHoras = useMemo(() => allRows.filter((r) => r.estadoResumen !== 'reporte_perfecto'), [allRows]);

  const colors = useMemo(() => buildConvenioColors(allRows), [allRows]);
  const convenios = useMemo(() => resumirPorConvenio(allRows), [allRows]);
  const departamentos = useMemo(
    () => [...new Set(allRows.map((r) => r.departamento).filter((d): d is string => Boolean(d)))].sort((a, b) => a.localeCompare(b, 'es')),
    [allRows]
  );
  const maxAbsBanco = useMemo(() => Math.max(0, ...conHoras.map((r) => Math.abs(r.bancoHorasSaldo))), [conHoras]);

  const kpis = useMemo(() => {
    let aFavor = 0;
    let enContra = 0;
    let conSaldoPositivo = 0;
    let conSaldoNegativo = 0;
    let deLicencia = 0;
    let sumaCumplimiento = 0;
    let conCumplimiento = 0;
    // La licencia se cuenta sobre todos los que aparecen; el resto de los KPIs, solo sobre quienes sí controlan horas.
    deLicencia = allRows.filter((r) => r.enLicenciaActualmente).length;
    for (const r of conHoras) {
      if (r.bancoHorasSaldo > 0) {
        aFavor += r.bancoHorasSaldo;
        conSaldoPositivo += 1;
      } else if (r.bancoHorasSaldo < 0) {
        enContra += -r.bancoHorasSaldo;
        conSaldoNegativo += 1;
      }
      const c = cumplimiento(r);
      if (c !== null) {
        sumaCumplimiento += Math.min(c, 1);
        conCumplimiento += 1;
      }
    }
    return {
      aFavor,
      enContra,
      conSaldoPositivo,
      conSaldoNegativo,
      deLicencia,
      cumplimientoPromedio: conCumplimiento > 0 ? sumaCumplimiento / conCumplimiento : null,
    };
  }, [allRows, conHoras]);

  const rows = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    const filtered = allRows.filter((r) => {
      if (convenio && convenioDe(r) !== convenio) return false;
      if (departamento && r.departamento !== departamento) return false;
      if (q && !r.nombre.toLowerCase().includes(q)) return false;
      return true;
    });
    // Para "reporte perfecto" las horas no cuentan: valen 0 y quedan al final al ordenar por cumplimiento.
    const perfecto = (r: (typeof filtered)[number]) => r.estadoResumen === 'reporte_perfecto';
    const banco = (r: (typeof filtered)[number]) => (perfecto(r) ? 0 : r.bancoHorasSaldo);
    const horas30 = (r: (typeof filtered)[number]) => (perfecto(r) ? 0 : r.horasCargadas30d);
    const cump = (r: (typeof filtered)[number]) => (perfecto(r) ? Infinity : cumplimiento(r) ?? Infinity);
    const sorters: Record<Orden, (a: (typeof filtered)[number], b: (typeof filtered)[number]) => number> = {
      'banco-desc': (a, b) => banco(b) - banco(a),
      'banco-asc': (a, b) => banco(a) - banco(b),
      'horas-desc': (a, b) => horas30(b) - horas30(a),
      'cumplimiento-asc': (a, b) => cump(a) - cump(b),
      nombre: (a, b) => a.nombre.localeCompare(b.nombre, 'es'),
      'estado-fichaje': (a, b) => rangoFichaje(a) - rangoFichaje(b) || a.nombre.localeCompare(b.nombre, 'es'),
    };
    return filtered.sort(sorters[orden]);
  }, [allRows, convenio, departamento, busqueda, orden]);

  const selectClass =
    'rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-100 focus:border-brand-500 focus:outline-none';

  return (
    <div className="flex flex-col gap-6">
      {query.isError && (
        <p className="rounded border border-red-900 bg-red-950/50 p-3 text-sm text-red-300">
          No se pudieron cargar los datos: {(query.error as Error).message}
        </p>
      )}

      {query.isLoading ? (
        <div className="h-28 w-full animate-pulse-slow rounded-lg bg-slate-800/60" />
      ) : (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          <Kpi label="Empleados activos" value={formatDias(allRows.length)} hint={`${kpis.deLicencia} de licencia hoy`} />
          <Kpi
            label="Horas a favor"
            value={formatHoras(Math.round(kpis.aFavor))}
            hint={`${kpis.conSaldoPositivo} empleados`}
            tone="text-emerald-400"
          />
          <Kpi
            label="Horas en contra"
            value={formatHoras(Math.round(kpis.enContra))}
            hint={`${kpis.conSaldoNegativo} empleados`}
            tone="text-rose-400"
          />
          <Kpi
            label="Balance banco"
            value={`${kpis.aFavor - kpis.enContra > 0 ? '+' : ''}${formatHoras(Math.round(kpis.aFavor - kpis.enContra))}`}
            hint="A favor menos en contra"
          />
          <Kpi
            label="Cumplimiento 30 d"
            value={kpis.cumplimientoPromedio === null ? '—' : `${Math.round(kpis.cumplimientoPromedio * 100)}%`}
            hint="Hs cargadas vs. jornada"
          />
        </div>
      )}

      <div className="flex flex-wrap items-end justify-between gap-4 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <div className="flex flex-wrap items-end gap-4 text-sm text-slate-300">
          <label className="flex flex-col gap-1">
            Ordenar por
            <select value={orden} onChange={(e) => setOrden(e.target.value as Orden)} className={`min-w-[12rem] ${selectClass}`}>
              {ORDEN_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            Convenio
            <select value={convenio} onChange={(e) => setConvenio(e.target.value)} className={`min-w-[10rem] ${selectClass}`}>
              <option value="">Todos</option>
              {convenios.map((c) => (
                <option key={c.nombre} value={c.nombre}>
                  {c.nombre}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            Departamento
            <select value={departamento} onChange={(e) => setDepartamento(e.target.value)} className={`min-w-[12rem] ${selectClass}`}>
              <option value="">Todos</option>
              {departamentos.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            Buscar
            <input
              type="text"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Nombre del empleado"
              className={`w-52 placeholder:text-slate-600 ${selectClass}`}
            />
          </label>
        </div>
        <LastUpdated dataUpdatedAt={query.dataUpdatedAt} />
      </div>

      <div className="-mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
        <span>{data ? `${rows.length} de ${allRows.length} empleados` : ''} · El anillo mide horas cargadas en los últimos 30 días contra las que corresponden a su jornada.</span>
        <span className="flex items-center gap-1.5">
          <span className="relative inline-flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
          </span>
          Fichado
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-flex h-2.5 w-2.5 rounded-full bg-rose-500" />
          No fichado
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-flex h-2.5 w-2.5 rounded-full border-2 border-dashed border-slate-500" />
          Sin datos biométricos
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-flex rounded-full bg-emerald-500/10 px-1.5 text-[10px] font-medium text-emerald-300">Reporte perfecto</span>
          Solo se controla el fichaje, no las horas
        </span>
      </div>

      {query.isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="h-52 animate-pulse-slow rounded-xl bg-slate-800/60" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-500">Sin empleados que coincidan con el filtro.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {rows.map((r) => (
            <EmpleadoCard key={r.id} row={r} today={data?.generatedAt ?? ''} color={colors.get(convenioDe(r))!} maxAbsBanco={maxAbsBanco} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Entry point mounted as an Astro client island (`client:load`), same pattern as the other tabs. Comparte query key con Vacaciones, así que navegar entre ambas pestañas no vuelve a pedir a Odoo. */
export default function ResumenApp({ dehydratedState }: Props) {
  return (
    <QueryProvider dehydratedState={dehydratedState}>
      <ResumenInner />
    </QueryProvider>
  );
}
