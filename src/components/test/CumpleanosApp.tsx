import { useMemo, useState } from 'react';
import QueryProvider from '@/components/QueryProvider';
import { useApiQuery } from '@/components/dashboard/useApiQuery';
import LastUpdated from '@/components/shared/LastUpdated';

interface UpcomingBirthday {
  id: number;
  nombre: string;
  departamento: string | null;
  puesto: string | null;
  proximaFecha: string;
  fechaNacimiento: string;
  diasRestantes: number;
  edadQueCumple: number;
  esHoy: boolean;
}

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

function formatFecha(iso: string): string {
  const [, m, d] = iso.split('-').map(Number);
  return `${d} de ${MESES[m! - 1]}`;
}

function diasLabel(dias: number): string {
  if (dias === 0) return 'Hoy';
  if (dias === 1) return 'Mañana';
  return `En ${dias} días`;
}

type Orden = 'proximos' | 'edad-desc' | 'edad-asc';

/** Edad actual: si hoy es el cumpleaños ya la cumplió, si no todavía tiene una menos. */
function edadActual(e: UpcomingBirthday): number {
  return e.esHoy ? e.edadQueCumple : e.edadQueCumple - 1;
}

function CumpleanosInner() {
  const [busqueda, setBusqueda] = useState('');
  const [soloProximos, setSoloProximos] = useState(true);
  const [orden, setOrden] = useState<Orden>('proximos');
  const porEdad = orden !== 'proximos';

  const query = useApiQuery<UpcomingBirthday[]>(['cumpleanos'], '/api/cumpleanos');
  const data = query.data ?? [];

  const filtrados = useMemo(() => {
    const texto = busqueda.trim().toLowerCase();
    const lista = data.filter((e) => {
      if (!porEdad && soloProximos && e.diasRestantes > 30) return false;
      if (!texto) return true;
      return (
        e.nombre.toLowerCase().includes(texto) ||
        (e.departamento ?? '').toLowerCase().includes(texto)
      );
    });
    if (porEdad) {
      // Fecha de nacimiento ISO (YYYY-MM-DD): ordenar el string ordena por edad exacta.
      lista.sort((a, b) =>
        orden === 'edad-desc'
          ? a.fechaNacimiento.localeCompare(b.fechaNacimiento)
          : b.fechaNacimiento.localeCompare(a.fechaNacimiento),
      );
    }
    return lista;
  }, [data, busqueda, soloProximos, orden, porEdad]);

  // En modo edad va todo a la tabla, sin separar los de hoy.
  const hoy = porEdad ? [] : filtrados.filter((e) => e.esHoy);
  const resto = porEdad ? filtrados : filtrados.filter((e) => !e.esHoy);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <label className="flex flex-col gap-1 text-sm text-slate-300">
          Buscar
          <input
            type="text"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Nombre o departamento..."
            className="min-w-[16rem] rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-100 placeholder:text-slate-500 focus:border-brand-500 focus:outline-none"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm text-slate-300">
          Ordenar por
          <select
            value={orden}
            onChange={(e) => setOrden(e.target.value as Orden)}
            className="rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-100 focus:border-brand-500 focus:outline-none"
          >
            <option value="proximos">Próximo cumpleaños</option>
            <option value="edad-desc">Edad (mayor a menor)</option>
            <option value="edad-asc">Edad (menor a mayor)</option>
          </select>
        </label>

        <label className={`flex items-center gap-2 text-sm ${porEdad ? 'text-slate-600' : 'text-slate-300'}`}>
          <input
            type="checkbox"
            disabled={porEdad}
            checked={soloProximos && !porEdad}
            onChange={(e) => setSoloProximos(e.target.checked)}
            className="h-4 w-4 rounded border-slate-600 bg-slate-950 text-brand-500 focus:ring-brand-500"
          />
          Solo próximos 30 días
        </label>

        <LastUpdated dataUpdatedAt={query.dataUpdatedAt} />
      </div>

      {query.isError && (
        <p className="rounded border border-red-900 bg-red-950/50 p-3 text-sm text-red-300">
          No se pudieron cargar los datos: {(query.error as Error).message}
        </p>
      )}

      {query.isLoading ? (
        <div className="h-64 w-full animate-pulse-slow rounded-lg bg-slate-800/60" />
      ) : (
        <>
          {!query.isLoading && (
            <p className="text-sm text-slate-400">
              <span className="font-medium text-slate-200">{filtrados.length}</span> empleado
              {filtrados.length === 1 ? '' : 's'} {porEdad
                ? 'en total, ordenados por edad'
                : soloProximos
                  ? 'con cumpleaños en los próximos 30 días'
                  : 'en total'}.
            </p>
          )}

          {hoy.length > 0 && (
            <section className="flex flex-col gap-3 rounded-lg border border-accent-amber/40 bg-amber-500/10 p-4">
              <h3 className="text-sm font-semibold text-accent-amber">🎂 Cumplen hoy</h3>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {hoy.map((e) => (
                  <div key={e.id} className="rounded border border-amber-500/30 bg-slate-900/60 px-3 py-2">
                    <p className="font-medium text-slate-100">{e.nombre}</p>
                    <p className="text-xs text-slate-400">
                      {e.departamento ?? 'Sin departamento'} · Cumple {e.edadQueCumple}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-950/60 text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-4 py-3">Empleado</th>
                  <th className="px-4 py-3">Departamento</th>
                  <th className="px-4 py-3">Puesto</th>
                  <th className="px-4 py-3">Fecha</th>
                  <th className="px-4 py-3">Edad</th>
                  <th className="px-4 py-3">Cumple</th>
                  <th className="px-4 py-3 text-right">Faltan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {resto.map((e) => (
                  <tr key={e.id} className="hover:bg-slate-800/40">
                    <td className="px-4 py-2.5 font-medium text-slate-100">{e.nombre}</td>
                    <td className="px-4 py-2.5 text-slate-300">{e.departamento ?? '—'}</td>
                    <td className="px-4 py-2.5 text-slate-300">{e.puesto ?? '—'}</td>
                    <td className="px-4 py-2.5 text-slate-300">{formatFecha(e.proximaFecha)}</td>
                    <td className="px-4 py-2.5 text-slate-300">{edadActual(e)}</td>
                    <td className="px-4 py-2.5 text-slate-300">{e.edadQueCumple} años</td>
                    <td className="px-4 py-2.5 text-right text-slate-300">{diasLabel(e.diasRestantes)}</td>
                  </tr>
                ))}
                {resto.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-center text-slate-500">
                      No hay empleados que coincidan con el filtro.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>
        </>
      )}
    </div>
  );
}

/** Entry point mounted as an Astro client island (`client:only="react"`), same pattern as the other tabs. */
export default function CumpleanosApp() {
  return (
    <QueryProvider>
      <CumpleanosInner />
    </QueryProvider>
  );
}
