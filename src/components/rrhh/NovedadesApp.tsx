import { Fragment, useMemo, useState } from 'react';
import QueryProvider from '@/components/QueryProvider';
import { MAX_HORAS_AUSENCIA, MAX_HORAS_EXTRA, TIPOS_AUSENCIA_CARGABLES, TIPOS_AUSENCIA_DIA_COMPLETO } from '@/lib/rrhh-novedades-tipos';
import { useApiQuery } from '@/components/dashboard/useApiQuery';
import LastUpdated from '@/components/shared/LastUpdated';
import { formatDias, formatFechaIso } from './format';
import { ultimasQuincenas } from './quincena-utils';
import type { NovedadRow, NovedadTipo, RrhhNovedadesResult } from '@/lib/odoo/rrhh-novedades';
import type { EmpleadoResumen, EstadoDia, RrhhHistorialResult } from '@/lib/odoo/rrhh-historial';

interface Props {
  /** Fecha de hoy (ISO) calculada en el servidor, para no depender de la zona horaria del navegador. */
  hoy: string;
  /** Período elegido en la otra vista de Horas (si lo tocaron): se hereda para no tener que volver a elegirlo. */
  rangoInicial?: { desde: string; hasta: string } | null;
  /** Avisa cuando el usuario cambia el período, para compartirlo con la otra vista. */
  onRango?: (rango: { desde: string; hasta: string }) => void;
  /** Dev y cuenta rrhh: pueden clasificar una novedad y cargarla (aprobada) en Odoo. El servidor lo vuelve a controlar. */
  puedeCargar?: boolean;
  /** Abre el historial de fichadas del empleado (clic en su nombre). */
  onVerHistorial?: (empleadoId: number) => void;
}

/** Qué se hace en Odoo con cada tipo de novedad (siempre con el visto bueno de RRHH, desde la fila). */
type Modo = 'cargar' | 'dia' | 'banco' | 'fichada' | 'nueva-fichada' | 'descartar';
const ACCION_POR_TIPO: Record<NovedadTipo, { modo: Exclude<Modo, 'descartar'>; boton: string }> = {
  'horas-faltantes': { modo: 'cargar', boton: 'Clasificar' },
  'sin-fichada': { modo: 'dia', boton: 'Cargar día' },
  'horas-extra': { modo: 'banco', boton: 'Acreditar al banco' },
  'marca-incompleta': { modo: 'fichada', boton: 'Corregir fichada' },
  'sin-salida': { modo: 'fichada', boton: 'Corregir fichada' },
};

/** Segunda acción posible en algunas novedades: un "sin fichada" puede ser que trabajó y no fichó, así que además de la ausencia se puede cargar la fichada. */
const ACCION_EXTRA: Partial<Record<NovedadTipo, { modo: 'nueva-fichada'; boton: string }>> = {
  'sin-fichada': { modo: 'nueva-fichada', boton: 'Cargar fichada' },
};

const horasComa = (v: number) => String(v).replace('.', ',');

const MAX_DIAS = 93;

const hs = (v: number) => `${formatDias(v)} hs`;

/** Las horas extra se redondean al cuarto de hora; si el tiempo exacto es otro, lo devuelve ("59 min") para mostrarlo entre paréntesis. */
function exactoExtra(fichadoHs: number, jornadaHs: number, redondeadaHs: number): string | null {
  const min = Math.round((fichadoHs - jornadaHs) * 60);
  if (min === Math.round(redondeadaHs * 60)) return null;
  return min >= 60 ? `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ''}` : `${min} min`;
}

const selectClass =
  'rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-100 focus:border-brand-500 focus:outline-none';

const TIPOS: { tipo: NovedadTipo; label: string; ayuda: string; badge: string; acento: string }[] = [
  {
    tipo: 'horas-faltantes',
    label: 'Horas faltantes',
    ayuda: 'Trabajó menos que la jornada y no hay una licencia aprobada que cubra la diferencia (se fue antes, llegó tarde…).',
    badge: 'bg-amber-950 text-amber-300',
    acento: 'bg-amber-500',
  },
  {
    tipo: 'sin-fichada',
    label: 'Sin fichada',
    ayuda: 'No fichó en todo el día y no tiene una licencia aprobada que lo cubra.',
    badge: 'bg-rose-950 text-rose-300',
    acento: 'bg-rose-500',
  },
  {
    tipo: 'marca-incompleta',
    label: 'Marca incompleta',
    ayuda: 'Solo hay una marca de un minuto (entrada y salida casi iguales): se olvidó de fichar al entrar o al salir.',
    badge: 'bg-orange-950 text-orange-300',
    acento: 'bg-orange-500',
  },
  {
    tipo: 'sin-salida',
    label: 'Sin salida',
    ayuda: 'Fichó la entrada y no fichó la salida.',
    badge: 'bg-fuchsia-950 text-fuchsia-300',
    acento: 'bg-fuchsia-500',
  },
  {
    tipo: 'horas-extra',
    label: 'Horas extra',
    ayuda: 'Trabajó más de una hora por encima de la jornada fichada (después de las 15:20 aprox.).',
    badge: 'bg-sky-950 text-sky-300',
    acento: 'bg-sky-500',
  },
];

