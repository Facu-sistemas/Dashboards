import { Fragment, useEffect, useMemo, useState } from 'react';
import QueryProvider from '@/components/QueryProvider';
import { useApiQuery } from '@/components/dashboard/useApiQuery';
import LastUpdated from '@/components/shared/LastUpdated';
import { formatDias, formatFechaIso } from './format';
import { ThOrden, ordenarFilas, useOrden } from './ordenar';
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
  // Columnas opcionales que se muestran: las estándar (Total hs, Feriados y Viático) están siempre; el resto se elige y se recuerda en este navegador.
  const [ocultas, setOcultas] = useState<Set<string>>(new Set());
  useEffect(() => {
    try {
      const g = localStorage.getItem('rrhh-planilla-ocultas');
      if (g) setOcultas(new Set(JSON.parse(g) as string[]));
    } catch {}
  }, []);
  function alternarColumna(key: string) {
    setOcultas((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      try {
        localStorage.setItem('rrhh-planilla-ocultas', JSON.stringify([...next]));
      } catch {}
      return next;
    });
  }
  const v = (key: string) => !ocultas.has(key);
  const [vistaPrevia, setVistaPrevia] = useState(false);
  const [hojaPrevia, setHojaPrevia] = useState<'planilla' | 'exporta'>('exporta');

  useEffect(() => {
    if (!vistaPrevia) return;
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setVistaPrevia(false);
    };
    window.addEventListener('keydown', alTeclear);
    return () => window.removeEventListener('keydown', alTeclear);
  }, [vistaPrevia]);

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

  const { orden, alternar } = useOrden();
  const rows = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    const filtradas = allRows.filter((r) => {
      if (convenio && r.convenio !== convenio) return false;
      if (soloAlertas && r.alertas.length === 0) return false;
      if (q && !r.nombre.toLowerCase().includes(q) && !String(r.legajo).includes(q)) return false;
      return true;
    });
    return ordenarFilas<PlanillaRow>(filtradas, orden, {
      legajo: (r) => r.legajo,
      nombre: (r) => r.nombre,
      convenio: (r) => r.convenio,
      total: (r) => r.totalHs,
      feriados: (r) => r.feriadosHs,
      extras: (r) => r.extrasHs,
      normales: (r) => r.normalesHs,
      otras: (r) => r.otrasHs,
      sinGoce: (r) => r.sinGoceHs,
      presentismo: (r) => r.presentismo,
      viatico: (r) => r.viaticoDias,
      sabDom: (r) => r.sabDomDias,
      vacDias: (r) => r.diasVacaciones,
      anticipos: (r) => r.anticipos,
      guarderia: (r) => r.guarderia,
      obs: (r) => r.alertas.length,
      ...Object.fromEntries((data?.columnas ?? []).map((c) => [`inc:${c.key}`, (r: PlanillaRow) => r.incidencias[c.key] ?? 0])),
    });
  }, [allRows, convenio, soloAlertas, busqueda, orden, data]);

  const totalesFiltro = useMemo(() => {
    const t = { total: 0, feriados: 0, extras: 0, normales: 0, otras: 0, sinGoce: 0, viatico: 0, sabDom: 0, inc: {} as Record<string, number> };
    for (const r of rows) {
      t.total += r.totalHs;
      t.feriados += r.feriadosHs;
      t.extras += r.extrasHs;
      t.normales += r.normalesHs;
      t.otras += r.otrasHs;
      t.sinGoce += r.sinGoceHs;
      t.viatico += r.viaticoDias ?? 0;
      t.sabDom += r.sabDomDias;
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

  // Las dos hojas del Excel, armadas una sola vez: la vista previa muestra exactamente lo que se va a descargar.
  // Planilla completa (todos los empleados de la nómina, sin los filtros de pantalla) con todas las columnas de la planilla de cálculo.
  const hojas = useMemo(() => {
    if (!data) return null;
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
      Observaciones: r.alertas.map((a) => a.detalle).join(' | '),
    }));
    const exporta = data.exporta.map((e) => ({ LEGAJO: e.legajo, CODIGO: e.codigo, VALOR: e.valor }));
    return { filas, exporta };
  }, [data, allRows]);

  async function descargarExcel() {
    if (!data || !hojas) return;
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(hojas.filas), 'Planilla de cálculo');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(hojas.exporta), 'EXPORTA');
    XLSX.writeFile(wb, `planilla-calculo-${data.desde}_${data.hasta}.xlsx`);
    setVistaPrevia(false);
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
            onClick={() => setVistaPrevia(true)}
            disabled={!data}
            title="Muestra la planilla de cálculo completa y la solapa EXPORTA (legajo, código, valor), sin aplicar los filtros de pantalla, y desde ahí se descarga"
            className="rounded border border-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:border-brand-500 disabled:opacity-40"
          >
            Ver y descargar Excel
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
        <details className="rounded-lg border border-slate-800 bg-slate-900 p-3 text-sm text-slate-300">
          <summary className="cursor-pointer" title="Elegí qué columnas ver. Las estándar no se pueden sacar. La elección se recuerda en este navegador y no cambia el Excel.">
            Columnas
          </summary>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs">
            {['ID', 'Nombre', 'Convenio', 'Total hs', 'Feriados', 'Viático (solo SOIVA)'].map((l) => (
              <label key={l} className="flex items-center gap-1.5 text-slate-500" title="Columna estándar: está siempre.">
                <input type="checkbox" checked disabled /> {l}
              </label>
            ))}
            {[
              ['extras', 'Extras'], ['normales', 'Hs normales'], ['inc', 'Incidencias (por tipo de licencia)'], ['otras', 'Otras lic.'],
              ['sinGoce', 'Dif. horas'], ['presentismo', 'Presentismo'], ['sabDom', 'Sáb/Dom vac.'], ['obs', 'Observaciones'],
            ].map(([k, l]) => (
              <label key={k} className="flex cursor-pointer items-center gap-1.5">
                <input type="checkbox" checked={v(k!)} onChange={() => alternarColumna(k!)} /> {l}
              </label>
            ))}
          </div>
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
                <ThOrden col="legajo" orden={orden} alternar={alternar} className="px-2 py-2 font-medium">ID</ThOrden>
                <ThOrden col="nombre" orden={orden} alternar={alternar} className="px-2 py-2 font-medium">Nombre y apellido</ThOrden>
                <ThOrden col="convenio" orden={orden} alternar={alternar} className="px-2 py-2 font-medium">Convenio</ThOrden>
                <ThOrden col="total" orden={orden} alternar={alternar} className={th} title="Horas esperadas de la quincena según la jornada del empleado en Odoo (días hábiles × horas por día), con feriados incluidos.">Total hs</ThOrden>
                <ThOrden col="feriados" orden={orden} alternar={alternar} className={th} title="Horas de feriados del calendario laboral de Odoo dentro de la quincena. Se restan de las horas normales.">Feriados</ThOrden>
                {v('extras') && (
                <ThOrden col="extras" orden={orden} alternar={alternar} className={th} title="Horas extras al 50% cargadas en la planilla de Google (no vienen de Odoo). Código 15 en EXPORTA.">Extras</ThOrden>
                )}
                {v('normales') && (
                <ThOrden col="normales" orden={orden} alternar={alternar} className={th} title="Total hs − feriados − incidencias − vacaciones − otras licencias − permisos sin goce. El banco de horas, compensatorios, tiempo personal pagado y horas extra de Odoo no se descuentan.">Hs normales</ThOrden>
                )}
                {v('inc') && columnas.map((c) => (
                  <ThOrden key={c.key} col={`inc:${c.key}`} orden={orden} alternar={alternar} className={th} title={`Horas de ausencia tipo «${c.label}» aprobadas en Odoo dentro de la quincena.${c.codigo === null ? ' Sin código en EXPORTA: hay que definirlo con RRHH.' : ' Código ' + c.codigo + ' en EXPORTA.'}`}>
                    {c.label}
                  </ThOrden>
                ))}
                {v('otras') && (
                <ThOrden col="otras" orden={orden} alternar={alternar} className={th} title="Horas de licencias de Odoo que la planilla no tiene como columna (ej. maternidad). Se descuentan de las horas normales.">Otras lic.</ThOrden>
                )}
                {v('sinGoce') && (
                <ThOrden col="sinGoce" orden={orden} alternar={alternar} className={th} title="Permisos sin pagar de Odoo (faltas injustificadas). Se descuentan de las horas normales y del presentismo.">Dif. horas</ThOrden>
                )}
                {v('presentismo') && (
                <ThOrden col="presentismo" orden={orden} alternar={alternar} className={th} title="SOIVA: 25, o 20 − 3 por día de enfermedad, accidente o sin goce (vacaciones no descuentan). Madereros: 10 con quita proporcional por faltas sin goce. Sale de las ausencias de Odoo; tardanzas y salidas anticipadas todavía no entran. Pasá el mouse por cada valor para ver el cálculo.">Presentismo</ThOrden>
                )}
                <ThOrden col="viatico" orden={orden} alternar={alternar} className={th} title="Solo SOIVA: días de la quincena menos vacaciones y faltas sin goce (las carpetas médicas sí pagan). Código 40 en EXPORTA.">Viático</ThOrden>
                {v('sabDom') && (
                <ThOrden col="sabDom" orden={orden} alternar={alternar} className={th} title="Por cada bloque de 5 días hábiles de vacaciones aprobadas en Odoo suma sábado y domingo (+2 días).">Sáb/Dom vac.</ThOrden>
                )}
                {v('obs') && (
                <ThOrden col="obs" orden={orden} alternar={alternar} className="px-2 py-2 font-medium" title="Cantidad de observaciones de la fila.">Observaciones</ThOrden>
                )}
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
                      {v('extras') && (
                      <td className={td}>{n2(r.extrasHs)}</td>
                      )}
                      {v('normales') && (
                      <td className={`${td} text-slate-100`}>{formatDias(r.normalesHs)}</td>
                      )}
                      {v('inc') && columnas.map((c) => (
                        <td key={c.key} className={td}>
                          {n2(r.incidencias[c.key] ?? 0)}
                        </td>
                      ))}
                      {v('otras') && (
                      <td className={td}>{n2(r.otrasHs)}</td>
                      )}
                      {v('sinGoce') && (
                      <td className={`${td} ${r.sinGoceHs > 0 ? 'text-amber-300' : ''}`}>{n2(r.sinGoceHs)}</td>
                      )}
                      {v('presentismo') && (
                      <td className={td} title={`Presentismo: ${r.presentismoNota}`}>{r.presentismo === null ? '—' : formatDias(r.presentismo)}</td>
                      )}
                      <td className={td} title={r.viaticoDias === null ? 'El viático y refrigerio solo corresponde al convenio SOIVA.' : undefined}>{r.viaticoDias === null ? '—' : formatDias(r.viaticoDias)}</td>
                      {v('sabDom') && (
                      <td className={td}>{n2(r.sabDomDias)}</td>
                      )}
                      {v('obs') && (
                      <td className="px-2 py-1.5">
                        {r.alertas.length === 0 ? (
                          <span className="text-xs text-emerald-400">OK</span>
                        ) : (
                          <span className={`rounded px-1.5 py-0.5 text-xs ${hayError ? 'bg-rose-950 text-rose-300' : 'bg-amber-950 text-amber-300'}`}>
                            {r.alertas.length} {r.alertas.length === 1 ? 'observación' : 'observaciones'}
                          </span>
                        )}
                      </td>
                      )}
                    </tr>
                    {open && (
                      <tr className="bg-slate-900/40">
                        <td colSpan={100} className="px-3 py-3 text-sm">
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
                {v('extras') && (
                <td className={th}>{formatDias(totalesFiltro.extras)}</td>
                )}
                {v('normales') && (
                <td className={th}>{formatDias(totalesFiltro.normales)}</td>
                )}
                {v('inc') && columnas.map((c) => (
                  <td key={c.key} className={th}>
                    {formatDias(totalesFiltro.inc[c.key] ?? 0)}
                  </td>
                ))}
                {v('otras') && (
                <td className={th}>{formatDias(totalesFiltro.otras)}</td>
                )}
                {v('sinGoce') && (
                <td className={th}>{formatDias(totalesFiltro.sinGoce)}</td>
                )}
                {v('presentismo') && (
                <td className={th}>—</td>
                )}
                <td className={th}>{formatDias(totalesFiltro.viatico)}</td>
                {v('sabDom') && (
                <td className={th}>{formatDias(totalesFiltro.sabDom)}</td>
                )}
                {v('obs') && <td />}
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

      {data && data.sinOdoo.length > 0 && (
        <p
          className="rounded border border-slate-800 bg-slate-900 p-3 text-xs text-slate-400"
          title="La lista de la planilla sale de los empleados activos de Odoo. Estas personas siguen en la hoja de nómina (PLANILLA DE CALCULO 2Q) pero ya no están activas en Odoo, por eso no se liquidan acá. Si se fueron, conviene sacarlas de la hoja."
        >
          Fuera de la planilla (en la hoja de nómina pero no activos en Odoo): {data.sinOdoo.map((p) => `${p.nombre} (${p.legajo})`).join(', ')}.
        </p>
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

      {vistaPrevia && data && hojas && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setVistaPrevia(false)}
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Vista previa del Excel"
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[90vh] w-full max-w-6xl flex-col gap-4 rounded-lg border border-slate-700 bg-slate-900 p-5"
          >
            <div>
              <h3 className="text-base font-semibold text-slate-100">Vista previa de lo que se va a descargar</h3>
              <p className="mt-1 text-sm text-slate-400">
                Período {formatFechaIso(data.desde)} – {formatFechaIso(data.hasta)}. El archivo lleva todos los empleados, sin los filtros de
                pantalla, en dos hojas. Revisalas y descargá si está bien.
              </p>
            </div>

            <div role="tablist" className="inline-flex w-fit rounded-lg border border-slate-800 bg-slate-950 p-1 text-sm">
              {(
                [
                  ['exporta', `EXPORTA (${hojas.exporta.length} filas)`],
                  ['planilla', `Planilla de cálculo (${hojas.filas.length} empleados)`],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={hojaPrevia === id}
                  onClick={() => setHojaPrevia(id)}
                  className={`rounded-md px-3 py-1.5 ${hojaPrevia === id ? 'bg-slate-800 text-slate-100' : 'text-slate-400 hover:text-slate-200'}`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="min-h-0 flex-1 overflow-auto rounded border border-slate-800">
              <HojaPrevia filas={hojaPrevia === 'exporta' ? hojas.exporta : hojas.filas} />
            </div>

            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setVistaPrevia(false)}
                className="rounded border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:border-slate-500"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={descargarExcel}
                className="rounded bg-brand-500 px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
              >
                Descargar Excel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Tabla genérica de una hoja del Excel: las columnas son las claves de la primera fila, igual que las arma xlsx. */
function HojaPrevia({ filas }: { filas: Record<string, unknown>[] }) {
  if (filas.length === 0) return <p className="p-6 text-center text-sm text-slate-500">Esta hoja no tiene filas.</p>;
  const columnas = Object.keys(filas[0]!);
  return (
    <table className="w-full text-left text-xs">
      <thead className="sticky top-0 bg-slate-900 uppercase tracking-wide text-slate-500">
        <tr>
          {columnas.map((c) => (
            <th key={c} className="whitespace-nowrap px-2 py-2 font-medium">
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {filas.map((f, i) => (
          <tr key={i} className="border-t border-slate-800">
            {columnas.map((c) => (
              <td key={c} className="whitespace-nowrap px-2 py-1 tabular-nums text-slate-300">
                {String(f[c] ?? '')}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
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
