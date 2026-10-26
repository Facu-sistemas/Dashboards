import { Fragment, useMemo, useState } from 'react';
import QueryProvider from '@/components/QueryProvider';
import { useApiQuery } from '@/components/dashboard/useApiQuery';
import LastUpdated from '@/components/shared/LastUpdated';
import { formatDias, formatFechaIso } from './format';
import { ultimasQuincenas } from './quincena-utils';
import type { QuincenaAlerta, QuincenaEmpleadoRow, RrhhQuincenaResult } from '@/lib/odoo/rrhh-quincena';

interface Props {
  /** Fecha de hoy (ISO) calculada en el servidor, para no depender de la zona horaria del navegador. */
  hoy: string;
}

const MAX_DIAS = 93;

const hs = (v: number) => `${formatDias(v)} hs`;

const selectClass =
  'rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-100 focus:border-brand-500 focus:outline-none';

const ESTADO_LABEL: Record<string, string> = { confirm: 'Sin aprobar', validate1: 'Falta 2ª aprobación', validate: 'Aprobada' };

function Kpi({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${tone ?? 'text-slate-100'}`}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

function AlertaBadge({ alerta }: { alerta: QuincenaAlerta }) {
  const error = alerta.nivel === 'error';
  return (
    <span
      title={alerta.detalle}
      className={`inline-block rounded px-1.5 py-0.5 text-xs ${error ? 'bg-rose-950 text-rose-300' : 'bg-amber-950 text-amber-300'}`}
    >
      {{
        'banco-descuadre': 'Banco no cuadra',
        superpuestas: 'Licencias superpuestas',
        exceso: 'Excede la jornada',
        pendiente: 'Pendiente',
        'banco-negativo': 'Banco negativo',
      }[alerta.tipo]}
    </span>
  );
}

function Detalle({ row }: { row: QuincenaEmpleadoRow }) {
  return (
    <div className="flex flex-col gap-4 text-sm">
      <p className="text-slate-400">
        Jornada de {formatDias(row.horasPorDia)} hs × {row.diasHabiles} días hábiles = {hs(row.horasEsperadas)}. Saldo del banco de horas hoy:{' '}
        <span className="text-slate-200">{hs(row.bancoSaldo)}</span>.
      </p>

      {row.alertas.length > 0 && (
        <ul className="flex flex-col gap-1">
          {row.alertas.map((a, i) => (
            <li key={i} className={a.nivel === 'error' ? 'text-rose-300' : 'text-amber-300'}>
              {a.detalle}
            </li>
          ))}
        </ul>
      )}

      {row.licencias.length === 0 ? (
        <p className="text-slate-500">Sin licencias en el período.</p>
      ) : (
        <table className="w-full max-w-3xl text-left">
          <thead className="text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="py-1 pr-3 font-medium">Tipo</th>
              <th className="py-1 pr-3 font-medium">Desde</th>
              <th className="py-1 pr-3 font-medium">Hasta</th>
              <th className="py-1 pr-3 text-right font-medium">En el período</th>
              <th className="py-1 pr-3 text-right font-medium">Licencia completa</th>
              <th className="py-1 font-medium">Estado</th>
            </tr>
          </thead>
          <tbody>
            {row.licencias.map((l) => (
              <tr key={l.id} className="border-t border-slate-800">
                <td className="py-1 pr-3 text-slate-200">{l.tipo}</td>
                <td className="py-1 pr-3 text-slate-400">{formatFechaIso(l.desde)}</td>
                <td className="py-1 pr-3 text-slate-400">{formatFechaIso(l.hasta)}</td>
                <td className="py-1 pr-3 text-right tabular-nums text-slate-200">{hs(l.horasEnQuincena)}</td>
                <td className="py-1 pr-3 text-right tabular-nums text-slate-400">{hs(l.horasLicencia)}</td>
                <td className={`py-1 ${l.estado === 'validate' ? 'text-slate-400' : 'text-amber-300'}`}>{ESTADO_LABEL[l.estado]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function QuincenaInner({ hoy }: Props) {
  // Arranca en la última quincena cerrada; después se puede elegir cualquier rango.
  const inicial = useMemo(() => {
    const qs = ultimasQuincenas(hoy, 2);
    return qs.find((q) => !q.enCurso) ?? qs[0]!;
  }, [hoy]);
  const [desde, setDesde] = useState(inicial.desde);
  const [hasta, setHasta] = useState(inicial.hasta);
  const rangoDias = desde && hasta ? Math.round((Date.parse(hasta) - Date.parse(desde)) / 86_400_000) + 1 : 0;
  const rangoError =
    !desde || !hasta
      ? 'Elegí las dos fechas.'
      : hasta < desde
        ? 'La fecha "hasta" es anterior a "desde".'
        : rangoDias > MAX_DIAS
          ? `El rango no puede superar ${MAX_DIAS} días.`
          : null;

  const [departamento, setDepartamento] = useState('');
  const [busqueda, setBusqueda] = useState('');
  const [soloDiferencias, setSoloDiferencias] = useState(false);
  const [abierto, setAbierto] = useState<Set<number>>(new Set());

  const query = useApiQuery<RrhhQuincenaResult>(
    ['rrhh-horas', desde, hasta],
    `/api/rrhh-quincena?desde=${desde}&hasta=${hasta}`,
    { enabled: !rangoError }
  );
  const data = query.data;
  const allRows = data?.rows ?? [];

  const departamentos = useMemo(
    () => [...new Set(allRows.map((r) => r.departamento).filter((d): d is string => Boolean(d)))].sort((a, b) => a.localeCompare(b, 'es')),
    [allRows]
  );

  const rows = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return allRows.filter((r) => {
      if (departamento && r.departamento !== departamento) return false;
      if (soloDiferencias && r.alertas.length === 0) return false;
      if (q && !r.nombre.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [allRows, departamento, busqueda, soloDiferencias]);

  const hayFichadas = (data?.fichadasTotal ?? 0) > 0;
  const maxTipo = Math.max(1, ...(data?.porTipo ?? []).map((t) => t.horas));
  const ausentismo = data && data.totales.horasEsperadas > 0 ? data.totales.tiempoPersonalHs / data.totales.horasEsperadas : null;

  function toggle(id: number) {
    setAbierto((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function exportarExcel() {
    if (!data) return;
    const XLSX = await import('xlsx');
    // Ninguna columna sale negativa: el banco en contra va en su propia columna, en positivo.
    const noNeg = (v: number) => Math.max(0, v);
    const hhmm = (v: number) => {
      const min = Math.round(noNeg(v) * 60);
      return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`;
    };
    // Siempre todos los empleados activos (aunque no hayan fichado ni tengan licencias), sin importar los filtros de pantalla.
    // Formato de la planilla BASE RELOJ FICHADOR: encabezados en la fila 4, datos desde la fila 5, columnas A–AI fijas.
    // Cada licencia sale en su columna; un día de banco usado se informa como 8,80 aunque Odoo descuente 8,30 del saldo.
    const COLUMNAS_LICENCIA: [string, string[]][] = [
      ['Accidente', ['Accidente']],
      ['Tramite', ['Tramite']],
      ['Enfermedad', ['Baja por enfermedad']],
    ];
    const COLUMNAS_LICENCIA_2: [string, string[]][] = [
      ['Vacaciones', ['Vacaciones']],
      ['Matrimonio', ['Matrimonio']],
      ['Exam. Prenupcial', ['Examen prenupcial', 'Exam. Prenupcial']],
      ['Nacimiento', ['Nacimiento']],
      ['Fallecimiento', ['Fallecimiento']],
      ['Mudanza', ['Mudanza']],
      ['Estudio', ['Estudio']],
      ['Donación Sangre', ['Donación de sangre']],
      ['Bombero', ['Bombero']],
      ['Permiso Gremial', ['Permiso gremial']],
      ['Lactancia', ['Lactancia']],
      ['Casamiento Hijo', ['Casamiento de hijo', 'Casamiento hijo']],
      ['Día CCT', ['Dia convenio']],
    ];
    const horasTipo = (r: QuincenaEmpleadoRow, nombres: string[]) =>
      noNeg(r.porTipo.filter((x) => nombres.includes(x.tipo)).reduce((s, x) => s + x.horas, 0));
    const d2 = (v: number) => Math.round(noNeg(v) * 100) / 100;
    // Legajo sin agrupamiento ni ceros: "01/0602" → 602.
    const legajoSinCeros = (l: string | null) => {
      const n = Number((l ?? '').split('/').pop());
      return Number.isFinite(n) && n > 0 ? n : '';
    };
    const encabezados = [
      'Departamento', 'ID de usuario', 'Nombre', 'Laborales [Días]', 'Trabajados [Días]', 'Llegadas tarde [Horas]',
      'Salidas temprano [Horas]', 'Ausente [Horas]', 'Tiempo extra [Horas]', 'Tiempo trabajado [Horas]', 'Presentismo',
      'Break Time', ...COLUMNAS_LICENCIA.map(([c]) => c), 'AVISO', ...COLUMNAS_LICENCIA_2.map(([c]) => c),
      'Situación Laboral', 'Banco de horas', 'Lic x Maternidad', 'Injustificadas', '', 'control',
      // Extras de control, a la derecha de la columna AI para no correr las que toma la planilla.
      'CUIL', 'Convenio', 'Centro de costo', 'Supervisor', 'Tiempo trabajado (hh:mm)', 'Banco: saldo a favor (hs)',
      'Banco: saldo en contra (hs)', 'Licencias sin aprobar (hs)', 'Diferencias',
    ];
    const filas = allRows.map((r) => {
      const fichadas = d2(r.fichadasHs);
      const licenciasHs = r.tiempoPersonalHs;
      return [
        r.departamento ?? '', legajoSinCeros(r.legajo), r.nombre, r.diasHabiles - Math.round(r.feriadosHs / 8.8), r.diasTrabajados,
        0, 0, 0, 0, fichadas, r.diasTrabajados * 10, 0,
        ...COLUMNAS_LICENCIA.map(([, n]) => d2(horasTipo(r, n))), 0,
        ...COLUMNAS_LICENCIA_2.map(([, n]) => d2(horasTipo(r, n))),
        0, d2(r.bancoUsado), d2(horasTipo(r, ['Licencia por maternidad'])), d2(r.injustificadasHs), '',
        d2(fichadas + licenciasHs),
        r.cuil ?? '', r.convenio ?? '', r.centroCosto ?? '', r.supervisor ?? '', hhmm(r.fichadasHs), noNeg(r.bancoSaldo),
        noNeg(-r.bancoSaldo), noNeg(r.pendientesHs), r.alertas.map((a) => a.detalle).join(' | '),
      ];
    });
    const ws = XLSX.utils.aoa_to_sheet([[], [], [], encabezados, ...filas]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Horas');
    XLSX.writeFile(wb, `rrhh-horas-${data.desde}_${data.hasta}.xlsx`);
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
          <label className="flex items-center gap-2 pb-1.5">
            <input type="checkbox" checked={soloDiferencias} onChange={(e) => setSoloDiferencias(e.target.checked)} />
            Solo con diferencias
          </label>
        </div>
        <div className="flex items-center gap-4">
          <LastUpdated dataUpdatedAt={query.dataUpdatedAt} />
          <button
            type="button"
            onClick={exportarExcel}
            disabled={!data || allRows.length === 0}
            title="Exporta todos los empleados activos, sin aplicar los filtros de pantalla"
            className="rounded border border-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:border-brand-500 disabled:opacity-40"
          >
            Descargar Excel
          </button>
        </div>
      </div>

      {!rangoError && hasta >= hoy && (
        <p className="rounded border border-amber-900 bg-amber-950/40 p-3 text-sm text-amber-300">
          El período incluye días que todavía no pasaron: las horas de jornada cuentan hasta el {formatFechaIso(hasta)} pero lo cargado en Odoo puede
          cambiar hasta el cierre.
        </p>
      )}

      {query.isLoading ? (
        <div className="h-28 w-full animate-pulse-slow rounded-lg bg-slate-800/60" />
      ) : (
        data && (
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-6">
            <Kpi label="Horas de jornada" value={hs(Math.round(data.totales.horasEsperadas))} hint={`${data.totales.empleados} empleados · ${data.diasHabiles} días hábiles`} />
            <Kpi
              label="Feriados"
              value={hs(Math.round(data.totales.feriadosHs))}
              hint={data.feriados.length ? data.feriados.map((f) => formatFechaIso(f).slice(0, 5)).join(', ') : 'Sin feriados'}
            />
            <Kpi
              label="Tiempo personal"
              value={hs(Math.round(data.totales.tiempoPersonalHs))}
              hint={ausentismo === null ? undefined : `${(ausentismo * 100).toFixed(1).replace('.', ',')}% de la jornada`}
            />
            <Kpi label="Horas a trabajar" value={hs(Math.round(data.totales.horasATrabajar))} hint="Jornada − feriados − tiempo personal" tone="text-emerald-400" />
            <Kpi
              label="Banco de horas"
              value={`−${formatDias(Math.round(data.totales.bancoUsado))} / +${formatDias(Math.round(data.totales.bancoAcreditado))}`}
              hint="Usado / acreditado en el período"
            />
            <Kpi
              label="Con diferencias"
              value={String(data.totales.conAlertas)}
              hint={`${data.totales.conErrores} con errores a corregir`}
              tone={data.totales.conErrores > 0 ? 'text-rose-400' : data.totales.conAlertas > 0 ? 'text-amber-400' : 'text-emerald-400'}
            />
          </div>
        )
      )}

      {data && data.porTipo.length > 0 && (
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <h3 className="mb-3 text-sm font-semibold text-slate-200">Tiempo personal por tipo</h3>
          <ul className="flex flex-col gap-2 text-sm">
            {data.porTipo.map((t) => (
              <li key={t.tipo} className="grid grid-cols-[12rem_1fr_9rem] items-center gap-3">
                <span className="truncate text-slate-300">{t.tipo}</span>
                <span className="h-2 rounded bg-slate-800">
                  <span className="block h-2 rounded bg-brand-500" style={{ width: `${(t.horas / maxTipo) * 100}%` }} />
                </span>
                <span className="text-right tabular-nums text-slate-400">
                  {hs(t.horas)} · {t.empleados} {t.empleados === 1 ? 'persona' : 'personas'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {data && !hayFichadas && (
        <p className="text-xs text-slate-500">
          No hay fichadas de Odoo en este período (el fichaje es reciente), así que las horas a trabajar se calculan por jornada y no contra horas
          efectivamente fichadas.
        </p>
      )}

      {query.isLoading ? (
        <div className="h-64 w-full animate-pulse-slow rounded-lg bg-slate-800/60" />
      ) : rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-500">Sin empleados que coincidan con el filtro.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-900 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2 font-medium">Empleado</th>
                <th className="px-3 py-2 text-right font-medium">Jornada</th>
                <th className="px-3 py-2 text-right font-medium">Feriados</th>
                <th className="px-3 py-2 font-medium">Tiempo personal</th>
                <th className="px-3 py-2 text-right font-medium">A trabajar</th>
                {hayFichadas && <th className="px-3 py-2 text-right font-medium">Fichadas</th>}
                <th className="px-3 py-2 text-right font-medium">Banco (saldo)</th>
                <th className="px-3 py-2 font-medium">Diferencias</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const open = abierto.has(r.id);
                return (
                  <Fragment key={r.id}>
                    <tr onClick={() => toggle(r.id)} className="cursor-pointer border-t border-slate-800 hover:bg-slate-900/60">
                      <td className="px-3 py-2">
                        <span className="text-slate-100">{r.nombre}</span>
                        {r.departamento && <span className="block text-xs text-slate-500">{r.departamento}</span>}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-300">{hs(r.horasEsperadas)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-400">{r.feriadosHs ? hs(r.feriadosHs) : '—'}</td>
                      <td className="px-3 py-2">
                        {r.porTipo.length === 0 ? (
                          <span className="text-slate-600">—</span>
                        ) : (
                          <>
                            <span className="tabular-nums text-slate-200">{hs(r.tiempoPersonalHs)}</span>
                            <span className="block text-xs text-slate-500">{r.porTipo.map((t) => `${t.tipo} ${formatDias(t.horas)}`).join(' · ')}</span>
                          </>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-100">{hs(r.horasATrabajar)}</td>
                      {hayFichadas && <td className="px-3 py-2 text-right tabular-nums text-slate-400">{r.fichadasHs ? hs(r.fichadasHs) : '—'}</td>}
                      <td className={`px-3 py-2 text-right tabular-nums ${r.bancoSaldo < 0 ? 'text-rose-300' : 'text-slate-300'}`}>
                        {hs(r.bancoSaldo)}
                        {(r.bancoAcreditado > 0 || r.bancoUsado > 0) && (
                          <span className="block text-xs text-slate-500">
                            {r.bancoAcreditado > 0 && `+${formatDias(r.bancoAcreditado)} `}
                            {r.bancoUsado > 0 && `−${formatDias(r.bancoUsado)}`}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <span className="flex flex-wrap gap-1">
                          {r.alertas.length === 0 ? (
                            <span className="text-xs text-emerald-400">Cuadra</span>
                          ) : (
                            r.alertas.map((a, i) => <AlertaBadge key={i} alerta={a} />)
                          )}
                        </span>
                      </td>
                    </tr>
                    {open && (
                      <tr className="bg-slate-900/40">
                        <td colSpan={hayFichadas ? 8 : 7} className="px-3 py-3">
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
export default function QuincenaApp({ hoy }: Props) {
  return (
    <QueryProvider>
      <QuincenaInner hoy={hoy} />
    </QueryProvider>
  );
}