/** Etiqueta de los empleados que figuran en la tabla sin novedad pendiente. */
const BADGE_SIN: Partial<Record<EstadoDia, { label: string; clase: string; ayuda: string }>> & { ok: { label: string; clase: string; ayuda: string } } = {
  ok: { label: 'Sin novedad', clase: 'bg-emerald-950 text-emerald-300', ayuda: 'Cumplió la jornada.' },
  licencia: { label: 'Licencia', clase: 'bg-violet-950 text-violet-300', ayuda: 'Cubierto por una licencia aprobada en Odoo.' },
  'sin-datos': { label: 'Sin fichadas', clase: 'bg-slate-800 text-slate-400', ayuda: 'No tiene fichadas en el período (no usa el kiosco todavía o es nuevo): no se puede evaluar.' },
};
const ESTADO_LABEL: Record<string, string> = { confirm: 'sin aprobar', validate1: 'falta 2ª aprobación', validate: 'aprobada' };

const DIAS_SEMANA = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

/** "YYYY-MM-DD" -> "vie 13/11", sin pasar por la zona horaria del navegador. */
function fechaCorta(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dow = new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay();
  return `${DIAS_SEMANA[dow]} ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`;
}

function Kpi({ label, value, hint, acento, title, onClick, activo }: { label: string; value: string; hint?: string; acento: string; title?: string; onClick?: () => void; activo?: boolean }) {
  // Un cero no llama la atención: la tarjeta se ve atenuada (sigue siendo clickeable).
  const vacio = value === '0';
  const contenido = (
    <>
      <span className={`absolute inset-y-0 left-0 w-1 ${acento}`} aria-hidden />
      <p className="flex min-h-[2rem] items-start text-[11px] font-semibold uppercase leading-tight tracking-wide text-slate-400">{label}</p>
      <p className={`mt-1 text-3xl font-semibold leading-none tabular-nums ${vacio ? 'text-slate-500' : 'text-slate-100'}`}>{value}</p>
      <p className="mt-1.5 min-h-[1rem] truncate text-xs text-slate-500">{hint ?? ''}</p>
    </>
  );
  const base = `relative overflow-hidden rounded-lg border p-3 pl-4 text-left transition ${
    activo ? 'border-brand-500 bg-slate-800 shadow-sm ring-1 ring-brand-500' : 'border-slate-800 bg-slate-900'
  } ${vacio && !activo ? 'opacity-60' : ''}`;
  return onClick ? (
    <button type="button" title={title} aria-pressed={activo} onClick={onClick} className={`${base} hover:border-brand-500 hover:opacity-100`}>
      {contenido}
    </button>
  ) : (
    <div title={title} className={base}>
      {contenido}
    </div>
  );
}

function TipoBadge({ tipo }: { tipo: NovedadTipo }) {
  const t = TIPOS.find((x) => x.tipo === tipo)!;
  return (
    <span title={t.ayuda} className={`inline-block whitespace-nowrap rounded px-1.5 py-0.5 text-xs ${t.badge}`}>
      {t.label}
    </span>
  );
}

function YaCargado({ row }: { row: NovedadRow }) {
  if (row.licencias.length === 0) return <span className="text-slate-600">—</span>;
  return (
    <ul className="flex flex-col gap-0.5">
      {row.licencias.map((l) => (
        <li key={l.id} className={l.estado === 'validate' ? 'text-slate-300' : 'text-amber-300'}>
          {l.tipo} {hs(l.horas)}
          <span className="text-slate-500"> · {ESTADO_LABEL[l.estado]}</span>
        </li>
      ))}
    </ul>
  );
}

