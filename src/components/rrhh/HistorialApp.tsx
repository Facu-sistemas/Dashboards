import { useMemo, useState } from 'react';
import QueryProvider from '@/components/QueryProvider';
import { useApiQuery } from '@/components/dashboard/useApiQuery';
import LastUpdated from '@/components/shared/LastUpdated';
import { formatDias } from './format';
import { horasExtraCrudasHs } from '@/lib/rrhh-horas-extra';
import { exigirJson } from '@/lib/respuesta-no-json';
import type { ApiEnvelope } from '@/components/dashboard/types';
import type { RrhhBancoResult } from '@/lib/odoo/rrhh-banco';
import type { DiaHistorial, EmpleadoResumen, EstadoDia, RrhhHistorialResult } from '@/lib/odoo/rrhh-historial';
import type { NovedadTipo } from '@/lib/odoo/rrhh-novedades';

interface Props {
  /** Fecha de hoy (ISO) calculada en el servidor. */
  hoy: string;
  /** Empleado a abrir de entrada (viene del clic en su nombre en la bandeja de novedades). */
  empleadoInicial?: number | null;
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DIAS_CORTOS = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];

const hs = (v: number) => `${formatDias(v)} hs`;
const selectClass = 'rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-100 focus:border-brand-500 focus:outline-none';

