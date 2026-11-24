import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import QueryProvider from '@/components/QueryProvider';
import { useApiQuery } from '@/components/dashboard/useApiQuery';
import AvisosPanel from './AvisosPanel';
import { ESTADO_SOLICITUD_TEXTO, pasosFaltantes, type EstadoSolicitud, type PasoAprobacion, type SolicitudRetiro } from '@/lib/rrhh-solicitudes';

interface Respuesta {
  tablaLista: boolean;
  errorTabla: string | null;
  solicitudes: SolicitudRetiro[];
  /** Con qué check puede decidir quien mira (dev: los dos; rrhh: el de RRHH; líder: el del líder). */
  yo: { usuario: string; puedeRrhh: boolean; puedeLider: boolean };
}

const NOMBRE_PASO: Record<PasoAprobacion, string> = { rrhh: 'RRHH', lider: 'líder' };

/** Los dos checks de una solicitud: quién los dio y cuál falta. */
function Checks({ s }: { s: SolicitudRetiro }) {
  const pasos: { paso: PasoAprobacion; por: string | null; en: string | null }[] = [
    { paso: 'rrhh', por: s.aproboRrhhPor, en: s.aproboRrhhEn },
    { paso: 'lider', por: s.aproboLiderPor, en: s.aproboLiderEn },
  ];
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {pasos.map(({ paso, por, en }) => (
        <span
          key={paso}
          title={por ? `Aprobó ${NOMBRE_PASO[paso]}: ${por}${en ? ' el ' + fmtCreada(en) : ''}` : `Falta el check de ${NOMBRE_PASO[paso]}`}
          className={`rounded-full px-2 py-0.5 text-xs ${por ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-700/60 text-slate-400'}`}
        >
          {por ? '✓' : '○'} {NOMBRE_PASO[paso]}
          {por ? `: ${por}` : ''}
        </span>
      ))}
    </span>
  );
}

const QUERY_KEY = ['rrhh-solicitudes'];

const COLOR: Record<EstadoSolicitud, string> = {
  pendiente: 'bg-amber-500/20 text-amber-300',
  aprobada: 'bg-emerald-500/20 text-emerald-300',
  rechazada: 'bg-rose-500/20 text-rose-300',
  cancelada: 'bg-slate-700/60 text-slate-400',
};

const fmtFecha = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('es-AR', { weekday: 'short', day: '2-digit', month: 'short' });
const fmtCreada = (iso: string) => new Date(iso).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

async function resolver(id: string, decision: 'aprobada' | 'rechazada', comentario: string, paso: PasoAprobacion): Promise<void> {
  const res = await fetch('/api/rrhh-solicitudes', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, decision, comentario: comentario || undefined, paso }),
  });
  const json = (await res.json()) as { ok: boolean; error?: string };
  if (!res.ok || !json.ok) throw new Error(json.error ?? 'No se pudo guardar la decisión.');
}

