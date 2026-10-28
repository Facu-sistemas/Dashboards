import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import QueryProvider from '@/components/QueryProvider';
import { useApiQuery } from '@/components/dashboard/useApiQuery';
import { ESTADOS_RESUMEN, type EstadoResumen } from '@/lib/rrhh-resumen-estado';

interface Empleado {
  id: number;
  nombre: string;
  departamento: string | null;
  puesto: string | null;
  estado: EstadoResumen;
}

interface Respuesta {
  tablaLista: boolean;
  errorTabla: string | null;
  empleados: Empleado[];
}

const QUERY_KEY = ['rrhh-resumen-estados'];

const SQL_TABLA = `create table if not exists public.rrhh_resumen_estado (
  empleado_id integer primary key,
  estado text not null check (estado in ('reporte_perfecto', 'ignorar')),
  empleado_nombre text,
  actualizado_por text,
  actualizado_en timestamptz not null default now()
);
alter table public.rrhh_resumen_estado enable row level security;
revoke all on public.rrhh_resumen_estado from anon, authenticated;
grant all on public.rrhh_resumen_estado to service_role;`;

const COLOR_ESTADO: Record<EstadoResumen, string> = {
  normal: 'border-slate-700 text-slate-200',
  reporte_perfecto: 'border-emerald-700 bg-emerald-500/10 text-emerald-300',
  ignorar: 'border-rose-800 bg-rose-500/10 text-rose-300',
};

async function guardar(emp: Empleado, estado: EstadoResumen): Promise<void> {
  const res = await fetch('/api/rrhh-resumen-estados', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ empleadoId: emp.id, empleadoNombre: emp.nombre, estado }),
  });
  const json = (await res.json()) as { ok: boolean; error?: string };
  if (!res.ok || !json.ok) throw new Error(json.error ?? 'No se pudo guardar el cambio.');
}