// ── Meses ("YYYY-MM") ────────────────────────────────────────────────────────────────────────────────────────────────
function sumarMeses(mes: string, n: number): string {
  const [y, m] = mes.split('-').map(Number);
  const t = y! * 12 + (m! - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}
const inicioMes = (mes: string) => `${mes}-01`;
function finMes(mes: string): string {
  const [y, m] = mes.split('-').map(Number);
  return `${mes}-${String(new Date(Date.UTC(y!, m!, 0)).getUTCDate()).padStart(2, '0')}`;
}
const nombreMes = (mes: string) => `${MESES[Number(mes.slice(5)) - 1]} ${mes.slice(0, 4)}`;
/** Lunes = 0 … domingo = 6. */
function diaSemana(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return (new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay() + 6) % 7;
}

// ── Estilos por tipo de día ──────────────────────────────────────────────────────────────────────────────────────────
const TIPOS: { tipo: NovedadTipo; label: string; corto: string; badge: string }[] = [
  { tipo: 'horas-faltantes', label: 'Horas faltantes', corto: 'Faltantes', badge: 'bg-amber-950 text-amber-300' },
  { tipo: 'sin-fichada', label: 'Sin fichada', corto: 'Sin fichada', badge: 'bg-rose-950 text-rose-300' },
  { tipo: 'marca-incompleta', label: 'Marca incompleta', corto: 'Marca inc.', badge: 'bg-orange-950 text-orange-300' },
  { tipo: 'sin-salida', label: 'Sin salida', corto: 'Sin salida', badge: 'bg-fuchsia-950 text-fuchsia-300' },
  { tipo: 'horas-extra', label: 'Horas extra', corto: 'Extra', badge: 'bg-sky-950 text-sky-300' },
];

const ESTILO_DIA: Record<EstadoDia, { clase: string; label: string }> = {
  ok: { clase: 'border-emerald-900 bg-emerald-950/60 text-emerald-200', label: 'Jornada completa' },
  licencia: { clase: 'border-violet-900 bg-violet-950/60 text-violet-200', label: 'Licencia' },
  'horas-faltantes': { clase: 'border-amber-800 bg-amber-950 text-amber-200', label: 'Horas faltantes' },
  'sin-fichada': { clase: 'border-rose-800 bg-rose-950 text-rose-200', label: 'Sin fichada' },
  'marca-incompleta': { clase: 'border-orange-800 bg-orange-950 text-orange-200', label: 'Marca incompleta' },
  'sin-salida': { clase: 'border-fuchsia-800 bg-fuchsia-950 text-fuchsia-200', label: 'Sin salida' },
  'horas-extra': { clase: 'border-sky-800 bg-sky-950 text-sky-200', label: 'Horas extra' },
  'fin-de-semana': { clase: 'border-slate-800 bg-slate-900/40 text-slate-500', label: 'Fin de semana' },
  feriado: { clase: 'border-slate-700 bg-slate-800/60 text-slate-400', label: 'Feriado' },
  'sin-datos': { clase: 'border-slate-800 bg-transparent text-slate-600', label: 'Sin datos' },
  pendiente: { clase: 'border-slate-800 bg-transparent text-slate-500', label: 'Todavía no evaluado' },
};

function Kpi({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${tone ?? 'text-slate-100'}`}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

/** Totales de un conjunto de días de un empleado. */
function totalizar(dias: DiaHistorial[]) {
  const t = { trabajados: 0, fichadoHs: 0, licencia: 0, faltantes: 0, faltantesHs: 0, sinFichada: 0, sinFichadaHs: 0, marcaInc: 0, sinSalida: 0, extra: 0, extraHs: 0 };
  for (const d of dias) {
    if (d.marcas.length > 0) {
      t.trabajados += 1;
      t.fichadoHs += d.fichadoHs;
    }
    if (d.estado === 'licencia') t.licencia += 1;
    if (d.descartada) continue;
    if (d.estado === 'horas-faltantes') (t.faltantes += 1), (t.faltantesHs += d.horasAResolver);
    if (d.estado === 'sin-fichada') (t.sinFichada += 1), (t.sinFichadaHs += d.horasAResolver);
    if (d.estado === 'marca-incompleta') t.marcaInc += 1;
    if (d.estado === 'sin-salida') t.sinSalida += 1;
    if (d.estado === 'horas-extra') (t.extra += 1), (t.extraHs += d.horasAResolver);
  }
  return t;
}

// ── Excel del banco de horas ─────────────────────────────────────────────────────────────────────────────────────────
function BancoExcelCard({ hoy }: { hoy: string }) {
  const [desde, setDesde] = useState(`${sumarMeses(hoy.slice(0, 7), -11)}-01`);
  const [hasta, setHasta] = useState(hoy);
  const [ocultar, setOcultar] = useState(true);
  const [estado, setEstado] = useState<{ cargando: boolean; error: string | null }>({ cargando: false, error: null });

  const descargar = async () => {
    setEstado({ cargando: true, error: null });
    try {
      const res = await fetch(`/api/rrhh-banco?desde=${desde}&hasta=${hasta}`, { headers: { Accept: 'application/json' } });
      exigirJson(res);
      const body = (await res.json()) as ApiEnvelope<RrhhBancoResult>;
      if (!res.ok || !body.ok || !body.data) throw new Error(body.error ?? 'No se pudo leer el banco de horas');
      const { descargarExcelBanco } = await import('./banco-excel');
      await descargarExcelBanco(body.data, ocultar);
      setEstado({ cargando: false, error: null });
    } catch (e) {
      setEstado({ cargando: false, error: e instanceof Error ? e.message : 'Error desconocido' });
    }
  };

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-800 bg-slate-900 p-4 text-sm">
      <div className="mr-2 max-w-sm">
        <p className="font-medium text-slate-100">Banco de horas: movimientos en Excel</p>
        <p className="text-xs text-slate-500">Cada alta y cada uso del banco, con el saldo acumulado, resumen por mes y una hoja que explica cómo se usa.</p>
      </div>
      <label className="flex flex-col gap-1 text-slate-400">
        Desde
        <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className={selectClass} />
      </label>
      <label className="flex flex-col gap-1 text-slate-400">
        Hasta
        <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className={selectClass} />
      </label>
      <label className="flex items-center gap-2 pb-2 text-slate-300">
        <input type="checkbox" checked={ocultar} onChange={(e) => setOcultar(e.target.checked)} />
        Ocultar nombres (para compartir afuera)
      </label>
      <button
        type="button"
        disabled={estado.cargando || !desde || !hasta || hasta < desde}
        onClick={descargar}
        className="rounded border border-brand-500 px-3 py-1.5 text-slate-100 hover:bg-slate-800 disabled:opacity-40"
      >
        {estado.cargando ? 'Armando el Excel…' : 'Descargar Excel'}
      </button>
      {estado.error && <p className="w-full text-sm text-rose-300">{estado.error}</p>}
    </div>
  );
}

// ── Lista de todos los empleados ─────────────────────────────────────────────────────────────────────────────────────
type Filtro = '' | NovedadTipo | 'con-novedades' | 'sin-novedades';

function Lista({ hoy, mes, setMes, onAbrir }: { hoy: string; mes: string; setMes: (m: string) => void; onAbrir: (id: number) => void }) {
  const [filtro, setFiltro] = useState<Filtro>('');
  const [departamento, setDepartamento] = useState('');
  const [busqueda, setBusqueda] = useState('');

  const query = useApiQuery<RrhhHistorialResult>(['rrhh-historial', mes], `/api/rrhh-historial?desde=${inicioMes(mes)}&hasta=${finMes(mes)}`);
  const todos = query.data?.empleados ?? [];
  const mesActual = hoy.slice(0, 7);

  const departamentos = useMemo(() => [...new Set(todos.map((e) => e.departamento).filter((d): d is string => !!d))].sort(), [todos]);
  const base = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return todos.filter((e) => (!departamento || e.departamento === departamento) && (!q || e.empleado.toLowerCase().includes(q) || (e.legajo ?? '').includes(q)));
  }, [todos, departamento, busqueda]);

  const cumple = (e: EmpleadoResumen, f: Filtro) => (f === '' ? true : f === 'con-novedades' ? e.novedades > 0 : f === 'sin-novedades' ? e.novedades === 0 : e.porTipo[f] > 0);
  const filas = useMemo(() => {
    const f = base.filter((e) => cumple(e, filtro));
    // Al filtrar por un tipo, arriba los que más lo tienen.
    if (filtro && filtro !== 'con-novedades' && filtro !== 'sin-novedades') f.sort((a, b) => b.porTipo[filtro] - a.porTipo[filtro] || a.empleado.localeCompare(b.empleado, 'es'));
    else if (filtro === 'con-novedades') f.sort((a, b) => b.novedades - a.novedades || a.empleado.localeCompare(b.empleado, 'es'));
    return f;
  }, [base, filtro]);

  const chips: { id: Filtro; label: string; n: number; badge?: string }[] = [
    { id: '', label: 'Todos', n: base.length },
    { id: 'con-novedades', label: 'Con alguna novedad', n: base.filter((e) => cumple(e, 'con-novedades')).length },
    ...TIPOS.map((t) => ({ id: t.tipo as Filtro, label: t.label, n: base.filter((e) => cumple(e, t.tipo)).length, badge: t.badge })),
    { id: 'sin-novedades', label: 'Sin novedades', n: base.filter((e) => cumple(e, 'sin-novedades')).length },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-800 bg-slate-900 p-4 text-sm">
        <div className="flex items-center gap-1">
          <button type="button" aria-label="Mes anterior" onClick={() => setMes(sumarMeses(mes, -1))} className="rounded border border-slate-700 px-2.5 py-1.5 text-slate-300 hover:border-brand-500">
            ‹
          </button>
          <span className="min-w-[10rem] text-center text-base font-medium capitalize text-slate-100">{nombreMes(mes)}</span>
          <button type="button" aria-label="Mes siguiente" disabled={mes >= mesActual} onClick={() => setMes(sumarMeses(mes, 1))} className="rounded border border-slate-700 px-2.5 py-1.5 text-slate-300 hover:border-brand-500 disabled:opacity-30">
            ›
          </button>
          {mes !== mesActual && (
            <button type="button" onClick={() => setMes(mesActual)} className="ml-1 rounded border border-slate-700 px-2 py-1.5 text-xs text-slate-300 hover:border-brand-500">
              Este mes
            </button>
          )}
        </div>
        <label className="flex flex-col gap-1 text-slate-400">
          Departamento
          <select value={departamento} onChange={(e) => setDepartamento(e.target.value)} className={`w-44 max-w-full truncate ${selectClass}`}>
            <option value="">Todos</option>
            {departamentos.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-slate-400">
          Buscar
          <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Nombre o legajo" className={selectClass} />
        </label>
        {query.data && <LastUpdated dataUpdatedAt={query.dataUpdatedAt} />}
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar por anormalidad">
        {chips.map((c) => (
          <button
            key={c.id || 'todos'}
            type="button"
            aria-pressed={filtro === c.id}
            onClick={() => setFiltro(c.id)}
            className={`rounded-full border px-3 py-1 text-sm ${filtro === c.id ? 'border-brand-500 bg-slate-800 text-slate-100' : 'border-slate-700 text-slate-400 hover:text-slate-200'}`}
          >
            {c.label} <span className="text-xs text-slate-500">{c.n}</span>
          </button>
        ))}
      </div>

      {query.isLoading && <p className="text-sm text-slate-400">Cargando fichadas…</p>}
      {query.isError && <p className="rounded border border-rose-900 bg-rose-950 p-3 text-sm text-rose-300">No se pudo cargar: {(query.error as Error).message}</p>}

      {query.data && (
        <div className="overflow-x-auto rounded-lg border border-slate-800">
          <table className="w-full min-w-[56rem] text-left text-sm">
            <thead className="bg-slate-900 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2">Empleado</th>
                <th className="px-3 py-2 text-right">Días fichados</th>
                <th className="px-3 py-2 text-right">Hs fichadas</th>
                {TIPOS.map((t) => (
                  <th key={t.tipo} className="px-3 py-2 text-right">
                    {t.corto}
                  </th>
                ))}
                <th className="px-3 py-2 text-right">Días licencia</th>
                <th className="px-3 py-2 text-right">Banco hoy</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {filas.length === 0 && (
                <tr>
                  <td colSpan={9 + 0} className="px-3 py-6 text-center text-slate-500">
                    Ningún empleado cumple ese filtro en {nombreMes(mes)}.
                  </td>
                </tr>
              )}
              {filas.map((e) => (
                <tr key={e.empleadoId} className="cursor-pointer hover:bg-slate-900" onClick={() => onAbrir(e.empleadoId)}>
                  <td className="px-3 py-2">
                    <button type="button" className="text-left text-slate-100 hover:text-brand-400" onClick={() => onAbrir(e.empleadoId)}>
                      {e.empleado}
                    </button>
                    <div className="text-xs text-slate-500">{e.departamento ?? '—'}</div>
                  </td>
                  <td className="px-3 py-2 text-right text-slate-300">{e.diasTrabajados}</td>
                  <td className="px-3 py-2 text-right text-slate-300">{formatDias(e.fichadoHs)}</td>
                  {TIPOS.map((t) => (
                    <td key={t.tipo} className="px-3 py-2 text-right">
                      {e.porTipo[t.tipo] > 0 ? <span className={`inline-block min-w-[1.5rem] rounded px-1.5 py-0.5 text-center text-xs ${t.badge}`}>{e.porTipo[t.tipo]}</span> : <span className="text-slate-700">—</span>}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-right text-slate-300">{e.diasLicencia || <span className="text-slate-700">—</span>}</td>
                  <td className={`px-3 py-2 text-right ${e.saldoBanco < 0 ? 'text-rose-300' : 'text-slate-300'}`}>{hs(e.saldoBanco)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-slate-500">
        Se evalúan los días hábiles hasta ayer, con las mismas reglas que la bandeja de novedades (jornada de 8,3 hs, tolerancia de 15 min). Las novedades que RRHH
        descartó no cuentan. Tocá un empleado para ver su calendario. Solo lectura.
      </p>
      <BancoExcelCard hoy={hoy} />
    </div>
  );
}

// ── Calendario de un empleado ────────────────────────────────────────────────────────────────────────────────────────
function Detalle({ hoy, empleadoId, mes, setMes, onVolver }: { hoy: string; empleadoId: number; mes: string; setMes: (m: string) => void; onVolver: () => void }) {
  // Se baja una ventana de 12 meses; mientras se navegue dentro de ella no hay que volver a pedir nada.
  const [ancla, setAncla] = useState(hoy.slice(0, 7));
  const ventanaIni = sumarMeses(ancla, -11);
  const mesActual = hoy.slice(0, 7);
  const [diaSel, setDiaSel] = useState<string | null>(null);

  const irA = (m: string) => {
    if (m > mesActual) return;
    if (m < ventanaIni || m > ancla) setAncla(m);
    setMes(m);
    setDiaSel(null);
  };

  const query = useApiQuery<RrhhHistorialResult>(
    ['rrhh-historial-detalle', empleadoId, ancla],
    `/api/rrhh-historial?desde=${inicioMes(ventanaIni)}&hasta=${finMes(ancla)}&empleadoId=${empleadoId}`,
  );
  const data = query.data;
  const resumen = data?.empleados.find((e) => e.empleadoId === empleadoId);
  const dias = data?.detalle?.dias ?? [];
  const porFecha = useMemo(() => new Map(dias.map((d) => [d.fecha, d])), [dias]);
  const delMes = useMemo(() => dias.filter((d) => d.fecha.startsWith(mes)), [dias, mes]);
  const tm = totalizar(delMes);

  const meses = useMemo(() => Array.from({ length: 12 }, (_, i) => sumarMeses(ancla, -i)), [ancla]);

  const celdas: (string | null)[] = [];
  for (let i = 0; i < diaSemana(inicioMes(mes)); i++) celdas.push(null);
  for (let d = inicioMes(mes); d <= finMes(mes); d = `${mes}-${String(Number(d.slice(8)) + 1).padStart(2, '0')}`) celdas.push(d);

  const sel = diaSel ? porFecha.get(diaSel) : null;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={onVolver} className="rounded border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:border-brand-500">
          ← Todos los empleados
        </button>
        <div>
          <h2 className="text-lg font-semibold text-slate-100">{resumen?.empleado ?? 'Cargando…'}</h2>
          {resumen && (
            <p className="text-xs text-slate-500">
              {resumen.departamento ?? '—'}
              {resumen.legajo ? ` · legajo ${resumen.legajo}` : ''} · banco de horas hoy: {hs(resumen.saldoBanco)}
            </p>
          )}
        </div>
      </div>

      {query.isLoading && <p className="text-sm text-slate-400">Cargando fichadas…</p>}
      {query.isError && <p className="rounded border border-rose-900 bg-rose-950 p-3 text-sm text-rose-300">No se pudo cargar: {(query.error as Error).message}</p>}

      {data && (
        <>
          <div className="flex items-center gap-1">
            <button type="button" aria-label="Mes anterior" onClick={() => irA(sumarMeses(mes, -1))} className="rounded border border-slate-700 px-2.5 py-1.5 text-slate-300 hover:border-brand-500">
              ‹
            </button>
            <span className="min-w-[10rem] text-center text-base font-medium capitalize text-slate-100">{nombreMes(mes)}</span>
            <button type="button" aria-label="Mes siguiente" disabled={mes >= mesActual} onClick={() => irA(sumarMeses(mes, 1))} className="rounded border border-slate-700 px-2.5 py-1.5 text-slate-300 hover:border-brand-500 disabled:opacity-30">
              ›
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Kpi label="Días fichados" value={String(tm.trabajados)} hint={`${hs(tm.fichadoHs)} en el mes`} />
            <Kpi label="Horas faltantes" value={String(tm.faltantes)} hint={tm.faltantes ? `${hs(tm.faltantesHs)} en total` : 'días'} tone={tm.faltantes ? 'text-amber-300' : undefined} />
            <Kpi label="Sin fichada" value={String(tm.sinFichada)} hint="días" tone={tm.sinFichada ? 'text-rose-300' : undefined} />
            <Kpi label="Marcas incompletas" value={String(tm.marcaInc + tm.sinSalida)} hint={`${tm.marcaInc} incompletas · ${tm.sinSalida} sin salida`} tone={tm.marcaInc + tm.sinSalida ? 'text-orange-300' : undefined} />
            <Kpi label="Horas extra" value={String(tm.extra)} hint={tm.extra ? `${hs(tm.extraHs)} de más` : 'días'} tone={tm.extra ? 'text-sky-300' : undefined} />
            <Kpi label="Días de licencia" value={String(tm.licencia)} hint="cubiertos enteros" tone={tm.licencia ? 'text-violet-300' : undefined} />
          </div>

          <div className="rounded-lg border border-slate-800 bg-slate-900 p-3">
            <div className="grid grid-cols-7 gap-1.5 text-center text-xs uppercase tracking-wide text-slate-500">
              {DIAS_CORTOS.map((d) => (
                <div key={d}>{d}</div>
              ))}
            </div>
            <div className="mt-1.5 grid grid-cols-7 gap-1.5">
              {celdas.map((f, i) => {
                if (!f) return <div key={`v${i}`} />;
                const d = porFecha.get(f);
                const estado: EstadoDia = d?.estado ?? 'sin-datos';
                const st = ESTILO_DIA[estado];
                const texto = d && d.marcas.length > 0 ? `${d.entrada ?? '—'}–${d.salida ?? '?'}` : estado === 'licencia' ? (d?.licencias[0]?.tipo ?? 'Licencia') : estado === 'feriado' ? 'Feriado' : '';
                return (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setDiaSel(f === diaSel ? null : f)}
                    title={`${st.label}${d?.descartada ? ' (descartada por RRHH)' : ''}`}
                    className={`flex min-h-[4.5rem] flex-col items-start rounded border p-1.5 text-left text-xs ${st.clase} ${d?.descartada ? 'opacity-60' : ''} ${f === diaSel ? 'ring-2 ring-brand-500' : ''} ${f === hoy ? 'outline outline-1 outline-slate-400' : ''}`}
                  >
                    <span className="text-sm font-medium">{Number(f.slice(8))}</span>
                    <span className="mt-auto leading-tight">{texto}</span>
                    {d && d.fichadoHs > 0 && <span className="leading-tight opacity-80">{formatDias(d.fichadoHs)} hs</span>}
                  </button>
                );
              })}
            </div>
            <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-400">
              {(['ok', 'horas-faltantes', 'sin-fichada', 'marca-incompleta', 'sin-salida', 'horas-extra', 'licencia', 'feriado', 'fin-de-semana'] as EstadoDia[]).map((e) => (
                <span key={e} className="flex items-center gap-1">
                  <span className={`inline-block h-3 w-3 rounded border ${ESTILO_DIA[e].clase}`} /> {ESTILO_DIA[e].label}
                </span>
              ))}
            </div>
          </div>

          {sel && (
            <div className="rounded-lg border border-slate-800 bg-slate-900 p-4 text-sm">
              <p className="font-medium text-slate-100">
                {sel.fecha.split('-').reverse().join('/')} · {ESTILO_DIA[sel.estado].label}
                {sel.descartada && <span className="ml-2 text-xs text-slate-500">(descartada por RRHH)</span>}
              </p>
              {sel.horasAResolver > 0 && <p className="mt-1 text-slate-300">{sel.estado === 'horas-extra' ? 'Sobran' : 'Faltan'} {hs(sel.horasAResolver)}{sel.estado === 'horas-extra' && Math.round(horasExtraCrudasHs(sel.fichadoHs, sel.salida) * 60) !== Math.round(sel.horasAResolver * 60) ? ` (exacto desde las 14:18: ${Math.round(horasExtraCrudasHs(sel.fichadoHs, sel.salida) * 60)} min)` : ''}.</p>}
              <div className="mt-2 grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">Fichadas</p>
                  {sel.marcas.length === 0 ? (
                    <p className="text-slate-500">No fichó.</p>
                  ) : (
                    <ul className="text-slate-300">
                      {sel.marcas.map((m, i) => (
                        <li key={i}>
                          {m.entrada} → {m.salida ?? 'sin salida'} {m.salida ? `(${hs(m.horas)})` : ''}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">Licencias en Odoo</p>
                  {sel.licencias.length === 0 ? (
                    <p className="text-slate-500">Ninguna.</p>
                  ) : (
                    <ul className="text-slate-300">
                      {sel.licencias.map((l) => (
                        <li key={l.id} className={l.estado === 'validate' ? '' : 'text-amber-300'}>
                          {l.tipo} · {hs(l.horas)} {l.estado === 'validate' ? '' : '(sin aprobar)'}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="overflow-x-auto rounded-lg border border-slate-800">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <thead className="bg-slate-900 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2">Mes</th>
                  <th className="px-3 py-2 text-right">Días fichados</th>
                  <th className="px-3 py-2 text-right">Hs fichadas</th>
                  {TIPOS.map((t) => (
                    <th key={t.tipo} className="px-3 py-2 text-right">
                      {t.corto}
                    </th>
                  ))}
                  <th className="px-3 py-2 text-right">Licencia</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {meses.map((m) => {
                  const t = totalizar(dias.filter((d) => d.fecha.startsWith(m)));
                  const cuentas: Record<NovedadTipo, number> = { 'horas-faltantes': t.faltantes, 'sin-fichada': t.sinFichada, 'marca-incompleta': t.marcaInc, 'sin-salida': t.sinSalida, 'horas-extra': t.extra };
                  return (
                    <tr key={m} className={`cursor-pointer hover:bg-slate-900 ${m === mes ? 'bg-slate-900' : ''}`} onClick={() => irA(m)}>
                      <td className="px-3 py-2 capitalize text-slate-200">{nombreMes(m)}</td>
                      <td className="px-3 py-2 text-right text-slate-300">{t.trabajados}</td>
                      <td className="px-3 py-2 text-right text-slate-300">{formatDias(t.fichadoHs)}</td>
                      {TIPOS.map((x) => (
                        <td key={x.tipo} className="px-3 py-2 text-right">
                          {cuentas[x.tipo] > 0 ? <span className={`inline-block min-w-[1.5rem] rounded px-1.5 py-0.5 text-center text-xs ${x.badge}`}>{cuentas[x.tipo]}</span> : <span className="text-slate-700">—</span>}
                        </td>
                      ))}
                      <td className="px-3 py-2 text-right text-slate-300">{t.licencia || <span className="text-slate-700">—</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function HistorialInner({ hoy, empleadoInicial }: Props) {
  const [mes, setMes] = useState(hoy.slice(0, 7));
  const [empleadoId, setEmpleadoId] = useState<number | null>(empleadoInicial ?? null);

  return empleadoId ? (
    <Detalle hoy={hoy} empleadoId={empleadoId} mes={mes} setMes={setMes} onVolver={() => setEmpleadoId(null)} />
  ) : (
    <Lista hoy={hoy} mes={mes} setMes={setMes} onAbrir={setEmpleadoId} />
  );
}

/** Entry point mounted as an Astro client island, same pattern as the other tabs. */
export default function HistorialApp(props: Props) {
  return (
    <QueryProvider>
      <HistorialInner {...props} />
    </QueryProvider>
  );
}
