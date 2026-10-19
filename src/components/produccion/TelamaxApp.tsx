import { Fragment, useMemo, useRef, useState } from 'react';
import QueryProvider from '@/components/QueryProvider';
import { useApiQuery } from '@/components/dashboard/useApiQuery';
import LastUpdated from '@/components/shared/LastUpdated';
import { planificar } from '@/lib/telamax/engine';
import { diaDe, fechasDe, formatTablaH, fromISO, hoyArgentina } from '@/lib/telamax/fechas';
import { armarPlanillas, fechaPorDefecto, filtrarTradicionalFilas } from '@/lib/telamax/pedidos';
import type { FilaPlanilla, Planillas, Procedencia, Proceso, ResultadoTelamax } from '@/lib/telamax/types';
import type { TelamaxBasesResponse } from '@/lib/odoo/telamax';
import type { TelamaxPedidosResponse } from '@/lib/odoo/telamax-pedidos';
import TelamaxGantt from './TelamaxGantt';
import { generarPdfGantt, generarPdfRutas } from './telamax-pdf';
import { TITULO_PROCESO, barrasArmado, barrasCnc, diasDelPlan, leerPlanilla, mapaColores, maxTiempo, validarPlanilla } from './telamax-ui';

type Vista = 'rutas' | 'gantt' | 'log';
type Origen = 'odoo' | 'archivos';
type ClavePlanilla = 'atrasados' | 'dia' | 'siguiente';

interface PlanillaCargada {
  nombre: string;
  filas: FilaPlanilla[];
}

const PLANILLAS: { clave: ClavePlanilla; label: string; procedencia: Procedencia }[] = [
  { clave: 'atrasados', label: 'Atrasados', procedencia: 'ATRASADOS' },
  { clave: 'dia', label: 'Planilla del día', procedencia: 'DIA' },
  { clave: 'siguiente', label: 'Día siguiente', procedencia: 'SIGUIENTE' },
];

const PROCESOS: Proceso[] = ['T', 'C', 'A'];

const ETIQUETA_PROCEDENCIA: Record<Procedencia, string> = { ATRASADOS: 'Atrasado', DIA: 'Día', SIGUIENTE: 'Siguiente' };

