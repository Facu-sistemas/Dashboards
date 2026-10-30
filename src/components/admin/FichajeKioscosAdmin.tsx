import { useState } from 'react';
import type { MarcaFichaje, UltimasDePersona } from '@/lib/supabase/fichaje-marcas';

interface Props {
  marcas: MarcaFichaje[];
  /** Por persona: dónde y cuándo fue su última entrada y su última salida. */
  ultimas: UltimasDePersona[];
  /** username → nombre completo de la cuenta (sirve como nombre de la ubicación, p. ej. "Entrada principal"). */
  nombresKioscos: Record<string, string>;
  /** Mensaje de Supabase si no se pudo leer la tabla (no existe, falta un permiso, etc.). */
  error: string | null;
}

const MAX_FILAS = 60;
const FORMATO_FECHA = new Intl.DateTimeFormat('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const FORMATO_DIA = new Intl.DateTimeFormat('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit' });

function hace(iso: string): string {
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (min < 1) return 'recién';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.floor(h / 24)} d`;
}

/**
 * Fichadas por kiosco (cuenta de celular): cuántas hizo cada uno hoy y cuándo fue su última actividad, más el listado
 * de las últimas marcas. Sirve para ver dónde ficha la gente y para notar un celular que dejó de responder en horario laboral.
 */
export default function FichajeKioscosAdmin({ marcas, ultimas, nombresKioscos, error }: Props) {
  const [filtro, setFiltro] = useState<string>('todos');
  const [busqueda, setBusqueda] = useState('');

  const hoy = FORMATO_DIA.format(new Date());
  const porKiosco = new Map<string, { total: number; hoy: number; ultima: string }>();
  for (const m of marcas) {
    const k = porKiosco.get(m.kiosco) ?? { total: 0, hoy: 0, ultima: m.marcadoEn };
    k.total += 1;
    if (FORMATO_DIA.format(new Date(m.marcadoEn)) === hoy) k.hoy += 1;
    if (m.marcadoEn > k.ultima) k.ultima = m.marcadoEn;
    porKiosco.set(m.kiosco, k);
  }
  const kioscos = [...porKiosco.entries()].sort((a, b) => b[1].ultima.localeCompare(a[1].ultima));
  const nombre = (username: string) => nombresKioscos[username] || username;

  const texto = busqueda.trim().toLowerCase();
  const personas = texto ? ultimas.filter((p) => p.empleadoNombre.toLowerCase().includes(texto)) : ultimas;
  const celda = (m: UltimasDePersona['entrada']) =>
    m ? (
      <>
        <span className="text-slate-200">{nombre(m.kiosco)}</span> <span className="font-mono text-xs text-slate-500">{FORMATO_FECHA.format(new Date(m.marcadoEn))}</span>
      </>
    ) : (
      <span className="text-slate-600">—</span>
    );

  const visibles = (filtro === 'todos' ? marcas : marcas.filter((m) => m.kiosco === filtro)).slice(0, MAX_FILAS);

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-sm font-medium text-slate-300">Fichadas por kiosco (Fichaje)</h2>
        <p className="mt-1 text-xs text-slate-500">
          Cada fichada guarda con qué cuenta de celular se hizo. Como nombre de la ubicación se muestra el «nombre completo» de la cuenta (si no tiene,
          el usuario). Se registra desde que se activó esta función; las fichadas anteriores no tienen kiosco.
        </p>
      </div>

      {error ? (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-4 text-sm text-amber-200">
          No se pudo leer la tabla <code>fichaje_marcas</code>: {error}. El SQL de la tabla y sus permisos está en{' '}
          <code>src/lib/supabase/fichaje-marcas.ts</code>.
        </p>
      ) : marcas.length === 0 ? (
        <p className="rounded-lg border border-slate-800 bg-slate-900 px-4 py-6 text-center text-sm text-slate-500">Todavía no hay fichadas registradas.</p>
      ) : (
        <>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {kioscos.map(([username, k]) => (
              <button
                key={username}
                type="button"
                onClick={() => setFiltro(filtro === username ? 'todos' : username)}
                className={`rounded-lg border px-4 py-3 text-left transition-colors ${
                  filtro === username ? 'border-brand-500 bg-slate-800' : 'border-slate-800 bg-slate-900 hover:border-slate-700'
                }`}
              >
                <p className="text-sm font-medium text-slate-100">{nombre(username)}</p>
                {nombre(username) !== username && <p className="text-[11px] text-slate-500">{username}</p>}
                <p className="mt-1 text-xs text-slate-400">
                  {k.hoy} hoy · última {hace(k.ultima)}
                </p>
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-medium text-slate-300">Última entrada y última salida por persona</h3>
              <input
                type="search"
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Buscar persona…"
                className="rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-100 placeholder:text-slate-500"
              />
            </div>
            <div className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-900">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-800 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-2 font-medium">Persona</th>
                    <th className="px-4 py-2 font-medium text-emerald-400">Última entrada</th>
                    <th className="px-4 py-2 font-medium text-red-400">Última salida</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {personas.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="px-4 py-6 text-center text-slate-500">
                        Nadie coincide con la búsqueda.
                      </td>
                    </tr>
                  ) : (
                    personas.map((p) => (
                      <tr key={p.empleadoId}>
                        <td className="px-4 py-2 text-slate-100">{p.empleadoNombre}</td>
                        <td className="px-4 py-2">{celda(p.entrada)}</td>
                        <td className="px-4 py-2">{celda(p.salida)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-slate-500">{ultimas.length} personas con fichadas registradas desde que se activó esta función.</p>
          </div>

          <details className="group">
            <summary className="cursor-pointer text-sm text-slate-400 hover:text-slate-200">Ver historial de fichadas</summary>
            <div className="mt-2 flex flex-col gap-2">
            <div className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900">
              <ul className="divide-y divide-slate-800">
                {visibles.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
                    <p className="text-sm text-slate-100">{m.empleadoNombre}</p>
                    <div className="flex items-center gap-2 text-xs">
                      <span className={`rounded px-1.5 py-0.5 uppercase tracking-wide ${m.accion === 'entrada' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
                        {m.accion}
                      </span>
                      <span className="text-slate-400">{nombre(m.kiosco)}</span>
                      <span className="font-mono text-slate-500">{FORMATO_FECHA.format(new Date(m.marcadoEn))}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
            <p className="text-xs text-slate-500">
              {filtro === 'todos' ? 'Últimas fichadas de todos los kioscos.' : `Fichadas de ${nombre(filtro)} (tocá de nuevo la tarjeta para ver todas).`} Se muestran hasta{' '}
              {MAX_FILAS}; el resumen usa las últimas {marcas.length}.
            </p>
            </div>
          </details>
        </>
      )}
    </section>
  );
}
