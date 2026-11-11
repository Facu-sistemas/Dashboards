import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import QueryProvider from '@/components/QueryProvider';
import { useApiQuery } from '@/components/dashboard/useApiQuery';
import LastUpdated from '@/components/shared/LastUpdated';
import type { LineaPlan } from '@/lib/lineas-sillon/plan';
import { filasDeHoy, type EstacionId } from '@/lib/lineas-sillon/engine';
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
  editable,
  validos,
  onCambio,
}: {
  valor: string;
  hora: string;
  manana: boolean;
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
      <span className={`w-[4.5rem] shrink-0 text-right text-xs tabular-nums ${manana ? 'text-amber-500/70' : 'text-slate-400'}`} title={manana ? 'Termina mañana' : undefined}>
        {valor ? (manana ? 'mañana' : hora) : ''}
      </span>
    </div>
  );
}

function LineaCard({
  lp,
  nombres,
  validos,
  editable,
  onPdf,
  onIgnorar,
  onCeldas,
  onReset,
}: {
  lp: LineaPlan;
  nombres: Map<string, string>;
  validos: Set<string>;
  editable: boolean;
  onPdf: () => void;
  onIgnorar: (orden: string) => void;
  onCeldas: (estacion: EstacionId, celdas: (string | null)[]) => void;
  onReset: (estacion: EstacionId) => void;
}) {
  const [carp] = lp.estaciones;
  const reales = filasDeHoy(lp.estaciones);
  const total = Math.min(150, reales + FILAS_EXTRA);
  const asignados = SLOTS_UI.map((s) => ({ ...s, nombre: lp.config.asignados[s.slot] ? nombres.get(lp.config.asignados[s.slot]!) : undefined }));
  const editadas = lp.editadas ?? []; // los planes fijados antes de este cambio no traen el campo
  const hayEditadas = editadas.length > 0;

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
  const [vista, setVista] = useState<'fijado' | 'vivo'>(fijado ? 'fijado' : 'vivo');
  const [error, setError] = useState('');
  const [fijando, setFijando] = useState(false);
  const mostrandoFijado = vista === 'fijado' && fijado !== null;
  const plan = mostrandoFijado ? fijado.plan : data.plan;
  const nombres = new Map(config.personas.map((p) => [p.id, p.nombre]));
  const activas = plan.lineas.filter((l) => l.config.activa);
  const apagadas = plan.lineas.filter((l) => !l.config.activa).map((l) => l.linea);
  const productosConTiempo = plan.productos.filter((p) => p.minutos);
  const validos = new Set(productosConTiempo.map((p) => p.nombre));
  const sinResolverUnidades = plan.sinResolver.reduce((a, r) => a + r.unidades, 0);

  const pie = mostrandoFijado
    ? `Plan fijado a las ${horaCorta(fijado.creadoEn)} (${fijado.creadoPor})`
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

  return (
    <div className="space-y-4">
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
      {!mostrandoFijado && fijado && (
        <p className="text-xs text-amber-300">
          Estás viendo el plan en vivo: lo que ya se fabricó desde las {horaCorta(fijado.creadoEn)} no aparece y los horarios se recalculan.
        </p>
      )}

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

      {config.ignoradas && Object.keys(config.ignoradas).length > 0 && (
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
      {!config.ajustesDisponible && (
        <p className="text-xs text-amber-300">
          Para armar las estaciones a mano falta crear la tabla lineas_sillon_ajustes en Supabase (el SQL está en src/lib/supabase/lineas-sillon.ts).
        </p>
      )}
      <p className="text-xs text-slate-500">
        Cada estación se puede armar por separado: elegí un producto del desplegable o dejá la celda vacía, y los horarios de esa columna se recalculan solos.
      </p>
      <div className="grid gap-4">
        {activas.map((lp) => (
          <LineaCard
            key={lp.linea}
            lp={lp}
            nombres={nombres}
            validos={validos}
            editable={config.ajustesDisponible}
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

      {data && vista === 'reporte' && (
        <h3 className="text-base font-semibold capitalize text-slate-100">Producción — {fechaLarga(data.plan.hoy)}</h3>
      )}

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
