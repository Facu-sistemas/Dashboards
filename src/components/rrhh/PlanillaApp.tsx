import { Fragment, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import QueryProvider from '@/components/QueryProvider';
import { useApiQuery } from '@/components/dashboard/useApiQuery';
import LastUpdated from '@/components/shared/LastUpdated';
import { formatDias, formatFechaIso } from './format';
import { ThOrden, ordenarFilas, useOrden } from './ordenar';
import { ultimasQuincenas } from './quincena-utils';
import type { OrigenParametro, PlanillaRow, RrhhPlanillaResult } from '@/lib/rrhh-planilla';
import type { CampoParametro } from '@/lib/supabase/rrhh-planilla-parametros';

interface Props {
  /** Fecha de hoy (ISO) calculada en el servidor, para no depender de la zona horaria del navegador. */
  hoy: string;
  /** Si puede cargar los parámetros de la quincena y ajustar celdas (cuenta rrhh y dev). */
  puedeEditar?: boolean;
}

/** "8,8" / "8.8" -> 8.8; vacío -> null (borrar); inválido -> undefined. */
function leerNumero(txt: string): number | null | undefined {
  const t = txt.trim().replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

const fechaHora = (iso?: string) => (iso ? new Date(iso).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');

/** Texto del hover de una celda editable: de dónde sale el valor y qué calcula Odoo. */
function tituloOrigen(o: OrigenParametro, unidad: string, puedeEditar: boolean): string {
  const odoo = o.odoo === null ? '' : ` Odoo calcula ${formatDias(o.odoo)} ${unidad}.`;
  const base =
    o.fuente === 'persona'
      ? `Ajustado a mano para esta persona por ${o.por} (${fechaHora(o.en)}).${odoo}`
      : o.fuente === 'quincena'
        ? `Valor de la quincena (encabezado), cargado por ${o.por}.${odoo}`
        : `Calculado desde Odoo.`;
  return puedeEditar ? `${base} Hacé clic para cambiarlo${o.fuente === 'persona' ? '; dejalo vacío para volver al valor de la quincena' : ''}.` : base;
}

/** Celda de Total hs / Feriados / Viático: muestra el valor y, si se puede editar, al hacer clic se vuelve un campo. */
function CeldaEditable({
  valor,
  origen,
  unidad,
  puedeEditar,
  error,
  onGuardar,
}: {
  valor: number;
  origen: OrigenParametro;
  unidad: string;
  puedeEditar: boolean;
  error?: boolean;
  onGuardar: (valor: number | null) => Promise<void>;
}) {
  const [editando, setEditando] = useState(false);
  const [txt, setTxt] = useState('');
  const [guardando, setGuardando] = useState(false);
  const marca = origen.fuente === 'persona' ? 'font-semibold text-brand-400 underline decoration-dotted underline-offset-2' : '';
  const td = 'whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-slate-300';

  async function confirmar() {
    const n = leerNumero(txt);
    if (n === undefined) return setEditando(false);
    if (n !== null && origen.fuente === 'persona' && Math.abs(n - valor) < 0.001) return setEditando(false);
    setGuardando(true);
    try {
      await onGuardar(n);
    } finally {
      setGuardando(false);
      setEditando(false);
    }
  }

  if (editando) {
    return (
      <td className={td} onClick={(e) => e.stopPropagation()}>
        <input
          autoFocus
          type="text"
          inputMode="decimal"
          value={txt}
          disabled={guardando}
          onChange={(e) => setTxt(e.target.value)}
          onBlur={confirmar}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') setEditando(false);
          }}
          aria-label="Nuevo valor"
          className="w-16 rounded border border-brand-500 bg-slate-950 px-1 py-0.5 text-right text-slate-100 focus:outline-none"
        />
      </td>
    );
  }
  return (
    <td
      className={`${td} ${error ? 'text-rose-300' : ''} ${puedeEditar ? 'cursor-text hover:bg-slate-800/60' : ''}`}
      title={tituloOrigen(origen, unidad, puedeEditar)}
      onClick={(e) => {
        if (!puedeEditar) return;
        e.stopPropagation();
        setTxt(origen.fuente === 'persona' ? String(valor).replace('.', ',') : '');
        setEditando(true);
      }}
    >
      <span className={marca}>{valor === 0 ? '—' : formatDias(valor)}</span>
    </td>
  );
}

/** Parámetro de la quincena en el encabezado: vale para toda la columna; vacío = lo que calcula Odoo. */
function CampoQuincena({
  label,
  unidad,
  cargado,
  odoo,
  puedeEditar,
  disponible,
  onGuardar,
}: {
  label: string;
  unidad: string;
  cargado: { valor: number; por: string; en: string } | undefined;
  odoo: number;
  puedeEditar: boolean;
  disponible: boolean;
  onGuardar: (valor: number | null) => Promise<void>;
}) {
  const [txt, setTxt] = useState(cargado ? String(cargado.valor).replace('.', ',') : '');
  const [guardando, setGuardando] = useState(false);
  useEffect(() => setTxt(cargado ? String(cargado.valor).replace('.', ',') : ''), [cargado?.valor]);

  async function confirmar() {
    const n = leerNumero(txt);
    if (n === undefined || (n === null && !cargado) || (n !== null && cargado && Math.abs(n - cargado.valor) < 0.001)) return;
    setGuardando(true);
    try {
      await onGuardar(n);
    } finally {
      setGuardando(false);
    }
  }

  const ayuda = cargado
    ? `Cargado por ${cargado.por} (${fechaHora(cargado.en)}). Odoo calcula ${formatDias(odoo)} ${unidad}. Vale para toda la columna; las celdas ajustadas a mano le ganan. Borralo para volver al cálculo de Odoo.`
    : `Sin cargar: se usa lo que calcula Odoo (${formatDias(odoo)} ${unidad}). Lo que pongas acá vale para toda la columna; después podés ajustar cada celda.`;
  return (
    <label className="flex flex-col gap-1 text-sm text-slate-300" title={disponible ? ayuda : 'Falta crear la tabla rrhh_planilla_parametros en Supabase.'}>
      <span className="text-xs uppercase tracking-wide text-slate-500">{label}</span>
      <input
        type="text"
        inputMode="decimal"
        value={txt}
        placeholder={formatDias(odoo)}
        disabled={!puedeEditar || !disponible || guardando}
        onChange={(e) => setTxt(e.target.value)}
        onBlur={confirmar}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
        className={`w-28 text-right tabular-nums ${selectClass} placeholder:text-slate-500 ${cargado ? 'border-brand-500 font-semibold' : ''} disabled:opacity-60`}
      />
      <span className={`text-xs ${cargado ? 'text-brand-400' : 'text-slate-500'}`}>
        {cargado ? `Cargado · Odoo ${formatDias(odoo)} ${unidad}` : `Odoo: ${formatDias(odoo)} ${unidad}`}
      </span>
    </label>
  );
}

const MAX_DIAS = 93;

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

function PlanillaInner({ hoy, puedeEditar = false }: Props) {
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
  const [abierto, setAbierto] = useState<Set<string>>(new Set());
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

  // "Sincronizar con Odoo": vuelve a leer todo de Odoo en el momento, sin el cache corto del servidor. No escribe en Odoo.
  const queryClient = useQueryClient();
  const [sincronizando, setSincronizando] = useState(false);
  const [errorSync, setErrorSync] = useState<string | null>(null);
  async function sincronizar() {
    setSincronizando(true);
    setErrorSync(null);
    try {
      const res = await fetch(`/api/rrhh-planilla?desde=${desde}&hasta=${hasta}&refresh=1`, { headers: { Accept: 'application/json' } });
      if (!(res.headers.get('content-type') ?? '').includes('application/json')) throw new Error('La sesión venció: volvé a entrar.');
      const json = (await res.json()) as { ok: boolean; data?: RrhhPlanillaResult; error?: string };
      if (!res.ok || !json.ok || !json.data) throw new Error(json.error ?? 'No se pudo sincronizar con Odoo.');
      queryClient.setQueryData(['rrhh-planilla', desde, hasta], json.data);
    } catch (err) {
      setErrorSync(err instanceof Error ? err.message : 'No se pudo sincronizar con Odoo.');
    } finally {
      setSincronizando(false);
    }
  }

  // Parámetros de la quincena (encabezado, empleadoId 0) y ajustes por celda: se guardan en Supabase y se recalcula la Planilla.
  const [errorParametro, setErrorParametro] = useState<string | null>(null);
  async function guardarParametro(empleadoId: number, campo: CampoParametro, valor: number | null) {
    setErrorParametro(null);
    try {
      const res = await fetch('/api/rrhh-planilla-parametros', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ desde, hasta, empleadoId, campo, valor }),
      });
      if (!(res.headers.get('content-type') ?? '').includes('application/json')) throw new Error('La sesión venció: volvé a entrar.');
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!res.ok || !json.ok) throw new Error(json.error ?? 'No se pudo guardar.');
      await query.refetch();
    } catch (err) {
      setErrorParametro(err instanceof Error ? err.message : 'No se pudo guardar.');
    }
  }

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
      extrasBase: (r) => r.extrasBaseHs,
      normales: (r) => r.normalesHs,
      otras: (r) => r.otrasHs,
      sinGoce: (r) => r.sinGoceHs,
      presentismo: (r) => r.presentismo,
      viatico: (r) => r.viaticoDias,
      vacDias: (r) => r.diasVacaciones,
      bancoConsumido: (r) => r.bancoConsumidoHs,
      bancoAcreditado: (r) => r.bancoAcreditadoHs,
      obs: (r) => r.alertas.length,
      ...Object.fromEntries((data?.columnas ?? []).map((c) => [`inc:${c.key}`, (r: PlanillaRow) => r.incidencias[c.key] ?? 0])),
    });
  }, [allRows, convenio, soloAlertas, busqueda, orden, data]);

  const totalesFiltro = useMemo(() => {
    const t = { total: 0, feriados: 0, extras: 0, extrasBase: 0, normales: 0, otras: 0, sinGoce: 0, viatico: 0, vacDias: 0, bancoConsumido: 0, bancoAcreditado: 0, inc: {} as Record<string, number> };
    for (const r of rows) {
      t.total += r.totalHs;
      t.feriados += r.feriadosHs;
      t.extras += r.extrasHs;
      t.extrasBase += r.extrasBaseHs;
      t.normales += r.normalesHs;
      t.otras += r.otrasHs;
      t.sinGoce += r.sinGoceHs;
      t.viatico += r.viaticoDias ?? 0;
      t.vacDias += r.diasVacaciones;
      t.bancoConsumido += r.bancoConsumidoHs;
      t.bancoAcreditado += r.bancoAcreditadoHs;
      for (const [k, v] of Object.entries(r.incidencias)) t.inc[k] = (t.inc[k] ?? 0) + v;
    }
    return t;
  }, [rows]);

  function toggle(clave: string) {
    setAbierto((prev) => {
      const next = new Set(prev);
      if (next.has(clave)) next.delete(clave);
      else next.add(clave);
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
      'Horas extras base (fichadas)': r.extrasBaseHs,
      'Horas extras a pagar (aprobadas)': r.extrasHs,
      'Hs normales': r.normalesHs,
      ...Object.fromEntries(data.columnas.map((c) => [c.label, r.incidencias[c.key] ?? 0])),
      'Otras licencias': r.otrasHs,
      'Control dif. horas (sin goce)': r.sinGoceHs,
      Presentismo: r.presentismo ?? '',
      'Viático + refrigerio (días)': r.viaticoDias ?? 'NO',
      'Días hábiles de vacaciones (Odoo)': r.diasVacaciones,
      'Banco consumido (hs, informativo)': r.bancoConsumidoHs,
      'Banco acreditado (hs, informativo)': r.bancoAcreditadoHs,
      'En EXPORTA': r.enExporta ? 'SI' : 'NO',
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
      {errorSync && <p className="rounded border border-red-900 bg-red-950/50 p-3 text-sm text-red-300">{errorSync}</p>}
      {errorParametro && <p className="rounded border border-red-900 bg-red-950/50 p-3 text-sm text-red-300">{errorParametro}</p>}
      {puedeEditar && data && !data.parametros.disponible && (
        <p className="rounded border border-amber-900 bg-amber-950/40 p-3 text-sm text-amber-300">
          Los parámetros de la quincena todavía no se pueden guardar: falta crear la tabla <code>rrhh_planilla_parametros</code> en Supabase (el SQL está en{' '}
          <code>src/lib/supabase/rrhh-planilla-parametros.ts</code>). Mientras tanto se usan los valores de Odoo.
        </p>
      )}
      {query.isError && (
        <p className="rounded border border-red-900 bg-red-950/50 p-3 text-sm text-red-300">
          No se pudieron cargar los datos: {(query.error as Error).message}
        </p>
      )}

      <div className="rounded-lg border border-slate-800 bg-slate-900">
        {/* Filtros y acciones */}
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4 p-4">
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
                className={`w-48 placeholder:text-slate-600 ${selectClass}`}
              />
            </label>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={sincronizar}
              disabled={sincronizando || Boolean(rangoError)}
              title="Vuelve a leer todo de Odoo ahora (empleados, tipo de liquidación, convenio, licencias, fichadas y horas extra aprobadas), sin esperar al refresco automático. Usalo después de cambiar algo en Odoo. No escribe nada en Odoo."
              className="inline-flex items-center gap-1.5 rounded border border-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:border-brand-500 disabled:opacity-40"
            >
              <span aria-hidden className={sincronizando ? 'inline-block animate-spin' : 'inline-block'}>⟳</span>
              {sincronizando ? 'Sincronizando…' : 'Sincronizar con Odoo'}
            </button>
            <button
              type="button"
              onClick={() => setVistaPrevia(true)}
              disabled={!data}
              title="Muestra la planilla de cálculo completa y la solapa EXPORTA (legajo, código, valor), sin aplicar los filtros de pantalla, y desde ahí se descarga"
              className="rounded bg-brand-500 px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40"
            >
              Ver y descargar Excel
            </button>
          </div>
        </div>

        {/* Opciones de vista */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 pb-3 text-sm text-slate-300">
          <div className="flex flex-wrap items-center gap-5">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={soloAlertas} onChange={(e) => setSoloAlertas(e.target.checked)} />
              Solo con observaciones
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={todasLasColumnas} onChange={(e) => setTodasLasColumnas(e.target.checked)} />
              Todas las columnas
            </label>
          </div>
          <LastUpdated dataUpdatedAt={query.dataUpdatedAt} />
        </div>

        {/* Parámetros de la quincena */}
        {data && (
          <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-3 border-t border-slate-800 p-4" aria-label="Parámetros de la quincena">
            <div className="max-w-md">
              <p className="text-sm font-medium text-slate-200">Parámetros de la quincena</p>
              <p className="mt-0.5 text-xs text-slate-500">
                Valen para toda la columna. Vacío = lo que calcula Odoo.{puedeEditar ? ' Cada celda de la tabla se puede ajustar por persona.' : ''}
              </p>
            </div>
            <div className="flex flex-wrap items-start gap-4">
              {(
                [
                  ['totalHs', 'Total hs', 'hs'],
                  ['feriadosHs', 'Feriados', 'hs'],
                  ['viaticoDias', 'Viático', 'días'],
                ] as const
              ).map(([campo, label, unidad]) => (
                <CampoQuincena
                  key={`${desde}|${hasta}|${campo}`}
                  label={label}
                  unidad={unidad}
                  cargado={data.parametros.cargados[campo]}
                  odoo={data.parametros.odoo[campo]}
                  puedeEditar={puedeEditar}
                  disponible={data.parametros.disponible}
                  onGuardar={(valor) => guardarParametro(0, campo, valor)}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {query.isLoading ? (
        <div className="h-28 w-full animate-pulse-slow rounded-lg bg-slate-800/60" />
      ) : (
        data && (
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-6">
            <Kpi label="Empleados liquidados" value={String(data.totales.empleados)} hint="Activos en Odoo con legajo" />
            <Kpi
              label="Total hs"
              value={`${formatDias(Math.round(data.totales.totalHs))} hs`}
              hint={`${data.diasHabiles} días hábiles · ${data.feriados.length} feriado${data.feriados.length === 1 ? '' : 's'}`}
            />
            <Kpi label="Hs normales" value={`${formatDias(Math.round(data.totales.normalesHs))} hs`} hint="Jornada − feriados − incidencias" tone="text-emerald-400" />
            <Kpi label="Incidencias" value={`${formatDias(Math.round(data.totales.incidenciasHs))} hs`} hint="Licencias y vacaciones de Odoo" />
            <Kpi label="Horas extras a pagar" value={`${formatDias(data.totales.extrasHs)} hs`} hint={`Aprobadas en Odoo · fichadas: ${formatDias(data.totales.extrasBaseHs)} hs`} />
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
              ['extras', 'Extras (base y a pagar)'], ['normales', 'Hs normales'], ['inc', 'Incidencias (por tipo de licencia)'], ['otras', 'Otras lic.'],
              ['sinGoce', 'Dif. horas'], ['presentismo', 'Presentismo'], ['vacDias', 'Días vac.'], ['banco', 'Banco consumido / acreditado'], ['obs', 'Observaciones'],
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
                <>
                <ThOrden col="extrasBase" orden={orden} alternar={alternar} className={th} title="Horas extra según las fichadas de Odoo: por día hábil, lo que pasa de 30 min sobre la jornada (desde las 14:48 si entró a las 6:00), redondeado al cuarto de hora. No cuenta días con licencia ni con horas ya acreditadas al banco. Informativo: no se paga.">Extras base</ThOrden>
                <ThOrden col="extras" orden={orden} alternar={alternar} className={th} title="Horas extras a pagar: las que RRHH aprobó en Odoo como ausencia tipo «Horas extra» dentro de la quincena. Código 15 en EXPORTA.">Extras a pagar</ThOrden>
                </>
                )}
                {v('normales') && (
                <ThOrden col="normales" orden={orden} alternar={alternar} className={th} title="Total hs − feriados − incidencias − vacaciones − otras licencias − permisos sin goce. El banco de horas, compensatorios, tiempo personal pagado y horas extra de Odoo no se descuentan.">Hs normales</ThOrden>
                )}
                {v('inc') && columnas.map((c) => (
                  <ThOrden key={c.key} col={`inc:${c.key}`} orden={orden} alternar={alternar} className={th} title={`Horas de ausencia tipo «${c.label}» aprobadas en Odoo dentro de la quincena${c.key === 'vacaciones' ? ' (días hábiles completos × 8,80)' : ''}.${c.noExporta ? ` No va a EXPORTA: ${c.noExporta}.` : c.codigo === null ? ' Sin código en EXPORTA: hay que definirlo con RRHH.' : ' Código ' + c.codigo + ' en EXPORTA.'}`}>
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
                <ThOrden col="presentismo" orden={orden} alternar={alternar} className={th} title="SOIVA: 20 como máximo y siempre entero (los 5 restantes los agrega INFOCOR con el código 14); 20 − 3 por día de enfermedad, accidente o sin goce, redondeado (vacaciones no descuentan). Madereros: 10 con quita proporcional por faltas sin goce. Sale de las ausencias de Odoo; tardanzas y salidas anticipadas todavía no entran. Código 11 en EXPORTA. Pasá el mouse por cada valor para ver el cálculo.">Presentismo</ThOrden>
                )}
                <ThOrden col="viatico" orden={orden} alternar={alternar} className={th} title="Solo SOIVA: días de la quincena menos vacaciones y faltas sin goce (las carpetas médicas sí pagan). Tiene que dar días enteros: si da decimales es un error de clasificación, se marca en rojo y no se exporta. Código 40 en EXPORTA.">Viático</ThOrden>
                {v('vacDias') && (
                <ThOrden col="vacDias" orden={orden} alternar={alternar} className={th} title="Días hábiles de vacaciones gozados en la quincena y aprobados en Odoo (enteros, sin feriados). Vacaciones hábiles = días × 8,80. No va a EXPORTA: INFOCOR las carga por fechas. Los sábados y domingos los controla RRHH en Odoo.">Días vac.</ThOrden>
                )}
                {v('banco') && (
                <>
                <ThOrden col="bancoConsumido" orden={orden} alternar={alternar} className={th} title="Informativo, no se paga ni se suma: horas de banco usadas en la quincena (licencias de Banco de horas aprobadas en Odoo; un día completo cuenta 8,80).">Banco usado</ThOrden>
                <ThOrden col="bancoAcreditado" orden={orden} alternar={alternar} className={th} title="Informativo, no se paga ni se suma: horas que RRHH acreditó al banco en Odoo con fecha dentro de la quincena (incluye, por ejemplo, las 8,30 hs de un día de vacaciones cambiado por banco).">Banco acred.</ThOrden>
                </>
                )}
                {v('obs') && (
                <ThOrden col="obs" orden={orden} alternar={alternar} className="px-2 py-2 font-medium" title="Cantidad de observaciones de la fila.">Observaciones</ThOrden>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((r: PlanillaRow) => {
                const open = abierto.has(r.clave);
                const hayError = r.alertas.some((a) => a.nivel === 'error');
                return (
                  <Fragment key={r.clave}>
                    <tr onClick={() => toggle(r.clave)} className="cursor-pointer border-t border-slate-800 hover:bg-slate-900/60">
                      <td className="whitespace-nowrap px-2 py-1.5 tabular-nums text-slate-500">{r.legajo}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-slate-100">
                        {r.nombre}
                        <span className="block text-xs text-slate-500">
                          {r.centroCosto} · {r.tipoLiquidacion || 'sin tipo de liquidación'}
                          {!r.enExporta && (
                            <span title={r.motivoNoExporta ?? undefined} className="ml-1.5 rounded bg-slate-800 px-1 text-[10px] uppercase tracking-wide text-slate-400">
                              no va a EXPORTA
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-xs text-slate-400">{r.convenio}</td>
                      <CeldaEditable
                        valor={r.totalHs}
                        origen={r.origen.totalHs}
                        unidad="hs"
                        puedeEditar={puedeEditar && data!.parametros.disponible}
                        onGuardar={(valor) => guardarParametro(r.empleadoId, 'totalHs', valor)}
                      />
                      <CeldaEditable
                        valor={r.feriadosHs}
                        origen={r.origen.feriadosHs}
                        unidad="hs"
                        puedeEditar={puedeEditar && data!.parametros.disponible}
                        onGuardar={(valor) => guardarParametro(r.empleadoId, 'feriadosHs', valor)}
                      />
                      {v('extras') && (
                      <>
                      <td className={`${td} text-slate-500`}>{n2(r.extrasBaseHs)}</td>
                      <td className={`${td} ${r.extrasBaseHs - r.extrasHs > 0.1 ? 'text-amber-300' : ''}`}>{n2(r.extrasHs)}</td>
                      </>
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
                      {r.viaticoDias === null ? (
                        <td className={td} title="El viático y refrigerio solo corresponde al convenio SOIVA.">
                          —
                        </td>
                      ) : (
                        <CeldaEditable
                          valor={r.viaticoDias}
                          origen={r.origen.viaticoDias}
                          unidad="días"
                          puedeEditar={puedeEditar && data!.parametros.disponible}
                          error={Math.abs(r.viaticoDias - Math.round(r.viaticoDias)) >= 0.01}
                          onGuardar={(valor) => guardarParametro(r.empleadoId, 'viaticoDias', valor)}
                        />
                      )}
                      {v('vacDias') && (
                      <td className={`${td} ${Math.abs(r.diasVacaciones - Math.round(r.diasVacaciones)) >= 0.01 ? 'text-rose-300' : ''}`}>{n2(r.diasVacaciones)}</td>
                      )}
                      {v('banco') && (
                      <>
                      <td className={`${td} text-slate-500`}>{n2(r.bancoConsumidoHs)}</td>
                      <td className={`${td} text-slate-500`}>{n2(r.bancoAcreditadoHs)}</td>
                      </>
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
                <>
                <td className={th}>{formatDias(totalesFiltro.extrasBase)}</td>
                <td className={th}>{formatDias(totalesFiltro.extras)}</td>
                </>
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
                {v('vacDias') && (
                <td className={th}>{formatDias(totalesFiltro.vacDias)}</td>
                )}
                {v('banco') && (
                <>
                <td className={th}>{formatDias(totalesFiltro.bancoConsumido)}</td>
                <td className={th}>{formatDias(totalesFiltro.bancoAcreditado)}</td>
                </>
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

      {data && (!data.fuenteNomina.campoTipoEnOdoo || !data.fuenteNomina.campoConvenioEnOdoo || data.fuenteNomina.desdeGoogle > 0) && (
        <p className="rounded border border-amber-900 bg-amber-950/40 p-3 text-sm text-amber-300">
          {!data.fuenteNomina.campoTipoEnOdoo || !data.fuenteNomina.campoConvenioEnOdoo ? (
            <>
              Odoo todavía no tiene {[!data.fuenteNomina.campoTipoEnOdoo && '«Tipo de liquidación»', !data.fuenteNomina.campoConvenioEnOdoo && '«Convenio»'].filter(Boolean).join(' ni ')} en la
              ficha del empleado: {data.fuenteNomina.googleDisponible ? `para ${data.fuenteNomina.desdeGoogle} empleados se tomó de la hoja de nómina de Google.` : 'y la hoja de Google no se pudo leer, así que nadie entra a EXPORTA.'}{' '}
              Cuando se creen en Studio con esos nombres, el tablero los usa solo.
            </>
          ) : (
            <>Para {data.fuenteNomina.desdeGoogle} empleados el tipo de liquidación o el convenio está vacío en Odoo: se tomó de la hoja de Google (ver las observaciones de cada fila).</>
          )}
        </p>
      )}

      {data && data.sinLegajo.length > 0 && (
        <p className="rounded border border-slate-800 bg-slate-900 p-3 text-xs text-slate-400" title="Sin legajo (credencial) en Odoo no se pueden liquidar ni exportar. Cargalo en la ficha del empleado.">
          Activos en Odoo sin legajo (no se liquidan): {data.sinLegajo.join(', ')}.
        </p>
      )}

      {data && data.ignorados.length > 0 && (
        <p
          className="rounded border border-slate-800 bg-slate-900 p-3 text-xs text-slate-400"
          title="Se marcan como Ignorar en RRHH > Administración. No se liquidan ni entran a EXPORTA ni a los totales. Para liquidarlos, ponelos en Normal en esa pestaña."
        >
          Ignorados desde Administración (no se liquidan): {data.ignorados.map((p) => `${p.nombre} (${p.legajo})`).join(', ')}.
        </p>
      )}

      {data && data.sinOdoo.length > 0 && (
        <p
          className="rounded border border-slate-800 bg-slate-900 p-3 text-xs text-slate-400"
          title="La lista de la planilla sale de los empleados activos de Odoo. Estas personas siguen en la hoja de nómina de Google (PLANILLA DE CALCULO 2Q) pero ya no están activas en Odoo, por eso no se liquidan acá."
        >
          Fuera de la planilla (en la hoja de nómina pero no activos en Odoo): {data.sinOdoo.map((p) => `${p.nombre} (${p.legajo})`).join(', ')}.
        </p>
      )}

      {data && (
        <details className="rounded-lg border border-slate-800 bg-slate-900 p-4 text-sm text-slate-400">
          <summary className="cursor-pointer text-slate-300">Cómo se calcula cada columna</summary>
          <ul className="mt-3 list-disc space-y-1 pl-5">
            <li>
              <span className="text-slate-300">Total hs / Feriados / Viático:</span> si RRHH cargó el valor de la quincena arriba, vale para toda la columna; si una celda se ajustó
              a mano (en color y subrayada), esa le gana. Sin nada cargado: días hábiles del rango × 8,80 hs, y los feriados del calendario de la empresa en Odoo. Si feriados,
              licencias y sin goce pasan el total de la persona, la fila marca que no cuadra.
            </li>
            <li>
              <span className="text-slate-300">Incidencias y vacaciones:</span> licencias aprobadas en Odoo, recortadas al rango, a 8,80 hs por día (las cargadas por hora se respetan).
            </li>
            <li>
              <span className="text-slate-300">Hs normales:</span> total − feriados − incidencias − vacaciones − permisos sin pagar. Banco de horas, Días compensatorios y Tiempo personal pagado no
              se descuentan (la planilla suma el banco a las normales; los compensatorios hay que confirmarlos con RRHH).
            </li>
            <li>
              <span className="text-slate-300">Presentismo:</span> SOIVA 20 como máximo y entero (los 5 restantes los agrega INFOCOR con el código 14), o 20 − 3 por día de enfermedad, accidente o sin goce,
              redondeado (las vacaciones no descuentan); Madereros 10 con quita proporcional por faltas. Es una estimación: las tardanzas y salidas anticipadas todavía no entran.
            </li>
            <li>
              <span className="text-slate-300">Viático + refrigerio:</span> solo SOIVA. Total de días menos vacaciones y faltas injustificadas; enfermedad y ART sí pagan. Tiene que dar días
              enteros: con decimales se marca como error y no se exporta.
            </li>
            <li>
              <span className="text-slate-300">Vacaciones:</span> días hábiles (sin feriados) aprobados en Odoo que caen en la quincena, × 8,80. Si Odoo cuenta otra cantidad de días que el calendario, se
              avisa. Los sábados y domingos los controla RRHH a mano en Odoo.
            </li>
            <li>
              <span className="text-slate-300">Banco usado / acreditado:</span> informativos, no se pagan ni se suman. Usado = licencias de Banco de horas aprobadas; acreditado = asignaciones aprobadas con
              fecha en la quincena.
            </li>
            <li>
              <span className="text-slate-300">Horas extras:</span> la base sale de las fichadas de Odoo (lo que pasa de 30 min sobre la jornada, redondeado al cuarto de hora); se pagan solo las
              que RRHH aprueba en Odoo como ausencia tipo «Horas extra». Anticipos y guardería no entran al tablero.
            </li>
            <li>
              <span className="text-slate-300">Empleados, legajo y centro de costo:</span> los activos de Odoo. Tipo de liquidación y convenio: los campos de la ficha del empleado en Odoo; mientras no
              estén cargados, se toman de la hoja de nómina de Google.
            </li>
            <li>
              <span className="text-slate-300">EXPORTA:</span> legajo · código · valor, sin las filas en cero. Solo quincenales de SOIVA y Madereros (según la hoja de nómina). Las vacaciones no se
              exportan (INFOCOR las carga por fechas) y el feriado (código 5) lo pone INFOCOR. Bombero, Casamiento hijo y Día CCT no tienen código en la solapa EXPORTA.
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
export default function PlanillaApp({ hoy, puedeEditar }: Props) {
  return (
    <QueryProvider>
      <PlanillaInner hoy={hoy} puedeEditar={puedeEditar} />
    </QueryProvider>
  );
}
