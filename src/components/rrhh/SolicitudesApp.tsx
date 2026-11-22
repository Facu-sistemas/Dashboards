import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import QueryProvider from '@/components/QueryProvider';
import { useApiQuery } from '@/components/dashboard/useApiQuery';
import { ESTADO_SOLICITUD_TEXTO, type EstadoSolicitud, type SolicitudRetiro } from '@/lib/rrhh-solicitudes';

interface Respuesta {
  tablaLista: boolean;
  errorTabla: string | null;
  solicitudes: SolicitudRetiro[];
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

async function resolver(id: string, decision: 'aprobada' | 'rechazada', comentario: string): Promise<void> {
  const res = await fetch('/api/rrhh-solicitudes', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, decision, comentario: comentario || undefined }),
  });
  const json = (await res.json()) as { ok: boolean; error?: string };
  if (!res.ok || !json.ok) throw new Error(json.error ?? 'No se pudo guardar la decisión.');
}

function SolicitudesInner() {
  const queryClient = useQueryClient();
  const query = useApiQuery<Respuesta>(QUERY_KEY, '/api/rrhh-solicitudes');
  const [filtro, setFiltro] = useState<'pendiente' | 'todas'>('pendiente');
  const [comentarios, setComentarios] = useState<Record<string, string>>({});
  const [guardando, setGuardando] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const solicitudes = query.data?.solicitudes ?? [];
  const pendientes = solicitudes.filter((s) => s.estado === 'pendiente').length;
  const visibles = useMemo(() => (filtro === 'pendiente' ? solicitudes.filter((s) => s.estado === 'pendiente') : solicitudes), [solicitudes, filtro]);

  async function decidir(s: SolicitudRetiro, decision: 'aprobada' | 'rechazada') {
    setGuardando(s.id);
    setError(null);
    try {
      await resolver(s.id, decision, comentarios[s.id] ?? '');
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
        <p className="mt-1">Corré el SQL de <code>docs/rrhh-solicitudes-retiro.sql</code> en el SQL editor de Supabase y recargá.</p>
        {query.data.errorTabla && <p className="mt-2 text-xs opacity-80">{query.data.errorTabla}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
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
        <ul className="flex flex-col gap-3">
          {visibles.map((s) => (
            <li key={s.id} className="rounded-lg border border-slate-800 bg-slate-900 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-slate-100">{s.empleadoNombre}</p>
                  <p className="text-sm text-slate-300">
                    Se retira el <span className="font-medium">{fmtFecha(s.fecha)}</span> a las <span className="font-medium">{s.horaRetiro} hs</span>
                  </p>
                </div>
                <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${COLOR[s.estado]}`}>{ESTADO_SOLICITUD_TEXTO[s.estado]}</span>
              </div>
              <p className="mt-2 whitespace-pre-wrap rounded bg-slate-800/60 p-3 text-sm text-slate-200">{s.motivo}</p>
              <p className="mt-2 text-xs text-slate-500">Pedida el {fmtCreada(s.creadaEn)}</p>

              {s.estado === 'pendiente' ? (
                <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                  <input
                    type="text"
                    value={comentarios[s.id] ?? ''}
                    onChange={(e) => setComentarios((c) => ({ ...c, [s.id]: e.target.value }))}
                    placeholder="Comentario para el empleado (opcional)"
                    maxLength={500}
                    className="flex-1 rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
                  />
                  <button
                    type="button"
                    disabled={guardando === s.id}
                    onClick={() => void decidir(s, 'aprobada')}
                    className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    Aprobar
                  </button>
                  <button
                    type="button"
                    disabled={guardando === s.id}
                    onClick={() => void decidir(s, 'rechazada')}
                    className="rounded bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50"
                  >
                    Rechazar
                  </button>
                </div>
              ) : (
                <p className="mt-2 text-xs text-slate-400">
                  {s.estado === 'cancelada' ? 'Cancelada por el empleado' : `${ESTADO_SOLICITUD_TEXTO[s.estado]} por ${s.resueltaPor ?? '—'}`}
                  {s.resueltaEn ? ` el ${fmtCreada(s.resueltaEn)}` : ''}
                  {s.comentarioRrhh ? ` · "${s.comentarioRrhh}"` : ''}
                </p>
              )}
            </li>
          ))}
        </ul>
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
