import { Fragment, useMemo, useState } from 'react';
import QueryProvider from '@/components/QueryProvider';
import { useApiQuery } from '@/components/dashboard/useApiQuery';
import LastUpdated from '@/components/shared/LastUpdated';

interface PermisoGrupo {
  id: number;
  nombre: string;
  categoria: string;
}

interface UsuarioOdoo {
  id: number;
  nombre: string;
  login: string;
  activo: boolean;
  ultimoLogin: string | null;
  grupoIds: number[];
  accesos: Record<string, string[]>;
}

interface PermisosUsuarios {
  usuarios: UsuarioOdoo[];
  grupos: PermisoGrupo[];
  aplicaciones: string[];
}

type Vista = 'matriz' | 'grupos';

const SIN_APLICACION = 'Sin aplicación';

/** Niveles altos (Administrador, Gerente...) resaltados para que se vea de un vistazo quién manda en cada app. */
function esNivelAlto(nombre: string): boolean {
  return /admin|gerente|manager|responsable/i.test(nombre);
}

function Celda({ niveles }: { niveles: string[] | undefined }) {
  if (!niveles || niveles.length === 0) return <span className="text-slate-600">—</span>;
  return (
    <div className="flex flex-col gap-1">
      {niveles.map((n) => (
        <span
          key={n}
          className={`w-fit rounded px-1.5 py-0.5 text-xs ${
            esNivelAlto(n) ? 'bg-amber-500/15 font-medium text-accent-amber' : 'bg-slate-800 text-slate-200'
          }`}
        >
          {n}
        </span>
      ))}
    </div>
  );
}