async function eliminar(id: string): Promise<void> {
  const res = await fetch('/api/rrhh-solicitudes', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
  const json = (await res.json()) as { ok: boolean; error?: string };
  if (!res.ok || !json.ok) throw new Error(json.error ?? 'No se pudo eliminar.');
}

function SolicitudesInner() {
  const queryClient = useQueryClient();
  const query = useApiQuery<Respuesta>(QUERY_KEY, '/api/rrhh-solicitudes');
  const [filtro, setFiltro] = useState<'pendiente' | 'todas'>('pendiente');
  const [comentarios, setComentarios] = useState<Record<string, string>>({});
  const [guardando, setGuardando] = useState<string | null>(null);
  const [abiertas, setAbiertas] = useState<Set<string>>(new Set());
  const [limite, setLimite] = useState(15);

  function alternarAbierta(id: string) {
    setAbiertas((previas) => {
      const nuevas = new Set(previas);
      if (nuevas.has(id)) nuevas.delete(id);
      else nuevas.add(id);
      return nuevas;
    });
  }
  const [error, setError] = useState<string | null>(null);

  // Si llega una solicitud mientras RRHH tiene la pestaña abierta, aparece sola (el aviso en vivo suena cada 30 s).
  useEffect(() => {
    const t = setInterval(() => void queryClient.invalidateQueries({ queryKey: QUERY_KEY }), 30_000);
    return () => clearInterval(t);
  }, [queryClient]);

  const solicitudes = query.data?.solicitudes ?? [];
  const pendientes = solicitudes.filter((s) => s.estado === 'pendiente').length;
  const visibles = useMemo(() => (filtro === 'pendiente' ? solicitudes.filter((s) => s.estado === 'pendiente') : solicitudes), [solicitudes, filtro]);

  const yo = query.data?.yo;
  /** Pasos que esta persona puede dar ahora: los que faltan, que su cuenta puede dar y que no choquen con que ella ya dio el otro. */
  function pasosDisponibles(s: SolicitudRetiro): PasoAprobacion[] {
    if (!yo) return [];
    const dioElOtro = (paso: PasoAprobacion) => (paso === 'rrhh' ? s.aproboLiderPor : s.aproboRrhhPor)?.toLowerCase() === yo.usuario.toLowerCase();
    return pasosFaltantes(s).filter((p) => (p === 'rrhh' ? yo.puedeRrhh : yo.puedeLider) && !dioElOtro(p));
  }

  async function decidir(s: SolicitudRetiro, decision: 'aprobada' | 'rechazada', paso: PasoAprobacion) {
    setGuardando(s.id);
    setError(null);
    try {
      await resolver(s.id, decision, comentarios[s.id] ?? '', paso);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGuardando(null);
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    }
  }

  async function borrar(s: SolicitudRetiro) {
    if (!window.confirm(`¿Eliminar la solicitud de ${s.empleadoNombre} del ${fmtFecha(s.fecha)}? No se puede deshacer.`)) return;
    setGuardando(s.id);
    setError(null);
    try {
      await eliminar(s.id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGuardando(null);
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    }
  }

  if (query.isLoading) return <p className="text-sm text-slate-400">Cargando...</p>;
  if (query.error) return <p className="rounded border border-red-900 bg-red-950/50 p-3 text-sm text-red-300">{(query.error as Error).message}</p>;

  if (query.data && !query.data.tablaLista) {
    return (
      <div className="rounded border border-amber-800 bg-amber-950/40 p-4 text-sm text-amber-200">
        <p className="font-semibold">Falta crear la tabla en Supabase.</p>
        <p className="mt-1">Corré el SQL de <code>docs/rrhh-solicitudes-retiro.sql</code> y después el de <code>docs/rrhh-solicitudes-doble-aprobacion.sql</code> en el SQL editor de Supabase y recargá.</p>
        {query.data.errorTabla && <p className="mt-2 text-xs opacity-80">{query.data.errorTabla}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <AvisosPanel />
      <div className="flex flex-wrap items-center gap-2">
        {(['pendiente', 'todas'] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFiltro(f)}
            className={`rounded-full border px-3 py-1.5 text-sm ${filtro === f ? 'border-brand-500 bg-brand-500/10 text-brand-300' : 'border-slate-700 text-slate-300 hover:bg-slate-800'}`}
          >
            {f === 'pendiente' ? `Pendientes (${pendientes})` : `Todas (${solicitudes.length})`}
          </button>
        ))}
      </div>

      {error && <p className="rounded border border-red-900 bg-red-950/50 p-3 text-sm text-red-300">{error}</p>}

      {visibles.length === 0 ? (
        <p className="rounded-lg border border-slate-800 bg-slate-900 p-6 text-center text-sm text-slate-400">
          {filtro === 'pendiente' ? 'No hay solicitudes pendientes.' : 'Todavía no hay solicitudes.'}
        </p>
      ) : (
        <>
          {/* Una fila por solicitud (nombre, día y hora, motivo, estado). Las resueltas se abren con un toque para ver el detalle; las pendientes ya vienen abiertas para decidir. */}
          <ul className="flex flex-col gap-1.5">
            {visibles.slice(0, limite).map((s) => {
              const pendiente = s.estado === 'pendiente';
              const abierta = pendiente || abiertas.has(s.id);
              return (
                <li key={s.id} className="rounded-lg border border-slate-800 bg-slate-900">
                  <div className="flex items-center gap-2 px-3 py-2">
                    <button
                      type="button"
                      aria-expanded={abierta}
                      onClick={() => alternarAbierta(s.id)}
                      className="grid min-w-0 flex-1 grid-cols-1 items-center gap-x-4 text-left sm:grid-cols-[13rem_9rem_minmax(0,1fr)]"
                    >
                      <span className="truncate text-sm font-semibold text-slate-100">{s.empleadoNombre}</span>
                      <span className="text-xs text-slate-300">
                        {fmtFecha(s.fecha)} · {s.horaRetiro} hs
                      </span>
                      <span className="truncate text-sm text-slate-400">{s.motivo}</span>
                    </button>
                    {pendiente ? <Checks s={s} /> : <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${COLOR[s.estado]}`}>{ESTADO_SOLICITUD_TEXTO[s.estado]}</span>}
                    {!pendiente && s.estado === 'aprobada' && <Checks s={s} />}
                    <button
                      type="button"
                      disabled={guardando === s.id}
                      onClick={() => void borrar(s)}
                      className="shrink-0 rounded border border-slate-700 px-2 py-0.5 text-xs text-slate-400 hover:border-red-500 hover:text-red-400 disabled:opacity-50"
                    >
                      Eliminar
                    </button>
                  </div>

                  {abierta && (
                    <div className="flex flex-col gap-2 border-t border-slate-800 px-3 py-2.5">
                      <p className="whitespace-pre-wrap text-sm text-slate-200">{s.motivo}</p>
                      <p className="text-xs text-slate-500">
                        Pedida el {fmtCreada(s.creadaEn)}
                        {!pendiente && (
                          <>
                            {' · '}
                            {s.estado === 'cancelada' ? 'Cancelada por el empleado' : `${ESTADO_SOLICITUD_TEXTO[s.estado]} por ${s.resueltaPor ?? '—'}`}
                            {s.resueltaEn ? ` el ${fmtCreada(s.resueltaEn)}` : ''}
                            {s.comentarioRrhh ? ` · RRHH: "${s.comentarioRrhh}"` : ''}
                            {s.comentarioLider ? ` · Líder: "${s.comentarioLider}"` : ''}
                          </>
                        )}
                      </p>
                      {pendiente && (() => {
                        const pasos = pasosDisponibles(s);
                        if (pasos.length === 0) {
                          return (
                            <p className="text-xs text-slate-400">
                              {pasosFaltantes(s).length === 0
                                ? 'Esperando…'
                                : `Falta el check de ${pasosFaltantes(s).map((p) => NOMBRE_PASO[p]).join(' y ')}. ${yo && (yo.puedeRrhh || yo.puedeLider) ? 'Ese paso lo tiene que dar otra persona.' : ''}`}
                            </p>
                          );
                        }
                        return (
                          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                            <input
                              type="text"
                              value={comentarios[s.id] ?? ''}
                              onChange={(e) => setComentarios((c) => ({ ...c, [s.id]: e.target.value }))}
                              placeholder="Comentario para el empleado (opcional)"
                              maxLength={500}
                              className="flex-1 rounded border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-100 placeholder:text-slate-500"
                            />
                            {pasos.map((p) => (
                              <button
                                key={p}
                                type="button"
                                disabled={guardando === s.id}
                                onClick={() => void decidir(s, 'aprobada', p)}
                                title={`Da el check de ${NOMBRE_PASO[p]}. La solicitud queda aprobada cuando están los dos checks, de dos personas distintas.`}
                                className="rounded bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                              >
                                {pasos.length > 1 ? `Aprobar como ${NOMBRE_PASO[p]}` : 'Aprobar'}
                              </button>
                            ))}
                            <button
                              type="button"
                              disabled={guardando === s.id}
                              onClick={() => void decidir(s, 'rechazada', pasos[0]!)}
                              title="Con que uno rechace alcanza: la solicitud queda rechazada."
                              className="rounded bg-rose-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50"
                            >
                              Rechazar
                            </button>
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          {visibles.length > limite && (
            <button type="button" onClick={() => setLimite((l) => l + 20)} className="self-center rounded-full border border-slate-700 px-4 py-1.5 text-sm text-slate-300 hover:bg-slate-800">
              Ver {Math.min(20, visibles.length - limite)} más ({visibles.length - limite} restantes)
            </button>
          )}
        </>
      )}
    </div>
  );
}

export default function SolicitudesApp() {
  return (
    <QueryProvider>
      <SolicitudesInner />
    </QueryProvider>
  );
}
