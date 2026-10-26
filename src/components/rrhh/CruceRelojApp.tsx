import { Fragment, useMemo, useState } from 'react';
import QueryProvider from '@/components/QueryProvider';
import { useApiQuery } from '@/components/dashboard/useApiQuery';
import LastUpdated from '@/components/shared/LastUpdated';
import { formatDias, formatFechaIso } from './format';
import { META_COINCIDENCIA, ultimasQuincenas } from './quincena-utils';
import type { CruceEmpleadoRow, RrhhCruceResult } from '@/lib/rrhh-cruce-reloj';

interface Props {
  /** Fecha de hoy (ISO) calculada en el servidor, para no depender de la zona horaria del navegador. */
  hoy: string;
}

const MAX_DIAS = 93;

const hs = (v: number) => `${formatDias(v)} hs`;

const selectClass =
  'rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-100 focus:border-brand-500 focus:outline-none';

type Vista = 'diferencias' | 'todos' | 'solo-odoo';

function Kpi({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${tone ?? 'text-slate-100'}`}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

const difTone = (dif: number) => (Math.abs(dif) <= 0.1 ? 'text-slate-400' : dif > 0 ? 'text-amber-300' : 'text-rose-300');
const signed = (v: number) => `${v > 0 ? '+' : ''}${formatDias(v)}`;

function Detalle({ row }: { row: CruceEmpleadoRow }) {
  return (
    <div className="flex flex-col gap-4 text-sm">
      <p className="text-slate-400">
        {row.enReloj ? (
          <>
            Reloj: {row.relojDias} días laborables, {hs(row.relojTrabajadasHs ?? 0)} trabajadas, {hs(row.relojExtraHs ?? 0)} extra, control{' '}
            {hs(row.relojControl ?? 0)}.
          </>
        ) : (
          'Este empleado no está en la planilla del reloj (no ficha en el CrossCheck, o está fuera de convenio).'
        )}
        {row.matchPor === 'nombre' && ' Se cruzó por nombre porque el legajo no coincide con la credencial de Odoo.'}
      </p>

      {row.alertas.length > 0 && (
        <ul className="flex flex-col gap-1 text-rose-300">
          {row.alertas.map((a, i) => (
            <li key={i}>{a.detalle}</li>
          ))}
        </ul>
      )}

      {row.tipos.length === 0 ? (
        <p className="text-slate-500">Sin incidencias en el reloj ni en Odoo.</p>
      ) : (
        <table className="w-full max-w-xl text-left">
          <thead className="text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="py-1 pr-3 font-medium">Incidencia</th>
              <th className="py-1 pr-3 text-right font-medium">Reloj</th>
              <th className="py-1 pr-3 text-right font-medium">Odoo</th>
              <th className="py-1 text-right font-medium">Diferencia</th>
            </tr>
          </thead>
          <tbody>
            {row.tipos.map((t) => (
              <tr key={t.tipo} className="border-t border-slate-800">
                <td className="py-1 pr-3 text-slate-200">{t.tipo}</td>
                <td className="py-1 pr-3 text-right tabular-nums text-slate-300">{hs(t.relojHs)}</td>
                <td className="py-1 pr-3 text-right tabular-nums text-slate-300">{hs(t.odooHs)}</td>
                <td className={`py-1 text-right tabular-nums ${difTone(t.dif)}`}>{Math.abs(t.dif) <= 0.1 ? 'Coincide' : `${signed(t.dif)} hs`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function CruceInner({ hoy }: Props) {
  // Arranca en la última quincena cerrada; después se puede elegir cualquier rango.
  const inicial = useMemo(() => {
    const qs = ultimasQuincenas(hoy, 2);
    return qs.find((q) => !q.enCurso) ?? qs[0]!;
  }, [hoy]);
  const [desde, setDesde] = useState(inicial.desde);
  const [hasta, setHasta] = useState(inicial.hasta);
  const [busqueda, setBusqueda] = useState('');
  const [vista, setVista] = useState<Vista>('diferencias');
  const [abierto, setAbierto] = useState<Set<string>>(new Set());

  const rangoDias = desde && hasta ? Math.round((Date.parse(hasta) - Date.parse(desde)) / 86_400_000) + 1 : 0;
  const rangoError =
    !desde || !hasta
      ? 'Elegí las dos fechas.'
      : hasta < desde
        ? 'La fecha "hasta" es anterior a "desde".'
        : rangoDias > MAX_DIAS
          ? `El rango no puede superar ${MAX_DIAS} días.`
          : null;

  const query = useApiQuery<RrhhCruceResult>(['rrhh-cruce-reloj', desde, hasta], `/api/rrhh-cruce-reloj?desde=${desde}&hasta=${hasta}`, {
    enabled: !rangoError,
  });
  const data = query.data;
  const allRows = data?.rows ?? [];

  const rows = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return allRows.filter((r) => {
      if (vista === 'diferencias' && (!r.enReloj || (r.coincide && r.alertas.length === 0))) return false;
      if (vista === 'solo-odoo' && r.enReloj) return false;
      if (q && !r.nombre.toLowerCase().includes(q) && !(r.legajo ?? '').toLowerCase().includes(q)) return false;
      return true;
    });
  }, [allRows, busqueda, vista]);

  const pct = data?.totales.coincidenciaPct ?? null;
  const pctTone = pct === null ? undefined : pct >= META_COINCIDENCIA ? 'text-emerald-400' : pct >= 0.95 ? 'text-amber-400' : 'text-rose-400';
  const periodoDistinto = data && data.diasReloj !== null && data.diasReloj !== data.diasOdoo;

  function toggle(key: string) {
    setAbierto((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function exportarExcel() {
    if (!data) return;
    const XLSX = await import('xlsx');
    const filas = allRows.map((r) => ({
      Legajo: r.legajo ?? '',
      Empleado: r.nombre,
      Departamento: r.departamento ?? '',
      Estado: !r.enReloj ? 'Solo en Odoo' : !r.enOdoo ? 'Solo en reloj' : r.coincide ? 'Coincide' : 'Con diferencias',
      'Incidencias reloj (hs)': r.relojIncidenciasHs,
      'Incidencias Odoo (hs)': r.odooIncidenciasHs,
      'Diferencia Odoo − reloj (hs)': r.difHs,
      Detalle: r.tipos
        .filter((t) => Math.abs(t.dif) > 0.1)
        .map((t) => `${t.tipo}: reloj ${t.relojHs} / Odoo ${t.odooHs}`)
        .join(' | '),
      Alertas: r.alertas.map((a) => a.detalle).join(' | '),
    }));
    const ws = XLSX.utils.json_to_sheet(filas);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Cruce reloj vs Odoo');
    XLSX.writeFile(wb, `cruce-reloj-odoo-${data.desde}_${data.hasta}.xlsx`);
  }

  return (
    <div className="flex flex-col gap-6">
      {rangoError && <p className="rounded border border-amber-900 bg-amber-950/40 p-3 text-sm text-amber-300">{rangoError}</p>}
      {query.isError && (
        <p className="rounded border border-red-900 bg-red-950/50 p-3 text-sm text-red-300">
          No se pudieron cargar los datos: {(query.error as Error).message}
        </p>
      )}

      <div className="flex flex-wrap items-end justify-between gap-4 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <div className="flex flex-wrap items-end gap-4 text-sm text-slate-300">
          <label className="flex flex-col gap-1">
            Desde
            <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className={selectClass} />
          </label>
          <label className="flex flex-col gap-1">
            Hasta
            <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className={selectClass} />
          </label>
          <label className="flex flex-col gap-1">
            Mostrar
            <select value={vista} onChange={(e) => setVista(e.target.value as Vista)} className={`min-w-[12rem] ${selectClass}`}>
              <option value="diferencias">Solo con diferencias</option>
              <option value="todos">Todos</option>
              <option value="solo-odoo">Solo en Odoo (no están en el reloj)</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            Buscar
            <input
              type="text"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Nombre o legajo"
              className={`w-48 placeholder:text-slate-600 ${selectClass}`}
            />
          </label>
        </div>
        <div className="flex items-center gap-4">
          <LastUpdated dataUpdatedAt={query.dataUpdatedAt} />
          <button
            type="button"
            onClick={exportarExcel}
            disabled={!data}
            title="Exporta todos los empleados, sin aplicar los filtros de pantalla"
            className="rounded border border-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:border-brand-500 disabled:opacity-40"
          >
            Descargar Excel
          </button>
        </div>
      </div>

      <p className="text-xs text-slate-500">
        La planilla no trae fechas: se compara lo que hoy está pegado en la pestaña BASE RELOJ FICHADOR contra Odoo en el rango elegido.
        Elegí el mismo período que cargaste en la planilla.
      </p>

      {periodoDistinto && data && (
        <p className="rounded border border-amber-900 bg-amber-950/40 p-3 text-sm text-amber-300">
          El reloj tiene {data.diasReloj} días laborables y Odoo cuenta {data.diasOdoo} en {formatFechaIso(data.desde)} – {formatFechaIso(data.hasta)}:
          probablemente la planilla corresponde a otro período y las diferencias no son reales.
        </p>
      )}

      {query.isLoading ? (
        <div className="h-28 w-full animate-pulse-slow rounded-lg bg-slate-800/60" />
      ) : (
        data && (
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            <Kpi
              label="Coincidencia"
              value={pct === null ? '—' : `${(pct * 100).toFixed(1).replace('.', ',')}%`}
              hint={`${data.totales.coinciden} de ${data.totales.cruzados} empleados · meta ${Math.round(META_COINCIDENCIA * 100)}%`}
              tone={pctTone}
            />
            <Kpi label="Con diferencias" value={String(data.totales.conDiferencias)} hint="Empleados cuyas incidencias no coinciden" tone={data.totales.conDiferencias > 0 ? 'text-rose-400' : 'text-emerald-400'} />
            <Kpi label="Incidencias reloj" value={hs(Math.round(data.totales.relojIncidenciasHs))} hint="Licencias y ausencias cargadas en el reloj" />
            <Kpi label="Incidencias Odoo" value={hs(Math.round(data.totales.odooIncidenciasHs))} hint={`Diferencia absoluta: ${hs(Math.round(data.totales.difAbsolutaHs))}`} />
            <Kpi
              label="Cruce de empleados"
              value={`${data.totales.cruzados}`}
              hint={`${data.totales.enReloj} en reloj · ${data.totales.enOdoo} en Odoo · ${data.totales.soloOdoo} solo Odoo`}
            />
          </div>
        )
      )}

      {data && data.porTipo.length > 0 && (
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <h3 className="mb-3 text-sm font-semibold text-slate-200">Por tipo de incidencia</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="py-1 pr-3 font-medium">Incidencia</th>
                  <th className="py-1 pr-3 text-right font-medium">Reloj</th>
                  <th className="py-1 pr-3 text-right font-medium">Odoo</th>
                  <th className="py-1 pr-3 text-right font-medium">Diferencia</th>
                  <th className="py-1 text-right font-medium">Empleados con diferencia</th>
                </tr>
              </thead>
              <tbody>
                {data.porTipo.map((t) => (
                  <tr key={t.tipo} className="border-t border-slate-800">
                    <td className="py-1 pr-3 text-slate-200">{t.tipo}</td>
                    <td className="py-1 pr-3 text-right tabular-nums text-slate-300">{hs(t.relojHs)}</td>
                    <td className="py-1 pr-3 text-right tabular-nums text-slate-300">{hs(t.odooHs)}</td>
                    <td className={`py-1 pr-3 text-right tabular-nums ${difTone(t.dif)}`}>{Math.abs(t.dif) <= 0.1 ? '—' : `${signed(t.dif)} hs`}</td>
                    <td className="py-1 text-right tabular-nums text-slate-400">{t.empleadosConDif || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Diferencia = Odoo − reloj. Positiva: Odoo tiene más horas de esa incidencia que el reloj. Las licencias por día en Odoo se valorizan a 8,80 hs.
          </p>
        </div>
      )}

      {query.isLoading ? (
        <div className="h-64 w-full animate-pulse-slow rounded-lg bg-slate-800/60" />
      ) : rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-500">
          {vista === 'diferencias' && allRows.length > 0 ? 'No hay diferencias en este período.' : 'Sin empleados que coincidan con el filtro.'}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-900 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2 font-medium">Legajo</th>
                <th className="px-3 py-2 font-medium">Empleado</th>
                <th className="px-3 py-2 text-right font-medium">Reloj</th>
                <th className="px-3 py-2 text-right font-medium">Odoo</th>
                <th className="px-3 py-2 text-right font-medium">Diferencia</th>
                <th className="px-3 py-2 font-medium">Dónde difiere</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const key = `${r.legajo}-${r.nombre}`;
                const open = abierto.has(key);
                return (
                  <Fragment key={key}>
                    <tr onClick={() => toggle(key)} className="cursor-pointer border-t border-slate-800 hover:bg-slate-900/60">
                      <td className="px-3 py-2 tabular-nums text-slate-400">{r.legajo ?? '—'}</td>
                      <td className="px-3 py-2">
                        <span className="text-slate-100">{r.nombre}</span>
                        {r.departamento && <span className="block text-xs text-slate-500">{r.departamento}</span>}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-300">{r.enReloj ? hs(r.relojIncidenciasHs) : '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-300">{r.enOdoo ? hs(r.odooIncidenciasHs) : '—'}</td>
                      <td className={`px-3 py-2 text-right tabular-nums ${difTone(r.difHs)}`}>{r.enReloj && r.enOdoo ? (r.coincide ? 'Coincide' : `${signed(r.difHs)} hs`) : '—'}</td>
                      <td className="px-3 py-2">
                        <span className="flex flex-wrap gap-1">
                          {r.tipos
                            .filter((t) => r.enReloj && Math.abs(t.dif) > 0.1)
                            .map((t) => (
                              <span key={t.tipo} className="rounded bg-rose-950 px-1.5 py-0.5 text-xs text-rose-300">
                                {t.tipo} {formatDias(t.relojHs)}→{formatDias(t.odooHs)}
                              </span>
                            ))}
                          {r.alertas.map((a, i) => (
                            <span key={i} title={a.detalle} className="rounded bg-amber-950 px-1.5 py-0.5 text-xs text-amber-300">
                              {{
                                multiplo: 'No múltiplo de 8,80',
                                control: 'Control no cierra',
                                'vacaciones-injustificadas': 'Vacación como falta?',
                                'sin-match': 'No está en Odoo',
                              }[a.tipo]}
                            </span>
                          ))}
                          {r.enReloj && r.enOdoo && r.coincide && r.alertas.length === 0 && <span className="text-xs text-emerald-400">Coincide</span>}
                          {!r.enReloj && <span className="text-xs text-slate-500">No está en el reloj</span>}
                        </span>
                      </td>
                    </tr>
                    {open && (
                      <tr className="bg-slate-900/40">
                        <td colSpan={6} className="px-3 py-3">
                          <Detalle row={r} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Entry point mounted as an Astro client island (`client:load`), same pattern as the other tabs. */
export default function CruceRelojApp({ hoy }: Props) {
  return (
    <QueryProvider>
      <CruceInner hoy={hoy} />
    </QueryProvider>
  );
}