function PermisosInner() {
  const [vista, setVista] = useState<Vista>('matriz');
  const [busqueda, setBusqueda] = useState('');
  const [soloActivos, setSoloActivos] = useState(true);
  const [soloAltos, setSoloAltos] = useState(false);
  const [conTecnicos, setConTecnicos] = useState<number | null>(null);

  const query = useApiQuery<PermisosUsuarios>(['permisos-odoo'], '/api/permisos-odoo');
  const usuarios = query.data?.usuarios ?? [];
  const grupos = query.data?.grupos ?? [];
  const aplicaciones = query.data?.aplicaciones ?? [];

  const grupoPorId = useMemo(() => new Map(grupos.map((g) => [g.id, g])), [grupos]);
  const texto = busqueda.trim().toLowerCase();

  const usuariosFiltrados = useMemo(
    () =>
      usuarios.filter((u) => {
        if (soloActivos && !u.activo) return false;
        if (!texto) return true;
        return (
          u.nombre.toLowerCase().includes(texto) ||
          u.login.toLowerCase().includes(texto) ||
          Object.entries(u.accesos).some(([app, niv]) => app.toLowerCase().includes(texto) || niv.some((n) => n.toLowerCase().includes(texto)))
        );
      }),
    [usuarios, soloActivos, texto]
  );

  // Con "solo niveles altos" se ocultan las apps donde ninguna cuenta visible tiene nivel alto.
  const appsVisibles = useMemo(() => {
    if (!soloAltos) return aplicaciones;
    return aplicaciones.filter((app) => usuariosFiltrados.some((u) => (u.accesos[app] ?? []).some(esNivelAlto)));
  }, [aplicaciones, soloAltos, usuariosFiltrados]);

  const gruposFiltrados = useMemo(() => {
    const base = soloActivos ? usuarios.filter((u) => u.activo) : usuarios;
    return grupos
      .map((g) => ({ grupo: g, miembros: base.filter((u) => u.grupoIds.includes(g.id)) }))
      .filter(
        ({ grupo, miembros }) =>
          miembros.length > 0 && (!texto || `${grupo.categoria} ${grupo.nombre}`.toLowerCase().includes(texto))
      )
      .sort((a, b) => a.grupo.categoria.localeCompare(b.grupo.categoria) || a.grupo.nombre.localeCompare(b.grupo.nombre));
  }, [grupos, usuarios, soloActivos, texto]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <div className="flex gap-1 rounded border border-slate-700 p-0.5 text-sm">
          {(['matriz', 'grupos'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setVista(v)}
              className={`rounded px-3 py-1 ${vista === v ? 'bg-brand-500/20 text-brand-400' : 'text-slate-400 hover:text-slate-200'}`}
            >
              {v === 'matriz' ? 'Usuarios × aplicaciones' : 'Por grupo'}
            </button>
          ))}
        </div>

        <label className="flex flex-col gap-1 text-sm text-slate-300">
          Buscar
          <input
            type="text"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Usuario, aplicación o nivel..."
            className="min-w-[16rem] rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-100 placeholder:text-slate-500 focus:border-brand-500 focus:outline-none"
          />
        </label>

        <div className="flex flex-col gap-1.5">
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={soloActivos}
              onChange={(e) => setSoloActivos(e.target.checked)}
              className="h-4 w-4 rounded border-slate-600 bg-slate-950 text-brand-500 focus:ring-brand-500"
            />
            Solo cuentas activas
          </label>
          {vista === 'matriz' && (
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={soloAltos}
                onChange={(e) => setSoloAltos(e.target.checked)}
                className="h-4 w-4 rounded border-slate-600 bg-slate-950 text-brand-500 focus:ring-brand-500"
              />
              Solo apps con algún Administrador
            </label>
          )}
        </div>

        <LastUpdated dataUpdatedAt={query.dataUpdatedAt} />
      </div>

      {query.isError && (
        <p className="rounded border border-red-900 bg-red-950/50 p-3 text-sm text-red-300">
          No se pudieron cargar los datos: {(query.error as Error).message}
        </p>
      )}

      {query.isLoading ? (
        <div className="h-64 w-full animate-pulse-slow rounded-lg bg-slate-800/60" />
      ) : vista === 'matriz' ? (
        <>
          <p className="text-sm text-slate-400">
            Cada celda es el nivel más alto que la cuenta tiene en esa aplicación, con el mismo nombre que ves en Odoo (Ajustes → Usuarios → la
            cuenta → pestaña Permisos de acceso). Los nombres están escritos igual que allá, así que podés buscarlos con Ctrl+F. Click en una cuenta
            para ver sus grupos técnicos.
          </p>
          <section className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-900">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-950/60 text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="sticky left-0 z-10 min-w-[14rem] bg-slate-950 px-4 py-3">Usuario (nombre en Odoo)</th>
                  {appsVisibles.map((app) => (
                    <th key={app} className="whitespace-nowrap px-3 py-3">
                      {app}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {usuariosFiltrados.map((u) => {
                  const abierta = conTecnicos === u.id;
                  const tecnicos = u.grupoIds
                    .map((id) => grupoPorId.get(id))
                    .filter((g): g is PermisoGrupo => !!g && g.categoria === SIN_APLICACION)
                    .map((g) => g.nombre)
                    .sort();
                  return (
                    <Fragment key={u.id}>
                      <tr onClick={() => setConTecnicos(abierta ? null : u.id)} className="cursor-pointer align-top hover:bg-slate-800/40">
                        <td className="sticky left-0 bg-slate-900 px-4 py-2.5">
                          <p className="font-medium text-slate-100">
                            {u.nombre}
                            {!u.activo && <span className="ml-2 rounded bg-slate-700 px-1.5 py-0.5 text-xs text-slate-300">archivada</span>}
                          </p>
                          <p className="text-xs text-slate-500">{u.login}</p>
                        </td>
                        {appsVisibles.map((app) => (
                          <td key={app} className="px-3 py-2.5">
                            <Celda niveles={u.accesos[app]} />
                          </td>
                        ))}
                      </tr>
                      {abierta && (
                        <tr className="bg-slate-950/40">
                          <td colSpan={appsVisibles.length + 1} className="px-4 py-3">
                            <p className="mb-1.5 text-xs font-medium text-slate-400">Grupos técnicos / sin aplicación ({tecnicos.length})</p>
                            <div className="flex flex-wrap gap-1.5">
                              {tecnicos.map((n) => (
                                <span key={n} className="rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-200">
                                  {n}
                                </span>
                              ))}
                              {tecnicos.length === 0 && <span className="text-xs text-slate-500">Ninguno.</span>}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
                {usuariosFiltrados.length === 0 && (
                  <tr>
                    <td colSpan={appsVisibles.length + 1} className="px-4 py-8 text-center text-slate-500">
                      Sin resultados.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>
        </>
      ) : (
        <section className="flex flex-col gap-2">
          {gruposFiltrados.map(({ grupo, miembros }) => (
            <details key={grupo.id} className="rounded-lg border border-slate-800 bg-slate-900 px-4 py-2.5">
              <summary className="flex cursor-pointer items-center justify-between gap-3 text-sm text-slate-100">
                <span>
                  <span className="text-slate-400">{grupo.categoria} / </span>
                  {grupo.nombre}
                </span>
                <span className="text-xs text-slate-400">
                  {miembros.length} usuario{miembros.length === 1 ? '' : 's'}
                </span>
              </summary>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {miembros.map((u) => (
                  <span key={u.id} className="rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-200">
                    {u.nombre}
                  </span>
                ))}
              </div>
            </details>
          ))}
          {gruposFiltrados.length === 0 && <p className="py-8 text-center text-sm text-slate-500">Sin resultados.</p>}
        </section>
      )}
    </div>
  );
}

export default function PermisosOdooApp() {
  return (
    <QueryProvider>
      <PermisosInner />
    </QueryProvider>
  );
}