function AdministracionInner() {
  const queryClient = useQueryClient();
  const query = useApiQuery<Respuesta>(QUERY_KEY, '/api/rrhh-resumen-estados');
  const [busqueda, setBusqueda] = useState('');
  const [filtro, setFiltro] = useState<'todos' | EstadoResumen>('todos');
  const [guardando, setGuardando] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const empleados = query.data?.empleados ?? [];

  const conteo = useMemo(() => {
    const c: Record<EstadoResumen, number> = { normal: 0, reporte_perfecto: 0, ignorar: 0 };
    for (const e of empleados) c[e.estado] += 1;
    return c;
  }, [empleados]);

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return empleados.filter((e) => {
      if (filtro !== 'todos' && e.estado !== filtro) return false;
      if (!q) return true;
      return e.nombre.toLowerCase().includes(q) || (e.departamento ?? '').toLowerCase().includes(q) || (e.puesto ?? '').toLowerCase().includes(q);
    });
  }, [empleados, busqueda, filtro]);

  function actualizarLocal(id: number, estado: EstadoResumen) {
    queryClient.setQueryData<Respuesta>(QUERY_KEY, (d) => (d ? { ...d, empleados: d.empleados.map((e) => (e.id === id ? { ...e, estado } : e)) } : d));
  }

  // Actualización optimista: se ve el cambio al instante y se revierte si el servidor lo rechaza.
  async function cambiar(emp: Empleado, estado: EstadoResumen) {
    if (estado === emp.estado) return;
    setError(null);
    actualizarLocal(emp.id, estado);
    setGuardando((prev) => new Set(prev).add(emp.id));
    try {
      await guardar(emp, estado);
    } catch (err) {
      actualizarLocal(emp.id, emp.estado);
      setError(`${emp.nombre}: ${err instanceof Error ? err.message : 'No se pudo guardar el cambio.'}`);
    } finally {
      setGuardando((prev) => {
        const next = new Set(prev);
        next.delete(emp.id);
        return next;
      });
    }
  }

  const selectClass = 'rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-100 focus:border-brand-500 focus:outline-none';

  return (
    <div className="flex flex-col gap-6">
      {query.data && !query.data.tablaLista && (
        <section className="flex flex-col gap-2 rounded-lg border border-amber-700/50 bg-amber-500/10 p-4 text-sm text-amber-200">
          <p className="font-medium">Falta crear la tabla en Supabase.</p>
          <p>
            Hasta que se corra este SQL, los estados no se pueden guardar y el Resumen se ve como siempre. Copialo y pegalo en el SQL editor
            de Supabase:
          </p>
          <pre className="overflow-x-auto rounded bg-slate-950 p-3 text-xs text-slate-200">{SQL_TABLA}</pre>
          {query.data.errorTabla && <p className="text-xs text-amber-300/80">Detalle: {query.data.errorTabla}</p>}
        </section>
      )}

      {query.isError && (
        <p className="rounded border border-red-900 bg-red-950/50 p-3 text-sm text-red-300">
          No se pudieron cargar los empleados: {(query.error as Error).message}
        </p>
      )}
      {error && <p className="rounded border border-red-900 bg-red-950/50 p-3 text-sm text-red-300">{error}</p>}

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {ESTADOS_RESUMEN.map((e) => (
          <div key={e.value} className="rounded-lg border border-slate-800 bg-slate-900 p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">{e.label}</p>
            <p className="mt-1 text-2xl font-semibold text-slate-100">{query.isLoading ? '…' : conteo[e.value]}</p>
            <p className="mt-0.5 text-xs text-slate-500">{e.descripcion}</p>
          </div>
        ))}
      </section>

      <div className="flex flex-wrap items-end gap-4 rounded-lg border border-slate-800 bg-slate-900 p-4 text-sm text-slate-300">
        <label className="flex flex-col gap-1">
          Buscar
          <input
            type="text"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Nombre, puesto o departamento"
            className={`w-64 placeholder:text-slate-600 ${selectClass}`}
          />
        </label>
        <label className="flex flex-col gap-1">
          Mostrar
          <select value={filtro} onChange={(e) => setFiltro(e.target.value as 'todos' | EstadoResumen)} className={`min-w-[11rem] ${selectClass}`}>
            <option value="todos">Todos</option>
            {ESTADOS_RESUMEN.map((e) => (
              <option key={e.value} value={e.value}>
                {e.label}
              </option>
            ))}
          </select>
        </label>
        <p className="ml-auto text-xs text-slate-500">
          {query.isLoading ? '' : `${visibles.length} de ${empleados.length} empleados`}
        </p>
      </div>

      {query.isLoading ? (
        <div className="h-64 w-full animate-pulse-slow rounded-lg bg-slate-800/60" />
      ) : visibles.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-500">Ningún empleado coincide con el filtro.</p>
      ) : (
        <ul className="divide-y divide-slate-800 overflow-hidden rounded-lg border border-slate-800 bg-slate-900">
          {visibles.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-100">{e.nombre}</p>
                <p className="truncate text-xs text-slate-500">{[e.puesto, e.departamento].filter(Boolean).join(' · ') || '—'}</p>
              </div>
              <select
                value={e.estado}
                disabled={guardando.has(e.id) || (query.data ? !query.data.tablaLista : true)}
                onChange={(ev) => void cambiar(e, ev.target.value as EstadoResumen)}
                className={`min-w-[10.5rem] rounded border px-2 py-1.5 text-sm focus:border-brand-500 focus:outline-none disabled:opacity-60 ${COLOR_ESTADO[e.estado]} bg-slate-950`}
                aria-label={`Estado de ${e.nombre} en el Resumen`}
              >
                {ESTADOS_RESUMEN.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Entry point mounted as an Astro client island (`client:load`), same pattern as the other tabs. */
export default function AdministracionApp() {
  return (
    <QueryProvider>
      <AdministracionInner />
    </QueryProvider>
  );
}
