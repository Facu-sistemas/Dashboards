import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import QueryProvider from '@/components/QueryProvider';
import { useApiQuery } from '@/components/dashboard/useApiQuery';
import LastUpdated from '@/components/shared/LastUpdated';
import type { LineaPlan } from '@/lib/lineas-sillon/plan';
import { filasDeHoy, type EstacionId, type Sobrante, type Tramo } from '@/lib/lineas-sillon/engine';
import LineasSillonLineas from './LineasSillonLineas';
import LineasSillonPersonas from './LineasSillonPersonas';
import LineasSillonEquivalencias from './LineasSillonEquivalencias';
import { generarPdfSillon } from './lineas-sillon-pdf';
import { SLOTS_UI, fechaLarga, guardarSillon, horaCorta, porcentaje, tonoEficiencia, type LineasSillonResponse } from './lineas-sillon-shared';

type Vista = 'reporte' | 'lineas' | 'personas' | 'equivalencias';

/** Filas en blanco que se ofrecen debajo de la última unidad para seguir cargando a mano. */
const FILAS_EXTRA = 2;
const ID_LISTA = 'productos-sillon';

/** Celda editable: se elige del desplegable (o se escribe para filtrar); vacía = la estación no hace nada en esa fila. */
function CeldaEstacion({
  valor,
  hora,
  manana,
  ayer,
  aviso,
  editable,
  validos,
  onCambio,
}: {
  valor: string;
  hora: string;
  manana: boolean;
  /** Sobrante de ayer: la estación de arriba ya la dejó hecha. */
  ayer: boolean;
  /** Texto del aviso cuando la unidad figura antes de que la estación de arriba la termine. */
  aviso: string;
  editable: boolean;
  validos: Set<string>;
  onCambio: (v: string | null) => void;
}) {
  const [texto, setTexto] = useState(valor);
  useEffect(() => setTexto(valor), [valor]);
  const confirmar = () => {
    const limpio = texto.trim();
    if (limpio === valor) return;
    if (limpio === '') return onCambio(null);
    const ok = [...validos].find((n) => n.toLowerCase() === limpio.toLowerCase());
    if (ok) onCambio(ok);
    else setTexto(valor); // lo escrito no es un producto: vuelve a lo que había
  };
  return (
    <div className="flex items-center gap-1">
      {editable ? (
        <input
          list={ID_LISTA}
          value={texto}
          placeholder="—"
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setTexto(e.target.value)}
          onBlur={confirmar}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') setTexto(valor);
          }}
          className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-xs text-slate-200 placeholder:text-slate-700 hover:border-slate-700 focus:border-brand-500 focus:bg-slate-950 focus:outline-none"
        />
      ) : (
        <span className="min-w-0 flex-1 truncate px-1 text-xs text-slate-200">{valor}</span>
      )}
      {valor && ayer && (
        <span className="shrink-0 rounded bg-amber-500/15 px-1 text-[10px] text-amber-300" title="Sobrante de ayer: la estación de arriba ya la dejó hecha">
          de ayer
        </span>
      )}
      {valor && aviso && !manana && (
        <span className="shrink-0 cursor-help text-xs text-rose-400" title={aviso} aria-label={aviso}>
          ⚠
        </span>
      )}
      <span className={`w-[4.5rem] shrink-0 text-right text-xs tabular-nums ${manana ? 'text-amber-500/70' : 'text-slate-400'}`} title={manana ? 'Termina mañana' : undefined}>
        {valor ? (manana ? 'mañana' : hora) : ''}
      </span>
    </div>
  );
}

const SIN_SOBRANTE: Sobrante = { tapiceria: [], ensamble: [] };
const ESTACION_DE_ARRIBA: Record<EstacionId, string> = { carpinteria: '', tapiceria: 'Carpintería', ensamble: 'Tapicería' };

const minutos = (m: number) => `${Math.max(1, Math.round(m))} min`;

/** Explica el ⚠ de una unidad que la estación tendría que esperar porque la de arriba todavía no la entregó. */
function textoAviso(t: Tramo | undefined, estacion: EstacionId): string {
  if (!t || t.vacio || !t.esperaMin) return '';
  return `${ESTACION_DE_ARRIBA[estacion]} recién la entrega ${t.llegaReloj}: acá se quedarían ${minutos(t.esperaMin)} sin pieza antes de empezarla. Con más sobrante de ayer no habría espera.`;
}