const fmtActualizado = new Intl.DateTimeFormat('es-AR', {
  timeZone: 'America/Argentina/Buenos_Aires',
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

/** `write_date` de Odoo viene en UTC como "YYYY-MM-DD HH:mm:ss". */
const odooUtcADate = (s: string) => new Date(`${s.replace(' ', 'T')}Z`);

function descargar(doc: { save: (n: string) => unknown }, nombre: string) {
  doc.save(nombre);
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
      <path d="M12 3v12" />
      <path d="M7 10l5 5 5-5" />
      <path d="M4 19h16" />
    </svg>
  );
}

function CargaPlanilla({
  label,
  cargada,
  onCargar,
  onQuitar,
}: {
  label: string;
  cargada: PlanillaCargada | null;
  onCargar: (file: File) => Promise<string | null>;
  onQuitar: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [leyendo, setLeyendo] = useState(false);

  async function alElegir(file: File | undefined) {
    if (!file) return;
    setLeyendo(true);
    setError(null);
    setError(await onCargar(file));
    setLeyendo(false);
    if (input.current) input.current.value = '';
  }

  return (
    <div className={`rounded-lg border p-3 ${cargada ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-slate-800 bg-slate-900/60'}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-semibold text-slate-100">{label}</div>
        {cargada && (
          <button type="button" onClick={onQuitar} className="text-[11px] text-slate-500 hover:text-red-400">
            Quitar
          </button>
        )}
      </div>
      <div className="mt-1 min-h-[2.25rem] text-[11px] text-slate-500">
        {cargada ? (
          <>
            <span className="text-emerald-400">✓ {cargada.filas.length} filas</span> · <span className="break-all">{cargada.nombre}</span>
          </>
        ) : (
          'Sin cargar (.xlsx)'
        )}
      </div>
      <input ref={input} type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => void alElegir(e.target.files?.[0])} />
      <button
        type="button"
        disabled={leyendo}
        onClick={() => input.current?.click()}
        className="mt-1 rounded-md border border-slate-700 bg-slate-800/60 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:border-slate-500 disabled:opacity-50"
      >
        {leyendo ? 'Leyendo…' : cargada ? 'Reemplazar' : 'Elegir archivo'}
      </button>
      {error && <p className="mt-2 text-[11px] text-red-400">{error}</p>}
    </div>
  );
}

function TablaRuta({ proceso, plan, filtro, fechaBase }: { proceso: Proceso; plan: ResultadoTelamax['plan']; filtro: string; fechaBase: Date }) {
  const hoy = fechaBase;
  const filas = plan.filter((r) => r.proceso === proceso && (filtro === 'Todos' || r.modelo === filtro));
  const encabezados = ['Inicio', 'Fin', 'Modelo', 'Parte', 'Insumo', 'Tendidas', 'Metros', 'Origen', 'Fecha corte', 'Fecha planif.'];

  let diaActual: number | null = null;
  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold tracking-wide text-slate-100">{TITULO_PROCESO[proceso]}</h3>
      <div className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-900/60">
        <table className="w-full min-w-[820px] text-left text-xs">
          <thead className="bg-slate-800/70 text-slate-300">
            <tr>
              {encabezados.map((h) => (
                <th key={h} className="whitespace-nowrap px-2.5 py-2 font-semibold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filas.length === 0 && (
              <tr>
                <td colSpan={encabezados.length} className="px-3 py-6 text-center text-slate-500">
                  Sin registros.
                </td>
              </tr>
            )}
            {filas.map((r, i) => {
              const dia = diaDe(r.inicio);
              const separador = dia !== diaActual;
              diaActual = dia;
              const f = fechasDe(r.procedencia, hoy);
              return (
                <Fragment key={i}>
                  {separador && (
                    <tr className="bg-slate-800/50">
                      <td colSpan={encabezados.length} className="px-3 py-1 text-center text-[11px] font-semibold tracking-wider text-slate-300">
                        DÍA {dia}
                      </td>
                    </tr>
                  )}
                  <tr className="border-t border-slate-800/70 text-slate-200">
                    <td className="whitespace-nowrap px-2.5 py-1.5 tabular-nums">{formatTablaH(r.inicio)}</td>
                    <td className="whitespace-nowrap px-2.5 py-1.5 tabular-nums">{formatTablaH(r.fin)}</td>
                    <td className="px-2.5 py-1.5">{r.modelo}</td>
                    <td className="whitespace-nowrap px-2.5 py-1.5">{r.parte}</td>
                    <td className="px-2.5 py-1.5">{r.insumo}</td>
                    <td className="px-2.5 py-1.5 tabular-nums">{r.capas === '-' ? '1' : r.capas}</td>
                    <td className="px-2.5 py-1.5 tabular-nums">{proceso !== 'A' && typeof r.metros === 'number' ? r.metros.toFixed(2) : '-'}</td>
                    <td className="whitespace-nowrap px-2.5 py-1.5 text-slate-400">{ETIQUETA_PROCEDENCIA[r.procedencia]}</td>
                    <td className="whitespace-nowrap px-2.5 py-1.5 tabular-nums">{f.corte}</td>
                    <td className="whitespace-nowrap px-2.5 py-1.5 tabular-nums">{f.planificacion}</td>
                  </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function TelamaxInner() {
  const basesQuery = useApiQuery<TelamaxBasesResponse>(['telamax-bases'], '/api/telamax-bases');
  const [planillas, setPlanillas] = useState<Record<ClavePlanilla, PlanillaCargada | null>>({ atrasados: null, dia: null, siguiente: null });
  const [operarios, setOperarios] = useState(4);
  const [resultado, setResultado] = useState<{ r: ResultadoTelamax; operarios: number; fechaBase: Date } | null>(null);
  const [origen, setOrigen] = useState<Origen>('odoo');
  const [fecha, setFecha] = useState(() => fechaPorDefecto(hoyArgentina()));
  const [paraAtras, setParaAtras] = useState(true);
  const [ignorarTradicional, setIgnorarTradicional] = useState(false);
  const pedidosQuery = useApiQuery<TelamaxPedidosResponse>(['telamax-pedidos'], '/api/telamax-pedidos', { enabled: origen === 'odoo' });
  const [errorCalculo, setErrorCalculo] = useState<string | null>(null);
  const [filtro, setFiltro] = useState('Todos');
  const [vista, setVista] = useState<Vista>('rutas');

  const bases = basesQuery.data?.bases;
  const odoo = useMemo(
    () => (pedidosQuery.data ? armarPlanillas(pedidosQuery.data.pedidos, { fecha, paraAtras, ignorarTradicional }) : null),
    [pedidosQuery.data, fecha, paraAtras, ignorarTradicional],
  );
  const diasConPedidos = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of pedidosQuery.data?.pedidos ?? []) m.set(p.fecha, (m.get(p.fecha) ?? 0) + 1);
    return [...m.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
  }, [pedidosQuery.data]);
  const hayPlanilla =
    origen === 'odoo' ? !!odoo && odoo.conteos.atrasados + odoo.conteos.dia + odoo.conteos.siguiente > 0 : Object.values(planillas).some((p) => p !== null);
  const plan = resultado?.r.plan ?? [];
  const colores = useMemo(() => mapaColores(plan), [plan]);
  const modelos = useMemo(() => [...new Set(plan.map((r) => r.modelo))].sort(), [plan]);

  async function cargar(clave: ClavePlanilla, file: File): Promise<string | null> {
    try {
      const filas = await leerPlanilla(file);
      const problema = validarPlanilla(filas);
      if (problema) return problema;
      setPlanillas((p) => ({ ...p, [clave]: { nombre: file.name, filas } }));
      return null;
    } catch (err) {
      return `No se pudo leer el archivo: ${err instanceof Error ? err.message : 'formato inesperado'}`;
    }
  }

  function limpiar() {
    setPlanillas({ atrasados: null, dia: null, siguiente: null });
    setResultado(null);
    setErrorCalculo(null);
    setFiltro('Todos');
  }

  function optimizar() {
    if (!bases) return;
    setErrorCalculo(null);
    try {
      let entrada: Planillas;
      let fechaBase = hoyArgentina();
      if (origen === 'odoo') {
        if (!odoo) return;
        entrada = odoo.planillas;
        fechaBase = fromISO(fecha);
      } else {
        const quitar = (filas: FilaPlanilla[] | undefined) => (ignorarTradicional ? filtrarTradicionalFilas(filas ?? []).filas : (filas ?? []));
        entrada = { atrasados: quitar(planillas.atrasados?.filas), dia: quitar(planillas.dia?.filas), siguiente: quitar(planillas.siguiente?.filas) };
      }
      const r = planificar(bases, entrada, operarios);
      setResultado({ r, operarios, fechaBase });
      setFiltro('Todos');
      setVista('rutas');
    } catch (err) {
      setResultado(null);
      setErrorCalculo(err instanceof Error ? err.message : 'Error inesperado en el cálculo.');
    }
  }

  const ganttCnc = useMemo(() => barrasCnc(plan, filtro, colores), [plan, filtro, colores]);
  const ganttArm = useMemo(() => barrasArmado(plan, filtro, colores, resultado?.operarios ?? 1), [plan, filtro, colores, resultado]);
  const maxT = maxTiempo(plan);
  const filasArmado = Array.from({ length: resultado?.operarios ?? 0 }, (_, i) => `OP ${i + 1}`);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs">
          {basesQuery.isLoading && <span className="text-slate-500">Leyendo las bases desde Odoo…</span>}
          {basesQuery.isError && <span className="text-red-400">No se pudieron leer las bases del tablero Telamax en Odoo.</span>}
          {bases && (
            <span className="rounded border border-emerald-500/30 bg-emerald-500/5 px-2 py-1 text-emerald-300">
              ✓ Bases cargadas desde Odoo
              {basesQuery.data?.actualizado && <span className="text-slate-400"> · editadas {fmtActualizado.format(odooUtcADate(basesQuery.data.actualizado))}</span>}
            </span>
          )}
          <button
            type="button"
            onClick={() => void basesQuery.refetch()}
            disabled={basesQuery.isFetching}
            className="rounded border border-slate-700 px-2 py-1 text-slate-400 hover:border-slate-500 hover:text-slate-200 disabled:opacity-50"
            title="Vuelve a leer el tablero Telamax de Odoo (si lo editaste)"
          >
            {basesQuery.isFetching ? 'Actualizando…' : 'Releer bases'}
          </button>
        </div>
        <LastUpdated dataUpdatedAt={basesQuery.dataUpdatedAt} />
      </div>

      <div className="inline-flex w-fit rounded-lg border border-slate-800 bg-slate-900/60 p-1">
        {(
          [
            ['odoo', 'Desde Odoo'],
            ['archivos', 'Desde archivos'],
          ] as [Origen, string][]
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setOrigen(id)}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold ${origen === id ? 'bg-brand-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {origen === 'odoo' && (
        <div className="flex flex-col gap-3 rounded-lg border border-slate-800 bg-slate-900/60 p-4">
          <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
            <label className="flex flex-col gap-1 text-xs text-slate-400">
              Día de producción
              <input
                type="date"
                value={fecha}
                onChange={(e) => e.target.value && setFecha(e.target.value)}
                className="rounded-md border border-slate-700 bg-slate-800/60 px-2 py-1.5 text-sm text-slate-100"
              />
            </label>
            <label className="flex items-center gap-2 pb-1.5 text-xs text-slate-300" title="Incluye como ATRASADOS todo lo planificado antes de esta fecha. Apagado: se planifica de esta fecha en adelante.">
              <input type="checkbox" checked={paraAtras} onChange={(e) => setParaAtras(e.target.checked)} className="accent-brand-500" />
              De esta fecha para atrás (incluir atrasados)
            </label>
            <label className="flex items-center gap-2 pb-1.5 text-xs text-slate-300" title="Descarta las órdenes con línea T, T1, T3, T4… (todo lo que empieza con T).">
              <input type="checkbox" checked={ignorarTradicional} onChange={(e) => setIgnorarTradicional(e.target.checked)} className="accent-brand-500" />
              Ignorar Tradicional (líneas T)
            </label>
            <button
              type="button"
              onClick={() => void pedidosQuery.refetch()}
              disabled={pedidosQuery.isFetching}
              className="mb-0.5 rounded border border-slate-700 px-2 py-1 text-xs text-slate-400 hover:border-slate-500 hover:text-slate-200 disabled:opacity-50"
            >
              {pedidosQuery.isFetching ? 'Leyendo…' : 'Releer órdenes'}
            </button>
          </div>

          {pedidosQuery.isLoading && <p className="text-xs text-slate-500">Leyendo las órdenes de fabricación desde Odoo…</p>}
          {pedidosQuery.isError && <p className="text-xs text-red-400">No se pudieron leer las órdenes de Odoo.</p>}

          {diasConPedidos.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
              <span>Días con órdenes:</span>
              {diasConPedidos.map(([f, n]) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFecha(f)}
                  className={`rounded border px-1.5 py-0.5 ${f === fecha ? 'border-brand-500 text-slate-100' : 'border-slate-700 hover:border-slate-500'}`}
                >
                  {f.split('-').reverse().slice(0, 2).join('/')} ({n})
                </button>
              ))}
            </div>
          )}

          {odoo && (
            <div className="grid grid-cols-3 gap-3 text-xs">
              <div className="rounded border border-slate-800 bg-slate-900/60 px-3 py-2">
                <div className="text-slate-500">Atrasados</div>
                <div className="text-base font-semibold text-slate-100">{odoo.conteos.atrasados}</div>
                <div className="text-[11px] text-slate-500">{paraAtras ? 'antes del día elegido' : 'no incluidos'}</div>
              </div>
              <div className="rounded border border-slate-800 bg-slate-900/60 px-3 py-2">
                <div className="text-slate-500">Día</div>
                <div className="text-base font-semibold text-slate-100">{odoo.conteos.dia}</div>
                <div className="text-[11px] text-slate-500">{fecha.split('-').reverse().join('/')}</div>
              </div>
              <div className="rounded border border-slate-800 bg-slate-900/60 px-3 py-2">
                <div className="text-slate-500">Día siguiente</div>
                <div className="text-base font-semibold text-slate-100">{odoo.conteos.siguiente}</div>
                <div className="text-[11px] text-slate-500">{odoo.fechaSiguiente.split('-').reverse().join('/')} (próximo hábil)</div>
              </div>
            </div>
          )}
          {odoo && ignorarTradicional && odoo.conteos.ignoradasTradicional > 0 && (
            <p className="text-[11px] text-slate-500">{odoo.conteos.ignoradasTradicional} órdenes de línea Tradicional (T…) ignoradas.</p>
          )}
          {!!pedidosQuery.data?.sinFecha && (
            <p className="text-[11px] text-slate-500">{pedidosQuery.data.sinFecha} órdenes sin fecha de planificación (01/01/2100) no se incluyen.</p>
          )}
        </div>
      )}

      {origen === 'archivos' && (
        <div className="flex flex-col gap-3">
          <div className="grid gap-3 md:grid-cols-3">
            {PLANILLAS.map((p) => (
              <CargaPlanilla
                key={p.clave}
                label={p.label}
                cargada={planillas[p.clave]}
                onCargar={(file) => cargar(p.clave, file)}
                onQuitar={() => setPlanillas((prev) => ({ ...prev, [p.clave]: null }))}
              />
            ))}
          </div>
          <label className="flex w-fit items-center gap-2 text-xs text-slate-300" title="Descarta las filas con línea T, T1, T3, T4… (todo lo que empieza con T).">
            <input type="checkbox" checked={ignorarTradicional} onChange={(e) => setIgnorarTradicional(e.target.checked)} className="accent-brand-500" />
            Ignorar Tradicional (líneas T)
          </label>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Operarios de armado
          <select
            value={operarios}
            onChange={(e) => setOperarios(Number(e.target.value))}
            className="rounded-md border border-slate-700 bg-slate-800/60 px-2 py-1.5 text-sm text-slate-100"
          >
            {[1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={!bases || !hayPlanilla}
          onClick={optimizar}
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Optimizar flujo
        </button>
        <button
          type="button"
          onClick={limpiar}
          disabled={origen === 'odoo' ? !resultado : !hayPlanilla && !resultado}
          className="rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:border-red-400 hover:text-red-300 disabled:opacity-40"
        >
          Limpiar planillas
        </button>
        {!hayPlanilla && <span className="pb-2 text-xs text-slate-500">{origen === 'odoo' ? 'No hay órdenes para el día elegido.' : 'Cargá al menos una planilla para optimizar.'}</span>}
      </div>

      {errorCalculo && <p className="rounded border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm text-red-300">{errorCalculo}</p>}

      {resultado && plan.length === 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-200">
          <p className="font-semibold">No se generó planificación.</p>
          <p className="mt-1 text-xs text-amber-200/80">Revisá que los nombres de producto coincidan con la base y que no tengan tiempo de CNC en cero.</p>
          {[...resultado.r.alertasPlanillas, ...resultado.r.bitacora].length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-xs">
              {[...resultado.r.alertasPlanillas, ...resultado.r.bitacora].slice(0, 12).map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {resultado && plan.length > 0 && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
              <div className="text-xs text-slate-500">Días de producción</div>
              <div className="text-lg font-semibold text-slate-100">{diasDelPlan(plan)}</div>
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
              <div className="text-xs text-slate-500">Fin del Tendido</div>
              <div className="text-lg font-semibold text-slate-100">{formatTablaH(resultado.r.tTendido)}</div>
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
              <div className="text-xs text-slate-500">Fin del CNC</div>
              <div className="text-lg font-semibold text-slate-100">{formatTablaH(resultado.r.tCnc)}</div>
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
              <div className="text-xs text-slate-500">Fin del Armado</div>
              <div className="text-lg font-semibold text-slate-100">{formatTablaH(Math.max(0, ...resultado.r.tArmadores))}</div>
            </div>
          </div>

          {resultado.r.alertasPlanillas.length > 0 && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-200">
              <p className="font-semibold">Productos de las planillas que no se pudieron planificar</p>
              <ul className="mt-1 list-disc pl-5">
                {[...new Set(resultado.r.alertasPlanillas)].map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex rounded-lg border border-slate-800 bg-slate-900/60 p-1">
              {(
                [
                  ['rutas', 'Hojas de ruta'],
                  ['gantt', 'Gantt'],
                  ['log', 'Log de planta'],
                ] as [Vista, string][]
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setVista(id)}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold ${vista === id ? 'bg-brand-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-2 text-xs text-slate-400">
              Filtrar modelo
              <select value={filtro} onChange={(e) => setFiltro(e.target.value)} className="max-w-[16rem] rounded-md border border-slate-700 bg-slate-800/60 px-2 py-1.5 text-sm text-slate-100">
                <option value="Todos">Todos</option>
                {modelos.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="flex flex-wrap gap-2">
            {(
              [
                ['H. Ruta Tendido', () => descargar(generarPdfRutas(plan, ['T'], filtro, resultado.fechaBase), 'Hoja_Ruta_T.pdf')],
                ['H. Ruta CNC', () => descargar(generarPdfRutas(plan, ['C'], filtro, resultado.fechaBase), 'Hoja_Ruta_C.pdf')],
                ['H. Ruta Armado', () => descargar(generarPdfRutas(plan, ['A'], filtro, resultado.fechaBase), 'Hoja_Ruta_A.pdf')],
                ['Gantt CNC', () => descargar(generarPdfGantt('Gantt de Ocupación Continua CNC (Tendido + Corte)', ['1. Tendido', '2. CNC'], ganttCnc.barras, ganttCnc.leyenda, maxT), 'Gantt_CNC.pdf')],
                ['Gantt Armado', () => descargar(generarPdfGantt(`Gantt de Planificación de Armado JIT (${resultado.operarios} Operarios)`, filasArmado, ganttArm.barras, ganttArm.leyenda, maxT), 'Gantt_Armado.pdf')],
                ['Descargar todo', () => descargar(generarPdfRutas(plan, PROCESOS, filtro, resultado.fechaBase), 'Orden_Completa_JIT.pdf')],
              ] as [string, () => void][]
            ).map(([label, accion]) => (
              <button
                key={label}
                type="button"
                onClick={accion}
                className="flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800/60 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:border-slate-500"
              >
                <DownloadIcon /> {label}
              </button>
            ))}
          </div>

          {vista === 'rutas' && (
            <div className="flex flex-col gap-6">
              {PROCESOS.map((p) => (
                <TablaRuta key={p} proceso={p} plan={plan} filtro={filtro} fechaBase={resultado.fechaBase} />
              ))}
            </div>
          )}

          {vista === 'gantt' && (
            <div className="flex flex-col gap-6">
              <TelamaxGantt titulo="Gantt de ocupación continua CNC (Tendido + Corte)" filas={['1. Tendido', '2. CNC']} barras={ganttCnc.barras} leyenda={ganttCnc.leyenda} maxT={maxT} />
              <TelamaxGantt titulo={`Gantt de planificación de Armado JIT (${resultado.operarios} operarios)`} filas={filasArmado} barras={ganttArm.barras} leyenda={ganttArm.leyenda} maxT={maxT} />
            </div>
          )}

          {vista === 'log' && (
            <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap rounded-lg border border-slate-800 bg-slate-900/60 p-4 text-xs leading-relaxed text-slate-200">
              {'====== LOG DE PLANTA: CONTROL DE OCIO Y DESBORDES ======\n\n'}
              {resultado.r.bitacora.length > 0 ? resultado.r.bitacora.join('\n') : 'Flujo continuo perfecto. Sin eventos de ocio ni desbordes detectados.'}
            </pre>
          )}
        </>
      )}
    </div>
  );
}

/** Entry point mounted as an Astro client island, same pattern as el resto de Producción. */
export default function TelamaxApp() {
  return (
    <QueryProvider>
      <TelamaxInner />
    </QueryProvider>
  );
}
