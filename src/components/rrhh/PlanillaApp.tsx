import { Fragment, useMemo, useState } from 'react';
import QueryProvider from '@/components/QueryProvider';
import { useApiQuery } from '@/components/dashboard/useApiQuery';
import LastUpdated from '@/components/shared/LastUpdated';
import { formatDias, formatFechaIso } from './format';
import { ultimasQuincenas } from './quincena-utils';
import type { PlanillaRow, RrhhPlanillaResult } from '@/lib/rrhh-planilla';

interface Props {
  /** Fecha de hoy (ISO) calculada en el servidor, para no depender de la zona horaria del navegador. */
  hoy: string;
}

const MAX_DIAS = 93;

const money = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
const n2 = (v: number) => (v === 0 ? '—' : formatDias(v));

const selectClass =
  'rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-100 focus:border-brand-500 focus:outline-none';

function Kpi({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${tone ?? 'text-slate-100'}`}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

function PlanillaInner({ hoy }: Props) {
  // Arranca en la última quincena cerrada; después se puede elegir cualquier rango.
  const inicial = useMemo(() => {
    const qs = ultimasQuincenas(hoy, 2);
    return qs.find((q) => !q.enCurso) ?? qs[0]!;
  }, [hoy]);
  const [desde, setDesde] = useState(inicial.desde);
  const [hasta, setHasta] = useState(inicial.hasta);
  const [convenio, setConvenio] = useState('');
  const [busqueda, setBusqueda] = useState('');
  const [soloAlertas, setSoloAlertas] = useState(false);
  const [todasLasColumnas, setTodasLasColumnas] = useState(false);
  const [abierto, setAbierto] = useState<Set<number>>(new Set());

  const rangoDias = desde && hasta ? Math.round((Date.parse(hasta) - Date.parse(desde)) / 86_400_000) + 1 : 0;
  const rangoError =
    !desde || !hasta
      ? 'Elegí las dos fechas.'
      : hasta < desde
        ? 'La fecha "hasta" es anterior a "desde".'
        : rangoDias > MAX_DIAS
          ? `El rango no puede superar ${MAX_DIAS} días.`
          : null;

  const query = useApiQuery<RrhhPlanillaResult>(['rrhh-planilla', desde, hasta], `/api/rrhh-planilla?desde=${desde}&hasta=${hasta}`, {
    enabled: !rangoError,
  });
  const data = query.data;
  const allRows = data?.rows ?? [];

  const convenios = useMemo(() => [...new Set(allRows.map((r) => r.convenio).filter(Boolean))].sort(), [allRows]);
  const columnas = useMemo(() => {
    const cols = data?.columnas ?? [];
    return todasLasColumnas ? cols : cols.filter((c) => allRows.some((r) => (r.incidencias[c.key] ?? 0) > 0));
  }, [data, allRows, todasLasColumnas]);

  const rows = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return allRows.filter((r) => {
      if (convenio && r.convenio !== convenio) return false;
      if (soloAlertas && r.alertas.length === 0) return false;
      if (q && !r.nombre.toLowerCase().includes(q) && !String(r.legajo).includes(q)) return false;
      return true;
    });
  }, [allRows, convenio, soloAlertas, busqueda]);

  const totalesFiltro = useMemo(() => {
    const t = { total: 0, feriados: 0, extras: 0, normales: 0, otras: 0, sinGoce: 0, viatico: 0, sabDom: 0, vacDias: 0, anticipos: 0, guarderia: 0, inc: {} as Record<string, number> };
    for (const r of rows) {
      t.total += r.totalHs;
      t.feriados += r.feriadosHs;
      t.extras += r.extrasHs;
      t.normales += r.normalesHs;
      t.otras += r.otrasHs;
      t.sinGoce += r.sinGoceHs;
      t.viatico += r.viaticoDias ?? 0;
      t.sabDom += r.sabDomDias;
      t.vacDias += r.diasVacaciones;
      t.anticipos += r.anticipos;
      t.guarderia += r.guarderia;
      for (const [k, v] of Object.entries(r.incidencias)) t.inc[k] = (t.inc[k] ?? 0) + v;
    }
    return t;
  }, [rows]);

  function toggle(legajo: number) {
    setAbierto((prev) => {
      const next = new Set(prev);
      if (next.has(legajo)) next.delete(legajo);
      else next.add(legajo);
      return next;
    });
  }

  async function exportarExcel() {
    if (!data) return;
    const XLSX = await import('xlsx');
    // Planilla completa (todos los empleados de la nómina, sin los filtros de pantalla) con todas las columnas de la planilla de cálculo.
    const filas = allRows.map((r) => ({
      ID: r.legajo,
      'Nombre y apellido': r.nombre,
      'Centro de costo': r.centroCosto,
      'Tipo de liquidación': r.tipoLiquidacion,
      Convenio: r.convenio,
      'Total hs quinc.': r.totalHs,
      Feriados: r.feriadosHs,
      'Horas extras': r.extrasHs,
      'Hs normales': r.normalesHs,
      ...Object.fromEntries(data.columnas.map((c) => [c.label, r.incidencias[c.key] ?? 0])),
      'Otras licencias': r.otrasHs,
      'Control dif. horas (sin goce)': r.sinGoceHs,
      Presentismo: r.presentismo ?? '',
      'Viático + refrigerio (días)': r.viaticoDias ?? 'NO',
      'Liq. sáb y dom vac. (días)': r.sabDomDias,
      'Días de vacaciones': r.diasVacaciones,
      Anticipos: r.anticipos,
      Guardería: r.guarderia,
      Observaciones: r.alertas.map((a) => a.detalle).join(' | '),
    }));
    const exporta = data.exporta.map((e) => ({ LEGAJO: e.legajo, CODIGO: e.codigo, VALOR: e.valor }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filas), 'Planilla de cálculo');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(exporta), 'EXPORTA');
    XLSX.writeFile(wb, `planilla-calculo-${data.desde}_${data.hasta}.xlsx`);
  }

  const th = 'whitespace-nowrap px-2 py-2 text-right font-medium';
  const td = 'whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-slate-300';

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
            Convenio
            <select value={convenio} onChange={(e) => setConvenio(e.target.value)} className={`min-w-[10rem] ${selectClass}`}>
              <option value="">Todos</option>
              {convenios.map((c) => (
                <option key={c} value={c}>
                  {c}
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
              placeholder="Nombre o legajo"
              className={`w-44 placeholder:text-slate-600 ${selectClass}`}
            />
          </label>
          <label className="flex items-center gap-2 pb-1.5">
            <input type="checkbox" checked={soloAlertas} onChange={(e) => setSoloAlertas(e.target.checked)} />
            Solo con observaciones
          </label>
          <label className="flex items-center gap-2 pb-1.5">
            <input type="checkbox" checked={todasLasColumnas} onChange={(e) => setTodasLasColumnas(e.target.checked)} />
            Todas las columnas
          </label>
        </div>
        <div className="flex items-center gap-4">
          <LastUpdated dataUpdatedAt={query.dataUpdatedAt} />
          <button
            type="button"
            onClick={exportarExcel}
            disabled={!data}
            title="Descarga la planilla de cálculo completa y la solapa EXPORTA (legajo, código, valor), sin aplicar los filtros de pantalla"
            className="rounded border border-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:border-brand-500 disabled:opacity-40"
          >
            Descargar Excel
          </button>
        </div>
      </div>

      {query.isLoading ? (
        <div className="h-28 w-full animate-pulse-slow rounded-lg bg-slate-800/60" />
      ) : (
        data && (
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-6">
            <Kpi label="Empleados liquidados" value={String(data.totales.empleados)} hint={`${data.totales.enOdoo} encontrados en Odoo`} />
            <Kpi
              label="Total hs"
              value={`${formatDias(Math.round(data.totales.totalHs))} hs`}
              hint={`${data.diasHabiles} días hábiles · ${data.feriados.length} feriado${data.feriados.length === 1 ? '' : 's'}`}
            />
            <Kpi label="Hs normales" value={`${formatDias(Math.round(data.totales.normalesHs))} hs`} hint="Jornada − feriados − incidencias" tone="text-emerald-400" />
            <Kpi label="Incidencias" value={`${formatDias(Math.round(data.totales.incidenciasHs))} hs`} hint="Licencias y vacaciones de Odoo" />
            <Kpi label="Horas extras" value={`${formatDias(data.totales.extrasHs)} hs`} hint="BASE HORAS EXTRAS (criterio de RRHH)" />
            <Kpi
              label="Observaciones"
              value={String(data.totales.conErrores + data.totales.conAvisos)}
              hint={`${data.totales.conErrores} errores · ${data.totales.conAvisos} avisos`}
              tone={data.totales.conErrores > 0 ? 'text-rose-400' : data.totales.conAvisos > 0 ? 'text-amber-400' : 'text-emerald-400'}
            />
          </div>
        )
      )}

      {data && (
        <details className="rounded-lg border border-slate-800 bg-slate-900 p-4 text-sm text-slate-400">
          <summary className="cursor-pointer text-slate-300">Cómo se calcula cada columna</summary>
          <ul className="mt-3 list-disc space-y-1 pl-5">
            <li>
              <span className="text-slate-300">Total hs / Feriados:</span> días hábiles del rango × 8,80 hs; los feriados salen del calendario de la empresa en Odoo.
            </li>
            <li>
              <span className="text-slate-300">Incidencias y vacaciones:</span> licencias aprobadas en Odoo, recortadas al rango, a 8,80 hs por día (las cargadas por hora se respetan).
            </li>
            <li>
              <span className="text-slate-300">Hs normales:</span> total − feriados − incidencias − vacaciones − permisos sin pagar. Banco de horas, Días compensatorios y Tiempo personal pagado no
              se descuentan (la planilla suma el banco a las normales; los compensatorios hay que confirmarlos con RRHH).
            </li>
            <li>
              <span className="text-slate-300">Presentismo:</span> SOIVA 25 puntos, o 20 − 3 por día de enfermedad, accidente o sin goce (las vacaciones no descuentan); Madereros 10 con quita proporcional por
              faltas. Es una estimación: las tardanzas y salidas anticipadas necesitan fichadas reales de Odoo y todavía no entran.
            </li>
            <li>
              <span className="text-slate-300">Viático + refrigerio:</span> solo SOIVA. Total de días menos vacaciones y faltas injustificadas; enfermedad y ART sí pagan.
            </li>
            <li>
              <span className="text-slate-300">Sáb y dom de vacaciones:</span> +2 días por cada bloque de 5 días hábiles de vacaciones aprobadas.
            </li>
            <li>
              <span className="text-slate-300">Horas extras, anticipos y guardería:</span> vienen de la planilla de Google (BASE HORAS EXTRAS, columna de criterio, y BASE ANT + GUARDERIA); Odoo no los tiene.
              La nómina, el tipo de liquidación y el convenio también salen de la planilla.
            </li>
            <li>
              <span className="text-slate-300">EXPORTA:</span> legajo · código · valor, sin las filas en cero. Bombero, Casamiento hijo y Día CCT no tienen código en la solapa EXPORTA; Vacaciones se informa en
              días con código 5 (a confirmar).
            </li>
          </ul>
        </details>
      )}

      {query.isLoading ? (
        <div className="h-64 w-full animate-pulse-slow rounded-lg bg-slate-800/60" />
      ) : rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-500">Sin empleados que coincidan con el filtro.</p>
      ) : (
        <div className="max-h-[70vh] overflow-auto rounded-lg border border-slate-800">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 z-10 bg-slate-900 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-2 py-2 font-medium">ID</th>
                <th className="px-2 py-2 font-medium">Nombre y apellido</th>
                <th className="px-2 py-2 font-medium">Convenio</th>
                <th className={th}>Total hs</th>
                <th className={th}>Feriados</th>
                <th className={th}>Extras</th>
                <th className={th}>Hs normales</th>
                {columnas.map((c) => (
                  <th key={c.key} className={th}>
                    {c.label}
                  </th>
                ))}
                <th className={th}>Otras lic.</th>
                <th className={th}>Dif. horas</th>
                <th className={th}>Presentismo</th>
                <th className={th}>Viático</th>
                <th className={th}>Sáb/Dom vac.</th>
                <th className={th}>Días vac.</th>
                <th className={th}>Anticipos</th>
                <th className={th}>Guardería</th>
                <th className="px-2 py-2 font-medium">Observaciones</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r: PlanillaRow) => {
                const open = abierto.has(r.legajo);
                const hayError = r.alertas.some((a) => a.nivel === 'error');
                return (
                  <Fragment key={r.legajo}>
                    <tr onClick={() => toggle(r.legajo)} className="cursor-pointer border-t border-slate-800 hover:bg-slate-900/60">
                      <td className="whitespace-nowrap px-2 py-1.5 tabular-nums text-slate-500">{r.legajo}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-slate-100">
                        {r.nombre}
                        <span className="block text-xs text-slate-500">{r.centroCosto} · {r.tipoLiquidacion}</span>
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-xs text-slate-400">{r.convenio}</td>
                      <td className={td}>{formatDias(r.totalHs)}</td>
                      <td className={td}>{n2(r.feriadosHs)}</td>
                      <td className={td}>{n2(r.extrasHs)}</td>
                      <td className={`${td} text-slate-100`}>{formatDias(r.normalesHs)}</td>
                      {columnas.map((c) => (
                        <td key={c.key} className={td}>
                          {n2(r.incidencias[c.key] ?? 0)}
                        </td>
                      ))}
                      <td className={td}>{n2(r.otrasHs)}</td>
                      <td className={`${td} ${r.sinGoceHs > 0 ? 'text-amber-300' : ''}`}>{n2(r.sinGoceHs)}</td>
                      <td className={td}>{r.presentismo === null ? '—' : formatDias(r.presentismo)}</td>
                      <td className={td}>{r.viaticoDias === null ? 'NO' : formatDias(r.viaticoDias)}</td>
                      <td className={td}>{n2(r.sabDomDias)}</td>
                      <td className={td}>{n2(r.diasVacaciones)}</td>
                      <td className={td}>{r.anticipos ? money.format(r.anticipos) : '—'}</td>
                      <td className={td}>{r.guarderia ? money.format(r.guarderia) : '—'}</td>
                      <td className="px-2 py-1.5">
                        {r.alertas.length === 0 ? (
                          <span className="text-xs text-emerald-400">OK</span>
                        ) : (
                          <span className={`rounded px-1.5 py-0.5 text-xs ${hayError ? 'bg-rose-950 text-rose-300' : 'bg-amber-950 text-amber-300'}`}>
                            {r.alertas.length} {r.alertas.length === 1 ? 'observación' : 'observaciones'}
                          </span>
                        )}
                      </td>
                    </tr>
                    {open && (
                      <tr className="bg-slate-900/40">
                        <td colSpan={17 + columnas.length} className="px-3 py-3 text-sm">
                          <div className="flex flex-col gap-2">
                            <p className="text-slate-400">Presentismo: {r.presentismoNota}.</p>
                            {r.alertas.map((a, i) => (
                              <p key={i} className={a.nivel === 'error' ? 'text-rose-300' : 'text-amber-300'}>
                                {a.detalle}
                              </p>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
            <tfoot className="sticky bottom-0 bg-slate-900 text-slate-200">
              <tr className="border-t border-slate-700 font-medium">
                <td className="px-2 py-2" colSpan={3}>
                  Totales ({rows.length})
                </td>
                <td className={th}>{formatDias(totalesFiltro.total)}</td>
                <td className={th}>{formatDias(totalesFiltro.feriados)}</td>
                <td className={th}>{formatDias(totalesFiltro.extras)}</td>
                <td className={th}>{formatDias(totalesFiltro.normales)}</td>
                {columnas.map((c) => (
                  <td key={c.key} className={th}>
                    {formatDias(totalesFiltro.inc[c.key] ?? 0)}
                  </td>
                ))}
                <td className={th}>{formatDias(totalesFiltro.otras)}</td>
                <td className={th}>{formatDias(totalesFiltro.sinGoce)}</td>
                <td className={th}>—</td>
                <td className={th}>{formatDias(totalesFiltro.viatico)}</td>
                <td className={th}>{formatDias(totalesFiltro.sabDom)}</td>
                <td className={th}>{formatDias(totalesFiltro.vacDias)}</td>
                <td className={th}>{money.format(totalesFiltro.anticipos)}</td>
                <td className={th}>{money.format(totalesFiltro.guarderia)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {data && (
        <p className="text-xs text-slate-500">
          Período: {formatFechaIso(data.desde)} – {formatFechaIso(data.hasta)}. Solo lectura: no modifica la planilla de Google ni Odoo.
        </p>
      )}
    </div>
  );
}

/** Entry point mounted as an Astro client island (`client:load`), same pattern as the other tabs. */
export default function PlanillaApp({ hoy }: Props) {
  return (
    <QueryProvider>
      <PlanillaInner hoy={hoy} />
    </QueryProvider>
  );
}