/**
 * Sobrante de ayer de una línea: lo que Carpintería dejó hecho para Tapicería y Tapicería para Ensamble. Sale solo del plan
 * anterior y acá se corrige a mano (quitar con ✕, agregar del desplegable) cuando el día no terminó como estaba planeado.
 */
function SobranteEditor({
  lp,
  validos,
  editable,
  onGuardar,
  onReset,
}: {
  lp: LineaPlan;
  validos: Set<string>;
  editable: boolean;
  onGuardar: (s: Sobrante) => void;
  onReset: () => void;
}) {
  const sobrante = lp.sobrante ?? SIN_SOBRANTE; // los planes fijados antes de este cambio no traen el campo
  const [nuevo, setNuevo] = useState<{ tapiceria: string; ensamble: string }>({ tapiceria: '', ensamble: '' });
  const vacio = sobrante.tapiceria.length + sobrante.ensamble.length === 0;
  if (!editable && vacio) return null;

  const agregar = (e: keyof Sobrante, texto: string) => {
    const producto = [...validos].find((n) => n.toLowerCase() === texto.trim().toLowerCase());
    if (!producto) return;
    setNuevo((n) => ({ ...n, [e]: '' }));
    onGuardar({ ...sobrante, [e]: [...sobrante[e], { producto, origen: '' }] });
  };

  return (
    <div className="border-b border-slate-800 bg-amber-500/[0.03] px-3 py-2 text-[11px] print:hidden">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-medium text-amber-300/90">Sobrante de ayer</span>
        <span className="text-slate-500">
          {lp.sobranteAMano ? 'corregido a mano' : vacio ? 'no quedó nada del plan anterior' : 'calculado del plan anterior'}
        </span>
        {editable && lp.sobranteAMano && (
          <button
            type="button"
            onClick={onReset}
            title="Descartar la corrección y volver al sobrante que sale del plan anterior"
            className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] text-sky-300 hover:bg-sky-500/25"
          >
            ↺ automático
          </button>
        )}
      </div>
      <div className="mt-1.5 grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
        {(['tapiceria', 'ensamble'] as const).map((e) => (
          <div key={e} className="flex flex-wrap items-center gap-1">
            <span className="mr-1 text-slate-400" title={e === 'tapiceria' ? 'Carpintería ya lo terminó; Tapicería no' : 'Tapicería ya lo terminó; Ensamble no'}>
              {e === 'tapiceria' ? 'En Tapicería:' : 'En Ensamble:'}
            </span>
            {sobrante[e].length === 0 && <span className="text-slate-600">nada</span>}
            {sobrante[e].map((u, i) => (
              <span key={i} className="inline-flex items-center gap-1 rounded bg-slate-950/70 px-1.5 py-0.5 text-slate-200" title={u.origen || 'Cargado a mano'}>
                {u.producto}
                {editable && (
                  <button
                    type="button"
                    aria-label={`Quitar ${u.producto} del sobrante`}
                    onClick={() => onGuardar({ ...sobrante, [e]: sobrante[e].filter((_, k) => k !== i) })}
                    className="text-slate-500 hover:text-rose-400"
                  >
                    ✕
                  </button>
                )}
              </span>
            ))}
            {editable && (
              <input
                list={ID_LISTA}
                value={nuevo[e]}
                placeholder="+ agregar"
                aria-label={`Agregar al sobrante de ${e === 'tapiceria' ? 'Tapicería' : 'Ensamble'}`}
                onChange={(ev) => {
                  setNuevo((n) => ({ ...n, [e]: ev.target.value }));
                  // Elegir del desplegable ya lo agrega; lo escrito a medias espera al Enter.
                  if (validos.has(ev.target.value)) agregar(e, ev.target.value);
                }}
                onKeyDown={(ev) => ev.key === 'Enter' && agregar(e, nuevo[e])}
                className="w-28 rounded border border-transparent bg-transparent px-1 py-0.5 text-slate-200 placeholder:text-slate-600 hover:border-slate-700 focus:w-56 focus:border-brand-500 focus:bg-slate-950 focus:outline-none"
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function LineaCard({
  lp,
  nombres,
  validos,
  editable,
  sobranteEditable,
  onPdf,
  onIgnorar,
  onCeldas,
  onReset,
  onSobrante,
  onSobranteReset,
}: {
  lp: LineaPlan;
  nombres: Map<string, string>;
  validos: Set<string>;
  editable: boolean;
  sobranteEditable: boolean;
  onPdf: () => void;
  onIgnorar: (orden: string) => void;
  onCeldas: (estacion: EstacionId, celdas: (string | null)[]) => void;
  onReset: (estacion: EstacionId) => void;
  onSobrante: (s: Sobrante) => void;
  onSobranteReset: () => void;
}) {
  const [carp] = lp.estaciones;
  const reales = filasDeHoy(lp.estaciones);
  const total = Math.min(150, reales + FILAS_EXTRA);
  const asignados = SLOTS_UI.map((s) => ({ ...s, nombre: lp.config.asignados[s.slot] ? nombres.get(lp.config.asignados[s.slot]!) : undefined }));
  const editadas = lp.editadas ?? []; // los planes fijados antes de este cambio no traen el campo
  const hayEditadas = editadas.length > 0;
  const avisos = lp.estaciones.reduce((a, e) => a + (e.avisos ?? 0), 0);

  const cambiar = (j: number, fila: number, valor: string | null) => {
    const est = lp.estaciones[j]!;
    const celdas: (string | null)[] = est.tramos.map((t) => (t.vacio ? null : t.producto));
    while (celdas.length <= fila) celdas.push(null);
    celdas[fila] = valor;
    while (celdas.length > 0 && celdas[celdas.length - 1] === null) celdas.pop();
    onCeldas(est.id, celdas);
  };

  return (
    <section className="break-inside-avoid rounded-lg border border-slate-800 bg-slate-900/60">
      <header className="border-b border-slate-800 px-3 py-2">
        <div className="flex items-baseline justify-between">
          <h3 className="text-sm font-semibold text-slate-100">Línea {lp.linea}</h3>
          <span className="flex items-center gap-3 text-xs text-slate-500">
            <span>
              {reales} hoy{carp!.pendientes > 0 ? ` · ${carp!.pendientes} para después` : ''}
            </span>
            {avisos > 0 && (
              <span className="cursor-help text-rose-400" title="Veces que una estación se quedaría sin pieza esperando a la de arriba: pasá el mouse por cada ⚠ para ver cuánto">
                ⚠ {avisos}
              </span>
            )}
            {reales > 0 && (
              <button type="button" onClick={onPdf} className="text-brand-400 hover:underline print:hidden">
                PDF
              </button>
            )}
          </span>
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-400">
          {asignados.map((a) => (
            <span key={a.slot}>
              <span className="text-slate-500">{a.label}</span> {a.nombre ?? <span className="text-slate-600">—</span>}
            </span>
          ))}
        </div>
      </header>

      <SobranteEditor lp={lp} validos={validos} editable={sobranteEditable} onGuardar={onSobrante} onReset={onSobranteReset} />

      <table className="w-full table-fixed text-xs">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wide text-slate-500">
            <th className="w-10 px-3 py-1.5 font-medium">#</th>
            {lp.estaciones.map((e) => (
              <th key={e.id} className="px-1 py-1.5 font-medium">
                <span className="flex items-center justify-between gap-2">
                  <span>{e.nombre.split(' ')[0]}</span>
                  {editadas.includes(e.id) && (
                    <button
                      type="button"
                      onClick={() => onReset(e.id)}
                      title="Esta estación está armada a mano: volver al plan automático de Odoo"
                      className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] normal-case text-sky-300 hover:bg-sky-500/25 print:hidden"
                    >
                      a mano · ↺ automático
                    </button>
                  )}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: total }, (_, i) => (
            <tr key={i} className="group border-t border-slate-800/60">
              <td className="whitespace-nowrap px-3 py-0.5 tabular-nums text-slate-500">
                {i + 1}
                {editable && !hayEditadas && carp!.tramos[i] && !carp!.tramos[i]!.vacio && !carp!.tramos[i]!.manual && (
                  <button
                    type="button"
                    onClick={() => onIgnorar(carp!.tramos[i]!.origen)}
                    title="Ya está terminada en todas las estaciones: sacarla del plan (para una sola estación, vaciá su celda)"
                    aria-label="Sacar del plan"
                    className="ml-1 text-slate-600 opacity-0 transition-opacity hover:text-rose-400 focus:opacity-100 group-hover:opacity-100 print:hidden"
                  >
                    ✕
                  </button>
                )}
              </td>
              {lp.estaciones.map((e, j) => {
                const t = e.tramos[i];
                return (
                  <td key={e.id} className="px-1 py-0.5">
                    <CeldaEstacion
                      valor={t && !t.vacio ? t.producto : ''}
                      hora={t?.finReloj ?? ''}
                      manana={!!t && t.dia > 0}
                      ayer={!!t?.ayer}
                      aviso={textoAviso(t, e.id)}
                      editable={editable}
                      validos={validos}
                      onCambio={(v) => cambiar(j, i, v)}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-slate-700 text-[11px]">
            <td className="px-3 py-1.5 text-slate-500">Efic.</td>
            {lp.estaciones.map((e) => (
              <td key={e.id} className={`px-1 py-1.5 text-right font-semibold tabular-nums ${tonoEficiencia(e.eficiencia)}`}>
                {(e.esperaTotalMin ?? 0) >= 0.5 && (
                  <span
                    className="mr-2 cursor-help font-normal text-rose-400"
                    title={`Esperando a ${ESTACION_DE_ARRIBA[e.id]}, esta estación terminaría unos ${minutos(e.esperaTotalMin!)} más tarde que el horario de la planilla.`}
                  >
                    ⚠ +{minutos(e.esperaTotalMin!)}
                  </span>
                )}
                {porcentaje(e.eficiencia)}
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </section>
  );
}

function Reporte({
  data,
  repartir,
  setRepartir,
  onSaved,
}: {
  data: LineasSillonResponse;
  repartir: boolean;
  setRepartir: (v: boolean) => void;
  onSaved: () => void;
}) {
  const { config, fijado } = data;
  const hoy = data.plan.hoy;
  const [fecha, setFecha] = useState(hoy);
  const pasado = fecha < hoy;
  // Un día anterior se consulta tal como quedó fijado ese día: no se toca Odoo ni se edita.
  const historico = useApiQuery<{ fijado: LineasSillonResponse['fijado'] }>(['lineas-sillon-dia', fecha], `/api/lineas-sillon?fecha=${fecha}`, { enabled: pasado });
  const [vista, setVista] = useState<'fijado' | 'vivo'>(fijado ? 'fijado' : 'vivo');
  const [error, setError] = useState('');
  const [fijando, setFijando] = useState(false);
  const mostrandoFijado = pasado || (vista === 'fijado' && fijado !== null);
  const fijadoMostrado = pasado ? (historico.data?.fijado ?? null) : fijado;
  const planDia = pasado ? fijadoMostrado?.plan : mostrandoFijado ? fijado!.plan : data.plan;
  const plan = planDia ?? data.plan;
  const moverDia = (delta: number) => {
    const d = new Date(`${fecha}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + delta);
    const nueva = d.toISOString().slice(0, 10);
    if (nueva <= hoy) setFecha(nueva);
  };
  const nombres = new Map(config.personas.map((p) => [p.id, p.nombre]));
  const activas = plan.lineas.filter((l) => l.config.activa);
  const apagadas = plan.lineas.filter((l) => !l.config.activa).map((l) => l.linea);
  const productosConTiempo = plan.productos.filter((p) => p.minutos);
  const validos = new Set(productosConTiempo.map((p) => p.nombre));
  const sinResolverUnidades = plan.sinResolver.reduce((a, r) => a + r.unidades, 0);

  const pie = mostrandoFijado && fijadoMostrado
    ? `Plan fijado a las ${horaCorta(fijadoMostrado.creadoEn)} (${fijadoMostrado.creadoPor})`
    : `Plan en vivo generado a las ${horaCorta(new Date().toISOString())}`;
  const pdf = (lineas: LineaPlan[], archivo: string) => {
    setError(generarPdfSillon(lineas, plan.hoy, pie, archivo, nombres) ? '' : 'No hay unidades para imprimir.');
  };

  const ignorar = async (orden: string, delta: 1 | -1) => {
    setError('');
    try {
      await guardarSillon({ tipo: 'ignorar', orden, delta, repartir });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const celdas = async (linea: number, estacion: EstacionId, lista: (string | null)[]) => {
    setError('');
    try {
      await guardarSillon({ tipo: 'celdas', linea, estacion, celdas: lista, repartir });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const volverAutomatico = async (linea: number, estacion: EstacionId) => {
    setError('');
    try {
      await guardarSillon({ tipo: 'celdas-reset', linea, estacion, repartir });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const guardarSobrante = async (linea: number, s: Sobrante | null) => {
    setError('');
    try {
      await guardarSillon(s ? { tipo: 'sobrante', linea, tapiceria: s.tapiceria, ensamble: s.ensamble, repartir } : { tipo: 'sobrante-reset', linea, repartir });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const restablecer = async () => {
    if (!window.confirm('¿Volver a incluir todas las unidades que sacaste del plan?')) return;
    setError('');
    try {
      await guardarSillon({ tipo: 'ignorar-limpiar', repartir });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const fijar = async () => {
    if (fijado && !window.confirm('Ya hay un plan fijado hoy. ¿Reemplazarlo por el plan actual?')) return;
    setFijando(true);
    setError('');
    try {
      await guardarSillon({ tipo: 'fijar-plan', repartir });
      onSaved();
      setVista('fijado');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setFijando(false);
    }
  };

  const navegacion = (
    <div className="flex flex-wrap items-center gap-3 print:hidden">
      <h3 className="text-base font-semibold capitalize text-slate-100">Producción — {fechaLarga(fecha)}</h3>
      <div className="inline-flex items-center gap-1">
        <button type="button" onClick={() => moverDia(-1)} aria-label="Día anterior" className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:border-slate-500">
          ◀
        </button>
        <input
          type="date"
          value={fecha}
          max={hoy}
          onChange={(e) => e.target.value && e.target.value <= hoy && setFecha(e.target.value)}
          className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200 focus:border-brand-500 focus:outline-none"
        />
        <button
          type="button"
          onClick={() => moverDia(1)}
          disabled={!pasado}
          aria-label="Día siguiente"
          className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:border-slate-500 disabled:opacity-40"
        >
          ▶
        </button>
        {pasado && (
          <button type="button" onClick={() => setFecha(hoy)} className="rounded bg-brand-500/20 px-3 py-1 text-xs text-brand-400 hover:bg-brand-500/30">
            Hoy
          </button>
        )}
      </div>
      {pasado && <span className="text-xs text-slate-500">Día anterior: solo lectura</span>}
    </div>
  );

  if (pasado && !planDia) {
    return (
      <div className="space-y-4">
        {navegacion}
        <p className="rounded-lg border border-slate-800 px-4 py-8 text-center text-sm text-slate-500">
          {historico.isLoading ? 'Cargando…' : 'No quedó un plan guardado para ese día.'}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {navegacion}
      {!pasado && (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="inline-flex rounded-lg border border-slate-800 bg-slate-900/60 p-1">
          <button
            type="button"
            disabled={!fijado}
            onClick={() => setVista('fijado')}
            className={`rounded px-3 py-1 text-xs disabled:opacity-40 ${mostrandoFijado ? 'bg-brand-500/15 text-brand-400' : 'text-slate-400'}`}
          >
            {fijado ? `Plan de las ${horaCorta(fijado.creadoEn)}` : 'Plan fijado (todavía no hay)'}
          </button>
          <button
            type="button"
            onClick={() => setVista('vivo')}
            className={`rounded px-3 py-1 text-xs ${!mostrandoFijado ? 'bg-brand-500/15 text-brand-400' : 'text-slate-400'}`}
          >
            En vivo
          </button>
        </div>
        <button
          type="button"
          onClick={() => void fijar()}
          disabled={fijando}
          className="rounded border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-slate-500 disabled:opacity-50"
        >
          {fijando ? 'Fijando…' : 'Fijar el plan actual como el del día'}
        </button>
        <button
          type="button"
          onClick={() => pdf(activas, `lineas-sillon-${plan.hoy}.pdf`)}
          className="rounded bg-brand-500/20 px-3 py-1.5 text-xs text-brand-400 hover:bg-brand-500/30"
        >
          Descargar PDF (todas las líneas)
        </button>
        <label className="inline-flex items-center gap-2 text-xs text-slate-300">
          <input type="checkbox" checked={repartir} onChange={(e) => setRepartir(e.target.checked)} />
          Repartir las órdenes sin línea entre las líneas habilitadas
        </label>
        {error && <span className="text-xs text-rose-400">{error}</span>}
      </div>
      )}
      {pasado && (
        <button
          type="button"
          onClick={() => pdf(activas, `lineas-sillon-${plan.hoy}.pdf`)}
          className="rounded bg-brand-500/20 px-3 py-1.5 text-xs text-brand-400 hover:bg-brand-500/30"
        >
          Descargar PDF (todas las líneas)
        </button>
      )}
      {!mostrandoFijado && fijado && (
        <p className="text-xs text-amber-300">
          Estás viendo el plan en vivo: lo que ya se fabricó desde las {horaCorta(fijado.creadoEn)} no aparece y los horarios se recalculan.
        </p>
      )}

      {!pasado && (
      <div className="flex flex-wrap gap-2 text-xs">
        {sinResolverUnidades > 0 && (
          <span className="rounded border border-amber-500/30 bg-amber-500/5 px-2.5 py-1 text-amber-300">
            {sinResolverUnidades} unidades sin tiempo o sin equivalencia — se completan en "Equivalencias"
          </span>
        )}
        {plan.sinLinea.unidades > 0 && (
          <span className="rounded border border-slate-700 px-2.5 py-1 text-slate-400">
            {plan.sinLinea.unidades} unidades sin línea en Odoo{repartir ? ' (repartidas)' : ' (fuera del reporte)'}
          </span>
        )}
        {plan.enLineaApagada.unidades > 0 && (
          <span className="rounded border border-slate-700 px-2.5 py-1 text-slate-400">
            {plan.enLineaApagada.unidades} unidades en líneas apagadas ({apagadas.join(', ')})
          </span>
        )}
        {!config.disponible && (
          <span className="rounded border border-rose-500/30 bg-rose-500/5 px-2.5 py-1 text-rose-300">
            Las tablas de configuración no existen en Supabase: se usan valores por defecto y no se puede guardar.
          </span>
        )}
      </div>
      )}

      {!pasado && config.ignoradas && Object.keys(config.ignoradas).length > 0 && (
        <details className="rounded border border-slate-800 px-3 py-2 text-xs text-slate-400 print:hidden">
          <summary className="cursor-pointer">
            {Object.values(config.ignoradas).reduce((a, n) => a + n, 0)} unidades sacadas del plan (cerradas en la línea, abiertas en Odoo)
          </summary>
          <ul className="mt-2 space-y-1">
            {Object.entries(config.ignoradas).map(([orden, n]) => (
              <li key={orden} className="flex items-center gap-3">
                <span className="tabular-nums text-slate-300">{orden}</span>
                <span>× {n}</span>
                <button type="button" onClick={() => void ignorar(orden, -1)} className="text-brand-400 hover:underline">
                  Volver a incluir una
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => void restablecer()}
            className="mt-3 rounded border border-slate-700 px-3 py-1 text-slate-300 hover:border-slate-500"
          >
            Volver todo a la normalidad
          </button>
        </details>
      )}

      <datalist id={ID_LISTA}>
        {productosConTiempo.map((p) => (
          <option key={p.nombre} value={p.nombre} />
        ))}
      </datalist>
      {!pasado && !config.ajustesDisponible && (
        <p className="text-xs text-amber-300">
          Para armar las estaciones a mano falta crear la tabla lineas_sillon_ajustes en Supabase (el SQL está en src/lib/supabase/lineas-sillon.ts).
        </p>
      )}
      <p className={`text-xs text-slate-500 ${pasado ? 'hidden' : ''}`}>
        Las estaciones van escalonadas, como en la planilla: Carpintería hace lo planificado en Odoo, Tapicería arranca con su{' '}
        <span className="text-amber-300/90">sobrante de ayer</span> y sigue con lo de Carpintería, y Ensamble arranca con el suyo y sigue con lo de
        Tapicería. El sobrante se arrastra solo de un día al otro; si ayer no terminó como estaba planeado, corregilo arriba de la línea. Un{' '}
        <span className="text-rose-400">⚠</span> marca la unidad que la estación tendría que esperar porque la de arriba todavía no la entregó (los
        horarios son los de la planilla y no suman esa espera). Además, cada celda se puede
        cambiar a mano: elegí un producto del desplegable o dejala vacía, y los horarios de esa columna se recalculan solos.
      </p>
      <div className="grid gap-4">
        {activas.map((lp) => (
          <LineaCard
            key={lp.linea}
            lp={lp}
            nombres={nombres}
            validos={validos}
            editable={config.ajustesDisponible && !pasado}
            sobranteEditable={config.disponible && !pasado}
            onSobrante={(s) => void guardarSobrante(lp.linea, s)}
            onSobranteReset={() => void guardarSobrante(lp.linea, null)}
            onPdf={() => pdf([lp], `linea-${lp.linea}-${plan.hoy}.pdf`)}
            onIgnorar={(o) => void ignorar(o, 1)}
            onCeldas={(est, lista) => void celdas(lp.linea, est, lista)}
            onReset={(est) => void volverAutomatico(lp.linea, est)}
          />
        ))}
      </div>
      {activas.length === 0 && <p className="py-8 text-center text-sm text-slate-500">No hay líneas habilitadas.</p>}
    </div>
  );
}

function Inner() {
  const [vista, setVista] = useState<Vista>('reporte');
  const [repartir, setRepartir] = useState(false);
  const queryClient = useQueryClient();
  const query = useApiQuery<LineasSillonResponse>(['lineas-sillon', repartir], `/api/lineas-sillon${repartir ? '?repartir=1' : ''}`);
  const data = query.data;
  const refrescar = () => void queryClient.invalidateQueries({ queryKey: ['lineas-sillon'] });

  const tabs: { id: Vista; label: string }[] = [
    { id: 'reporte', label: 'Reporte de hoy' },
    { id: 'lineas', label: 'Líneas' },
    { id: 'personas', label: 'Personas' },
    { id: 'equivalencias', label: `Equivalencias${data && data.plan.sinResolver.length ? ` (${data.plan.sinResolver.length})` : ''}` },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div className="inline-flex w-fit rounded-lg border border-slate-800 bg-slate-900/60 p-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setVista(t.id)}
              className={`rounded px-3 py-1.5 text-xs ${vista === t.id ? 'bg-brand-500/15 text-brand-400' : 'text-slate-400 hover:text-slate-200'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <LastUpdated dataUpdatedAt={query.dataUpdatedAt} />
          <button
            type="button"
            onClick={() => void query.refetch()}
            disabled={query.isFetching}
            className="rounded border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-slate-500 disabled:opacity-50"
          >
            {query.isFetching ? 'Actualizando…' : 'Actualizar'}
          </button>
        </div>
      </div>

      {query.isLoading && <div className="h-40 w-full animate-pulse-slow rounded-lg bg-slate-800/60" />}
      {query.isError && !data && (
        <p className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-4 text-sm text-rose-300">{(query.error as Error).message}</p>
      )}

      {data && vista === 'reporte' && <Reporte data={data} repartir={repartir} setRepartir={setRepartir} onSaved={refrescar} />}
      {data && vista === 'lineas' && <LineasSillonLineas data={data} onSaved={refrescar} />}
      {data && vista === 'personas' && <LineasSillonPersonas data={data} onSaved={refrescar} />}
      {data && vista === 'equivalencias' && <LineasSillonEquivalencias data={data} onSaved={refrescar} />}
    </div>
  );
}

export default function LineasSillonApp() {
  return (
    <QueryProvider>
      <Inner />
    </QueryProvider>
  );
}