function NovedadesInner({ hoy, rangoInicial, onRango, puedeCargar, onVerHistorial }: Props) {
  // Arranca en la quincena anterior y llega hasta hoy: así incluye lo que RRHH todavía puede estar cerrando y nunca queda en
  // un solo día (el primer día de una quincena el rango sería solo "hoy", que no se evalúa).
  const inicial = useMemo(() => ultimasQuincenas(hoy, 2)[1]!, [hoy]);
  const [desde, setDesdeState] = useState(rangoInicial?.desde ?? inicial.desde);
  const [hasta, setHastaState] = useState(rangoInicial?.hasta ?? hoy);
  const setDesde = (v: string) => {
    setDesdeState(v);
    onRango?.({ desde: v, hasta });
  };
  const setHasta = (v: string) => {
    setHastaState(v);
    onRango?.({ desde, hasta: v });
  };
  const rangoDias = desde && hasta ? Math.round((Date.parse(hasta) - Date.parse(desde)) / 86_400_000) + 1 : 0;
  const rangoError =
    !desde || !hasta
      ? 'Elegí las dos fechas.'
      : hasta < desde
        ? 'La fecha "hasta" es anterior a "desde".'
        : rangoDias > MAX_DIAS
          ? `El rango no puede superar ${MAX_DIAS} días.`
          : null;

  // '' = todos los empleados del día; 'con' = solo los que tienen alguna novedad; 'sin' = solo los que no; o un tipo puntual.
  const [tipo, setTipo] = useState<NovedadTipo | '' | 'con' | 'sin'>('');
  const [departamento, setDepartamento] = useState('');
  const [busqueda, setBusqueda] = useState('');

  const query = useApiQuery<RrhhNovedadesResult>(['rrhh-novedades', desde, hasta], `/api/rrhh-novedades?desde=${desde}&hasta=${hasta}`, {
    enabled: !rangoError,
  });
  const data = query.data;
  // Las descartadas por RRHH vienen marcadas: se ocultan salvo que pidan verlas (para restaurarlas).
  const [verDescartadas, setVerDescartadas] = useState(false);
  const todasLasRows = data?.rows ?? [];
  const cantDescartadas = todasLasRows.filter((r) => r.descartada).length;
  const allRows = verDescartadas ? todasLasRows : todasLasRows.filter((r) => !r.descartada);

  // Carga en Odoo: una sola fila abierta a la vez, con su formulario.
  const [abierta, setAbierta] = useState<string | null>(null);
  const [modo, setModo] = useState<Modo>('cargar');
  const [form, setForm] = useState({ tipoId: 6, horas: '', nota: '', entrada: '', salida: '' });
  const [enviando, setEnviando] = useState(false);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [resultado, setResultado] = useState<{ ok: boolean; texto: string } | null>(null);

  function abrir(r: NovedadRow, nuevoModo: Modo) {
    setAbierta(r.clave);
    setModo(nuevoModo);
    const maxHoras = nuevoModo === 'banco' ? MAX_HORAS_EXTRA : MAX_HORAS_AUSENCIA;
    setForm({
      // Banco de horas para lo que falta; Permisos sin pagar para un día sin fichada (la falta injustificada que cuenta en el ausentismo).
      tipoId: nuevoModo === 'dia' ? 4 : 6,
      horas: r.horasAResolver > 0 ? horasComa(Math.min(r.horasAResolver, maxHoras)) : '',
      nota: '',
      // En una marca incompleta la hora que se ve es la de la única marca: RRHH corrige la que falta.
      // Jornada habitual (6:00 a 14:18) como punto de partida para una fichada nueva; RRHH la ajusta.
      entrada: nuevoModo === 'nueva-fichada' ? '06:00' : r.tipo === 'sin-salida' ? (r.entrada ?? '') : '',
      salida: nuevoModo === 'nueva-fichada' ? '14:18' : '',
    });
    setErrorCarga(null);
  }

  /** Descartar y restaurar solo guardan la decisión en Supabase: no tocan Odoo. */
  async function descartar(r: NovedadRow) {
    setEnviando(true);
    setErrorCarga(null);
    try {
      const res = await fetch('/api/rrhh-novedades-descartar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ empleadoId: r.empleadoId, fecha: r.fecha, tipo: r.tipo, motivo: form.nota.trim() || undefined }),
      });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!json.ok) throw new Error(json.error ?? 'No se pudo descartar la novedad.');
      setResultado({ ok: true, texto: `Descartada: ${r.empleado}, ${fechaCorta(r.fecha)}. Podés verla de nuevo con "Ver descartadas".` });
      setAbierta(null);
      await query.refetch();
    } catch (err) {
      setErrorCarga(err instanceof Error ? err.message : 'No se pudo descartar la novedad.');
    } finally {
      setEnviando(false);
    }
  }

  async function restaurar(r: NovedadRow) {
    setEnviando(true);
    try {
      const res = await fetch('/api/rrhh-novedades-descartar', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clave: r.clave }),
      });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!json.ok) throw new Error(json.error ?? 'No se pudo restaurar la novedad.');
      setResultado({ ok: true, texto: `Restaurada: ${r.empleado}, ${fechaCorta(r.fecha)} vuelve a la bandeja.` });
      await query.refetch();
    } catch (err) {
      setResultado({ ok: false, texto: err instanceof Error ? err.message : 'No se pudo restaurar la novedad.' });
    } finally {
      setEnviando(false);
    }
  }

  /** Resuelve la novedad escribiendo en Odoo. Qué se escribe depende del modo (ausencia por horas, día completo, banco o fichada). */
  async function aprobar(r: NovedadRow) {
    const base = { empleadoId: r.empleadoId, fecha: r.fecha, nota: form.nota.trim() || undefined };
    let cuerpo: Record<string, unknown>;
    if (modo === 'cargar' || modo === 'banco') {
      const horas = Number(form.horas.replace(',', '.'));
      if (!Number.isFinite(horas) || horas <= 0) {
        setErrorCarga('Poné las horas (por ejemplo 3,85).');
        return;
      }
      cuerpo = modo === 'cargar' ? { accion: 'horas', ...base, tipoId: form.tipoId, horas } : { accion: 'banco', ...base, horas };
    } else if (modo === 'dia') {
      cuerpo = { accion: 'dia', ...base, tipoId: form.tipoId };
    } else if (modo === 'nueva-fichada') {
      if (!form.entrada || !form.salida) {
        setErrorCarga('Poné la hora de entrada y la de salida.');
        return;
      }
      cuerpo = { accion: 'crear-fichada', ...base, entrada: form.entrada, salida: form.salida };
    } else {
      const marcaIncompleta = r.tipo === 'marca-incompleta';
      if (!form.salida || (marcaIncompleta && !form.entrada)) {
        setErrorCarga(marcaIncompleta ? 'Poné la hora de entrada y la de salida.' : 'Poné la hora de salida.');
        return;
      }
      cuerpo = { accion: 'fichada', ...base, tipo: r.tipo, entrada: marcaIncompleta ? form.entrada : undefined, salida: form.salida };
    }
    setEnviando(true);
    setErrorCarga(null);
    try {
      const res = await fetch('/api/rrhh-novedades-cargar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cuerpo),
      });
      const json = (await res.json()) as { ok: boolean; error?: string; data?: { resumen: string; aviso: string | null } };
      if (!json.ok || !json.data) throw new Error(json.error ?? 'No se pudo cargar en Odoo.');
      setResultado({ ok: !json.data.aviso, texto: json.data.aviso ?? json.data.resumen });
      setAbierta(null);
      await query.refetch();
    } catch (err) {
      setErrorCarga(err instanceof Error ? err.message : 'No se pudo cargar en Odoo.');
    } finally {
      setEnviando(false);
    }
  }

  // Navegación por día: solo los días que tienen novedades, del más reciente al más viejo. Por defecto abre en el último día;
  // "Todos" muestra el período entero. Si el día elegido ya no está (cambió el período o se resolvió todo), vuelve al último.
  const [dia, setDia] = useState<string | null>(null);
  const dias = useMemo(() => {
    const cuenta = new Map<string, number>();
    for (const r of allRows) cuenta.set(r.fecha, (cuenta.get(r.fecha) ?? 0) + 1);
    return [...cuenta.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([fecha, cantidad]) => ({ fecha, cantidad }));
  }, [allRows]);
  const diaActivo = dia === 'todos' ? '' : dia && dias.some((d) => d.fecha === dia) ? dia : (dias[0]?.fecha ?? '');
  const indiceDia = dias.findIndex((d) => d.fecha === diaActivo);

  // Las tarjetas de arriba cuentan lo del día elegido (no el período entero), para que coincidan con la tabla.
  const rowsDia = useMemo(() => (diaActivo ? allRows.filter((r) => r.fecha === diaActivo) : allRows), [allRows, diaActivo]);
  const kpi = useMemo(() => {
    const porTipo: Record<NovedadTipo, number> = { 'horas-faltantes': 0, 'sin-salida': 0, 'marca-incompleta': 0, 'sin-fichada': 0, 'horas-extra': 0 };
    let faltantes = 0;
    let extra = 0;
    for (const r of rowsDia) {
      porTipo[r.tipo] += 1;
      if (r.tipo === 'horas-faltantes' || r.tipo === 'sin-fichada') faltantes += r.horasAResolver;
      if (r.tipo === 'horas-extra') extra += r.horasAResolver;
    }
    return { novedades: rowsDia.length, empleados: new Set(rowsDia.map((r) => r.empleadoId)).size, porTipo, faltantes: Math.round(faltantes * 10) / 10, extra: Math.round(extra * 10) / 10 };
  }, [rowsDia]);

  // Con un día elegido se lista a TODOS los empleados, no solo a los que tienen novedades: los que no tienen ninguna salen de la
  // vista por día del historial (con "Todos" los días serían miles de filas, ahí solo se ven las novedades).
  const historialDia = useApiQuery<RrhhHistorialResult>(['rrhh-historial-dia', diaActivo], `/api/rrhh-historial?desde=${diaActivo}&hasta=${diaActivo}`, {
    enabled: Boolean(diaActivo),
  });
  const sinNovedad = useMemo(() => {
    if (!diaActivo) return [] as EmpleadoResumen[];
    const conFila = new Set(rowsDia.map((r) => r.empleadoId));
    // Fines de semana y feriados no se listan: no era un día de trabajo para ese empleado.
    return (historialDia.data?.empleados ?? []).filter((e) => e.dia && !conFila.has(e.empleadoId) && e.dia.estado !== 'fin-de-semana' && e.dia.estado !== 'feriado');
  }, [diaActivo, rowsDia, historialDia.data]);

  const rows = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return rowsDia.filter((r) => {
      if (tipo === 'sin') return false;
      if (tipo && tipo !== 'con' && r.tipo !== tipo) return false;
      if (departamento && r.departamento !== departamento) return false;
      if (q && !r.empleado.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rowsDia, tipo, departamento, busqueda]);
  const sinFiltradas = useMemo(() => {
    if (tipo !== '' && tipo !== 'sin') return [] as EmpleadoResumen[];
    const q = busqueda.trim().toLowerCase();
    return sinNovedad.filter((e) => (!departamento || e.departamento === departamento) && (!q || e.empleado.toLowerCase().includes(q)));
  }, [sinNovedad, tipo, departamento, busqueda]);

  const departamentos = useMemo(
    () => [...new Set([...allRows.map((r) => r.departamento), ...sinNovedad.map((e) => e.departamento)].filter((d): d is string => Boolean(d)))].sort((a, b) => a.localeCompare(b, 'es')),
    [allRows, sinNovedad]
  );

  /** Formulario de carga en Odoo (el mismo para las filas con novedad y para las acciones manuales de las filas sin novedad). */
  const formularioCarga = (r: NovedadRow) => (
                    <tr className="bg-slate-950/60">
                      <td colSpan={9} className="px-3 py-3">
                        <div className="flex flex-wrap items-end gap-4 text-sm text-slate-300">
                          {(modo === 'cargar' || modo === 'dia') && (
                            <label className="flex flex-col gap-1">
                              Qué fue
                              <select value={form.tipoId} onChange={(e) => setForm({ ...form, tipoId: Number(e.target.value) })} className={`min-w-[12rem] ${selectClass}`}>
                                {(modo === 'cargar' ? TIPOS_AUSENCIA_CARGABLES : TIPOS_AUSENCIA_DIA_COMPLETO).map((t) => (
                                  <option key={t.id} value={t.id}>
                                    {t.nombre}
                                  </option>
                                ))}
                              </select>
                            </label>
                          )}
                          {(modo === 'cargar' || modo === 'banco') && (
                            <label className="flex flex-col gap-1">
                              {modo === 'banco' ? 'Horas a acreditar' : 'Horas'}
                              <input
                                type="text"
                                inputMode="decimal"
                                value={form.horas}
                                onChange={(e) => setForm({ ...form, horas: e.target.value })}
                                className={`w-24 ${selectClass}`}
                              />
                            </label>
                          )}
                          {(modo === 'fichada' || modo === 'nueva-fichada') && (
                            <>
                              <label className="flex flex-col gap-1">
                                Entrada
                                {modo === 'fichada' && r.tipo === 'sin-salida' ? (
                                  <span className="py-1.5 tabular-nums text-slate-100">{r.entrada ?? '—'}</span>
                                ) : (
                                  <input type="time" value={form.entrada} onChange={(e) => setForm({ ...form, entrada: e.target.value })} className={selectClass} />
                                )}
                              </label>
                              <label className="flex flex-col gap-1">
                                Salida
                                <input type="time" value={form.salida} onChange={(e) => setForm({ ...form, salida: e.target.value })} className={selectClass} />
                              </label>
                            </>
                          )}
                          <label className="flex min-w-[14rem] flex-1 flex-col gap-1">
                            Nota (opcional)
                            <input
                              type="text"
                              value={form.nota}
                              maxLength={200}
                              onChange={(e) => setForm({ ...form, nota: e.target.value })}
                              placeholder={modo === 'nueva-fichada' ? 'Ej.: trabajó y no pasó por el reloj' : modo === 'fichada' ? 'Ej.: se olvidó de fichar la salida' : 'Ej.: se retiró con permiso'}
                              className={`placeholder:text-slate-600 ${selectClass}`}
                            />
                          </label>
                          <button
                            type="button"
                            disabled={enviando}
                            onClick={() => aprobar(r)}
                            className="rounded bg-brand-500 px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40"
                          >
                            {enviando ? 'Guardando…' : modo === 'nueva-fichada' ? 'Cargar fichada en Odoo' : modo === 'fichada' ? 'Corregir en Odoo' : modo === 'banco' ? 'Acreditar en Odoo' : 'Aprobar y cargar en Odoo'}
                          </button>
                        </div>
                        <p className="mt-2 text-xs text-slate-500">
                          {modo === 'cargar' && (
                            <>
                              Se crea en Odoo, ya aprobada, una ausencia de {TIPOS_AUSENCIA_CARGABLES.find((t) => t.id === form.tipoId)?.nombre.toLowerCase()} de{' '}
                              {form.horas || '—'} hs para {r.empleado} el {fechaCorta(r.fecha)}. Faltan {hs(r.horasAResolver)} según las fichadas.
                              {form.tipoId === 6 && ` Descuenta del banco de horas (saldo hoy: ${hs(r.saldoBanco)}).`}
                            </>
                          )}
                          {modo === 'dia' && (
                            <>
                              Se crea en Odoo, ya aprobada, una ausencia de día completo ({TIPOS_AUSENCIA_DIA_COMPLETO.find((t) => t.id === form.tipoId)?.nombre.toLowerCase()}) para{' '}
                              {r.empleado} el {fechaCorta(r.fecha)}. Si Odoo no deja cargarla (por ejemplo falta saldo de vacaciones), te lo avisa.
                            </>
                          )}
                          {modo === 'banco' && (
                            <>
                              Se acreditan en Odoo, ya aprobadas, {form.horas || '—'} hs al banco de horas de {r.empleado} por el {fechaCorta(r.fecha)} (trabajó {hs(r.fichadoHs)}).
                              Saldo hoy: {hs(r.saldoBanco)}.
                            </>
                          )}
                          {modo === 'nueva-fichada' && (
                            <>
                              Se crea en Odoo la fichada de {r.empleado} del {fechaCorta(r.fecha)} ({form.entrada || '—'} a {form.salida || '—'}), marcada como manual. Los horarios sugeridos son
                              los de la jornada habitual: ajustalos a lo que realmente trabajó. Con la fichada cargada, la novedad se vuelve a evaluar sola.
                            </>
                          )}
                          {modo === 'fichada' && (
                            <>
                              Se corrige en Odoo la fichada de {r.empleado} del {fechaCorta(r.fecha)}
                              {r.tipo === 'sin-salida' ? ` (entró a las ${r.entrada})` : ` (la única marca es de las ${r.entrada})`}; queda marcada como manual.
                            </>
                          )}{' '}
                          No se puede borrar desde la web: si te equivocás, corregilo en Odoo.
                        </p>
                        {errorCarga && <p className="mt-2 text-sm text-rose-300">{errorCarga}</p>}
                      </td>
                    </tr>
  );

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
            <select value={departamento} onChange={(e) => setDepartamento(e.target.value)} className={`w-44 max-w-full truncate ${selectClass}`}>
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
          <label className="flex flex-col gap-1">
            Mostrar
            <select value={tipo} onChange={(e) => setTipo(e.target.value as typeof tipo)} className={`w-44 max-w-full truncate ${selectClass}`}>
              <option value="">Todos los empleados</option>
              <option value="con">Solo con novedades</option>
              {TIPOS.map((t) => (
                <option key={t.tipo} value={t.tipo}>
                  {t.label}
                </option>
              ))}
              {diaActivo && <option value="sin">Sin novedades</option>}
            </select>
          </label>
          {puedeCargar && (
            <label className="flex items-center gap-2 pb-1.5">
              <input type="checkbox" checked={verDescartadas} onChange={(e) => setVerDescartadas(e.target.checked)} />
              Ver descartadas {cantDescartadas > 0 && <span className="text-xs text-slate-500">({cantDescartadas})</span>}
            </label>
          )}
        </div>
        <LastUpdated dataUpdatedAt={query.dataUpdatedAt} />
      </div>

      {data && dias.length > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900 p-2" aria-label="Días con novedades">
          <button
            type="button"
            disabled={!diaActivo || indiceDia >= dias.length - 1}
            onClick={() => setDia(dias[indiceDia + 1]!.fecha)}
            title="Día anterior con novedades"
            className="shrink-0 rounded border border-slate-700 px-2.5 py-1.5 text-sm text-slate-200 hover:border-brand-500 disabled:opacity-30"
          >
            ‹
          </button>
          <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto py-0.5">
            <button
              type="button"
              onClick={() => setDia('todos')}
              className={`shrink-0 whitespace-nowrap rounded-md px-3 py-1.5 text-sm ${!diaActivo ? 'bg-slate-800 text-slate-100' : 'text-slate-400 hover:text-slate-200'}`}
            >
              Todos <span className="text-xs text-slate-500">{allRows.length}</span>
            </button>
            {/* De más viejo (izquierda) a más nuevo (derecha), como un calendario: ‹ va al día anterior y › al siguiente. */}
            {[...dias].reverse().map((d) => (
              <button
                key={d.fecha}
                type="button"
                ref={(el) => {
                  // Mantiene a la vista el día elegido dentro de la tira (solo scroll horizontal de la tira, no de la página).
                  if (el && diaActivo === d.fecha && el.parentElement) {
                    el.parentElement.scrollLeft = el.offsetLeft - el.parentElement.clientWidth / 2 + el.clientWidth / 2;
                  }
                }}
                onClick={() => setDia(d.fecha)}
                aria-pressed={diaActivo === d.fecha}
                className={`shrink-0 whitespace-nowrap rounded-md px-3 py-1.5 text-sm ${diaActivo === d.fecha ? 'bg-slate-800 text-slate-100' : 'text-slate-400 hover:text-slate-200'}`}
              >
                {fechaCorta(d.fecha)} <span className="text-xs text-slate-500">{d.cantidad}</span>
              </button>
            ))}
          </div>
          <button
            type="button"
            disabled={!diaActivo || indiceDia <= 0}
            onClick={() => setDia(dias[indiceDia - 1]!.fecha)}
            title="Día siguiente con novedades"
            className="shrink-0 rounded border border-slate-700 px-2.5 py-1.5 text-sm text-slate-200 hover:border-brand-500 disabled:opacity-30"
          >
            ›
          </button>
        </div>
      )}

      {query.isLoading ? (
        <div className="h-28 w-full animate-pulse-slow rounded-lg bg-slate-800/60" />
      ) : (
        data && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 2xl:grid-cols-8">
            <Kpi
              label="Todos"
              acento="bg-slate-400"
              value={String(diaActivo ? kpi.novedades + sinNovedad.length : kpi.novedades)}
              hint={diaActivo ? `empleados · ${fechaCorta(diaActivo)}` : 'todo el período'}
              title={diaActivo ? 'Todos los empleados del día elegido, con o sin novedad. Tocá para ver todos.' : 'Con "Todos" los días solo se listan las novedades (elegí un día para ver a todos los empleados).'}
              onClick={() => setTipo('')}
              activo={tipo === ''}
            />
            <Kpi
              label="Con novedad"
              acento="bg-brand-500"
              value={String(kpi.novedades)}
              hint={`${kpi.empleados} ${kpi.empleados === 1 ? 'empleado' : 'empleados'}`}
              title="Solo los que tienen alguna anomalía en el día elegido (o en el período entero si elegís Todos)."
              onClick={() => setTipo('con')}
              activo={tipo === 'con'}
            />
            {TIPOS.map((t) => (
              <Kpi
                key={t.tipo}
                label={t.label}
                acento={t.acento}
                value={String(kpi.porTipo[t.tipo])}
                hint={
                  t.tipo === 'horas-faltantes'
                    ? `${hs(kpi.faltantes)} a cubrir`
                    : t.tipo === 'horas-extra'
                      ? `${hs(kpi.extra)} de más`
                      : undefined
                }
                title={`${t.ayuda} Tocá para filtrar.`}
                onClick={() => setTipo(tipo === t.tipo ? '' : t.tipo)}
                activo={tipo === t.tipo}
              />
            ))}
            {diaActivo && (
              <Kpi
                label="Sin novedad"
                acento="bg-emerald-500"
                value={historialDia.data ? String(sinNovedad.length) : '…'}
                hint="normal o con licencia"
                title="Empleados del día sin ninguna anomalía: jornada normal, con licencia aprobada o sin fichadas en el período. Tocá para filtrar."
                onClick={() => setTipo(tipo === 'sin' ? '' : 'sin')}
                activo={tipo === 'sin'}
              />
            )}
          </div>
        )
      )}

      {data && (
        <p className="text-xs text-slate-500">
          Se revisan los días hábiles hasta el {formatFechaIso(data.evaluadoHasta)} (hoy no, porque todavía puede estar trabajando). Jornada fichada de{' '}
          {formatDias(data.jornadaHs)} hs: se tolera 15 min de diferencia, y las horas extra se redondean al cuarto de hora desde 30 min de más (el tiempo exacto va entre paréntesis). Lo que ya está cubierto por una licencia aprobada en Odoo (por ejemplo un
          banco de horas ya cargado) no aparece.{puedeCargar ? ' Cada novedad tiene su acción: cargar la ausencia, acreditar las horas extra al banco o corregir la fichada, todo en Odoo; o descartarla.' : ' Solo lectura.'}
        </p>
      )}

      {puedeCargar && data && !data.descartesDisponibles && (
        <p className="rounded border border-amber-900 bg-amber-950/40 p-3 text-sm text-amber-300">
          "Descartar" todavía no guarda: falta crear la tabla <code>rrhh_novedades_descartadas</code> en Supabase (el SQL está en el encabezado de{' '}
          <code>src/lib/supabase/rrhh-novedades-descartadas.ts</code>).
        </p>
      )}

      {resultado && (
        <p
          className={`flex items-start justify-between gap-3 rounded border p-3 text-sm ${
            resultado.ok ? 'border-emerald-900 bg-emerald-950/40 text-emerald-300' : 'border-amber-900 bg-amber-950/40 text-amber-300'
          }`}
        >
          <span>{resultado.texto}</span>
          <button type="button" onClick={() => setResultado(null)} className="shrink-0 text-xs underline">
            Cerrar
          </button>
        </p>
      )}

      {data && (
        <div className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-900">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-slate-500">
              <tr className="border-b border-slate-800">
                <th className="px-3 py-2 font-medium">Día</th>
                <th className="px-3 py-2 font-medium">Empleado</th>
                <th className="px-3 py-2 font-medium">Qué pasó</th>
                <th className="px-3 py-2 font-medium">Fichadas</th>
                <th className="px-3 py-2 text-right font-medium">Fichado</th>
                <th className="px-3 py-2 text-right font-medium">A resolver</th>
                <th className="px-3 py-2 font-medium">Ya cargado en Odoo</th>
                <th className="px-3 py-2 text-right font-medium">Banco hoy</th>
                {puedeCargar && <th className="px-3 py-2 text-right font-medium">Acción</th>}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && sinFiltradas.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-3 py-6 text-center text-slate-500">
                    {allRows.length === 0 && !diaActivo
                      ? data.evaluadoHasta < desde
                        ? 'Ese período todavía no tiene días cerrados para revisar (hoy no se evalúa).'
                        : 'No hay novedades en este período.'
                      : 'Ninguna novedad coincide con los filtros.'}
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <Fragment key={r.clave}>
                  <tr title={r.detalle} className={`border-t border-slate-800 align-top ${r.descartada ? 'opacity-50' : ''}`}>
                    <td className="whitespace-nowrap px-3 py-2 text-slate-300">{fechaCorta(r.fecha)}</td>
                    <td className="px-3 py-2">
                      {onVerHistorial ? (
                        <button type="button" title="Ver todo su historial de fichadas" onClick={() => onVerHistorial(r.empleadoId)} className="text-left text-slate-100 hover:text-brand-400 hover:underline">
                          {r.empleado}
                        </button>
                      ) : (
                        <p className="text-slate-100">{r.empleado}</p>
                      )}
                      {r.departamento && <p className="text-xs text-slate-500">{r.departamento}</p>}
                    </td>
                    <td className="px-3 py-2">
                      <TipoBadge tipo={r.tipo} />
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums text-slate-300">
                      {r.entrada ? `${r.entrada} – ${r.salida ?? 'sin salida'}` : <span className="text-slate-600">—</span>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-300">{r.tipo === 'sin-fichada' ? '—' : hs(r.fichadoHs)}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${r.tipo === 'horas-extra' ? 'text-sky-300' : 'text-amber-300'}`}>
                      {r.tipo === 'sin-salida' ? '—' : `${r.tipo === 'horas-extra' ? '+' : '−'}${hs(r.horasAResolver)}`}
                      {r.tipo === 'horas-extra' && exactoExtra(r.fichadoHs, data.jornadaHs, r.horasAResolver) && (
                        <span className="block text-xs text-slate-500">({exactoExtra(r.fichadoHs, data.jornadaHs, r.horasAResolver)})</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <YaCargado row={r} />
                    </td>
                    <td className={`px-3 py-2 text-right tabular-nums ${r.saldoBanco < 0 ? 'text-rose-300' : 'text-slate-400'}`}>{hs(r.saldoBanco)}</td>
                    {puedeCargar && (
                      <td className="whitespace-nowrap px-3 py-2 text-right">
                        {r.descartada ? (
                          <button
                            type="button"
                            disabled={enviando}
                            onClick={() => restaurar(r)}
                            title={`Descartada por ${r.descartada.por}${r.descartada.motivo ? `: ${r.descartada.motivo}` : ''}`}
                            className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-200 hover:border-brand-500 disabled:opacity-40"
                          >
                            Restaurar
                          </button>
                        ) : (
                          <div className="flex justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => (abierta === r.clave && modo === ACCION_POR_TIPO[r.tipo].modo ? setAbierta(null) : abrir(r, ACCION_POR_TIPO[r.tipo].modo))}
                              className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-200 hover:border-brand-500"
                            >
                              {abierta === r.clave && modo === ACCION_POR_TIPO[r.tipo].modo ? 'Cerrar' : ACCION_POR_TIPO[r.tipo].boton}
                            </button>
                            {ACCION_EXTRA[r.tipo] && (
                              <button
                                type="button"
                                onClick={() => (abierta === r.clave && modo === ACCION_EXTRA[r.tipo]!.modo ? setAbierta(null) : abrir(r, ACCION_EXTRA[r.tipo]!.modo))}
                                title="Por si trabajó y no fichó: se carga la fichada (entrada y salida) en Odoo."
                                className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-200 hover:border-brand-500"
                              >
                                {abierta === r.clave && modo === ACCION_EXTRA[r.tipo]!.modo ? 'Cerrar' : ACCION_EXTRA[r.tipo]!.boton}
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => (abierta === r.clave && modo === 'descartar' ? setAbierta(null) : abrir(r, 'descartar'))}
                              title="No hay que cargar nada: la novedad deja de aparecer."
                              className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-400 hover:border-rose-500 hover:text-rose-300"
                            >
                              Descartar
                            </button>
                          </div>
                        )}
                      </td>
                    )}
                  </tr>
                  {puedeCargar && abierta === r.clave && modo === 'descartar' && (
                    <tr className="bg-slate-950/60">
                      <td colSpan={9} className="px-3 py-3">
                        <div className="flex flex-wrap items-end gap-4 text-sm text-slate-300">
                          <label className="flex min-w-[16rem] flex-1 flex-col gap-1">
                            Motivo (opcional)
                            <input
                              type="text"
                              value={form.nota}
                              maxLength={200}
                              onChange={(e) => setForm({ ...form, nota: e.target.value })}
                              placeholder="Ej.: ya lo resolvió el supervisor"
                              className={`placeholder:text-slate-600 ${selectClass}`}
                            />
                          </label>
                          <button
                            type="button"
                            disabled={enviando}
                            onClick={() => descartar(r)}
                            className="rounded border border-rose-700 px-3 py-1.5 text-sm font-medium text-rose-200 hover:bg-rose-950 disabled:opacity-40"
                          >
                            {enviando ? 'Guardando…' : 'Descartar novedad'}
                          </button>
                        </div>
                        <p className="mt-2 text-xs text-slate-500">
                          No se carga nada en Odoo: solo se oculta esta novedad ({r.empleado}, {fechaCorta(r.fecha)}). Queda guardado quién la descartó y se puede restaurar.
                        </p>
                        {errorCarga && <p className="mt-2 text-sm text-rose-300">{errorCarga}</p>}
                      </td>
                    </tr>
                  )}
                  {puedeCargar && abierta === r.clave && modo !== 'descartar' && formularioCarga(r)}
                  </Fragment>
                ))
              )}
              {sinFiltradas.map((e) => {
                const d = e.dia!;
                const info = BADGE_SIN[d.estado] ?? BADGE_SIN.ok;
                // Fila "armada" para reusar el formulario de carga: RRHH puede acreditar horas al banco aunque no haya novedad
                // (por ejemplo, trabajó justo una hora de más y no pasa la tolerancia).
                const manual: NovedadRow = {
                  clave: `${e.empleadoId}|${d.fecha}|manual`,
                  empleadoId: e.empleadoId,
                  empleado: e.empleado,
                  legajo: e.legajo,
                  departamento: e.departamento,
                  fecha: d.fecha,
                  tipo: 'horas-extra',
                  entrada: d.entrada,
                  salida: d.salida,
                  fichadoHs: d.fichadoHs,
                  horasAResolver: Math.max(0, Math.round((d.fichadoHs - data.jornadaHs) * 100) / 100),
                  cubiertoHs: 0,
                  pendienteHs: 0,
                  licencias: d.licencias,
                  saldoBanco: e.saldoBanco,
                  detalle: '',
                  descartada: null,
                };
                return (
                  <Fragment key={`sin-${e.empleadoId}`}>
                  <tr className="border-t border-slate-800 align-top">
                    <td className="whitespace-nowrap px-3 py-2 text-slate-300">{fechaCorta(d.fecha)}</td>
                    <td className="px-3 py-2">
                      {onVerHistorial ? (
                        <button type="button" title="Ver todo su historial de fichadas" onClick={() => onVerHistorial(e.empleadoId)} className="text-left text-slate-100 hover:text-brand-400 hover:underline">
                          {e.empleado}
                        </button>
                      ) : (
                        <p className="text-slate-100">{e.empleado}</p>
                      )}
                      {e.departamento && <p className="text-xs text-slate-500">{e.departamento}</p>}
                    </td>
                    <td className="px-3 py-2">
                      <span title={info.ayuda} className={`inline-block whitespace-nowrap rounded px-1.5 py-0.5 text-xs ${info.clase}`}>
                        {d.descartada ? 'Descartada' : info.label}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums text-slate-300">
                      {d.entrada ? `${d.entrada} – ${d.salida ?? 'sin salida'}` : <span className="text-slate-600">—</span>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-300">{d.marcas.length > 0 ? hs(d.fichadoHs) : '—'}</td>
                    <td className="px-3 py-2 text-right text-slate-600">—</td>
                    <td className="px-3 py-2 text-xs">
                      {d.licencias.length === 0 ? (
                        <span className="text-slate-600">—</span>
                      ) : (
                        <ul className="flex flex-col gap-0.5">
                          {d.licencias.map((l) => (
                            <li key={l.id} className={l.estado === 'validate' ? 'text-slate-300' : 'text-amber-300'}>
                              {l.tipo} {hs(l.horas)}
                              <span className="text-slate-500"> · {ESTADO_LABEL[l.estado]}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td className={`px-3 py-2 text-right tabular-nums ${e.saldoBanco < 0 ? 'text-rose-300' : 'text-slate-400'}`}>{hs(e.saldoBanco)}</td>
                    {puedeCargar && (
                      <td className="whitespace-nowrap px-3 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => (abierta === manual.clave && modo === 'banco' ? setAbierta(null) : abrir(manual, 'banco'))}
                          title="Acreditar horas al banco de horas de este empleado por este día, aunque no figure como novedad."
                          className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-200 hover:border-brand-500"
                        >
                          {abierta === manual.clave && modo === 'banco' ? 'Cerrar' : 'Acreditar al banco'}
                        </button>
                      </td>
                    )}
                  </tr>
                  {puedeCargar && abierta === manual.clave && modo === 'banco' && formularioCarga(manual)}
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
export default function NovedadesApp(props: Props) {
  return (
    <QueryProvider>
      <NovedadesInner {...props} />
    </QueryProvider>
  );
}
