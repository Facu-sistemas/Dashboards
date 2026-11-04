import { Fragment, useMemo, useState } from 'react';
import { useApiQuery } from '@/components/dashboard/useApiQuery';
import LastUpdated from '@/components/shared/LastUpdated';
import type { PermisosUsuarios } from '@/lib/odoo/permisos-usuarios';
import { OPCIONES_POR_DEFECTO, REGLAS, esNivelAlto, proponer, type OpcionesPropuesta, type ReglaId } from '@/lib/permisos-propuesta';

type Vista = 'matriz' | 'grupos' | 'cambios';

function Pastilla({ texto, tono = 'normal' }: { texto: string; tono?: 'normal' | 'quitado' | 'nuevo' }) {
  const clases =
    tono === 'quitado'
      ? 'bg-slate-800/60 text-slate-500 line-through'
      : tono === 'nuevo'
        ? 'bg-emerald-500/15 font-medium text-emerald-400'
        : esNivelAlto(texto)
          ? 'bg-amber-500/15 font-medium text-accent-amber'
          : 'bg-slate-800 text-slate-200';
  return <span className={`w-fit rounded px-1.5 py-0.5 text-xs ${clases}`}>{texto}</span>;
}

function CeldaPropuesta({ antes, despues }: { antes: string[] | undefined; despues: string[] | undefined }) {
  const a = antes ?? [];
  const d = despues ?? [];
  if (a.length === 0 && d.length === 0) return <span className="text-slate-600">—</span>;
  const quitados = a.filter((n) => !d.includes(n));
  const nuevos = d.filter((n) => !a.includes(n));
  const iguales = d.filter((n) => a.includes(n));
  return (
    <div className="flex flex-col gap-1">
      {iguales.map((n) => (
        <Pastilla key={n} texto={n} />
      ))}
      {quitados.map((n) => (
        <Pastilla key={`q-${n}`} texto={n} tono="quitado" />
      ))}
      {nuevos.map((n) => (
        <Pastilla key={`n-${n}`} texto={n} tono="nuevo" />
      ))}
      {quitados.length > 0 && nuevos.length === 0 && <span className="text-xs font-medium text-red-400">sin acceso</span>}
    </div>
  );
}

export function PropuestoInner() {
  const [vista, setVista] = useState<Vista>('matriz');
  const [busqueda, setBusqueda] = useState('');
  const [soloActivos, setSoloActivos] = useState(true);
  const [soloCambios, setSoloCambios] = useState(true);
  const [opciones, setOpciones] = useState<OpcionesPropuesta>(OPCIONES_POR_DEFECTO);

  const query = useApiQuery<PermisosUsuarios>(['permisos-odoo'], '/api/permisos-odoo');
  const propuesta = useMemo(() => (query.data ? proponer(query.data, opciones) : null), [query.data, opciones]);
  const texto = busqueda.trim().toLowerCase();

  const aplicaciones = useMemo(() => {
    if (!propuesta || !query.data) return [];
    // Solo las apps donde algo cambia, para que la matriz muestre lo importante.
    const conCambio = new Set(propuesta.cambios.map((c) => c.app));
    return query.data.aplicaciones.filter((a) => !soloCambios || conCambio.has(a));
  }, [propuesta, query.data, soloCambios]);

  const usuarios = useMemo(() => {
    if (!propuesta) return [];
    return propuesta.usuarios.filter((u) => {
      if (soloActivos && !u.activo && u.appsCambiadas.length === 0) return false;
      if (soloCambios && u.appsCambiadas.length === 0 && u.avisos.length === 0) return false;
      if (!texto) return true;
      return u.nombre.toLowerCase().includes(texto) || u.login.toLowerCase().includes(texto);
    });
  }, [propuesta, soloActivos, soloCambios, texto]);

  const conteos = useMemo(() => {
    if (!propuesta) return [];
    return propuesta.conteos
      .filter((c) => (!soloCambios || c.antes !== c.despues) && (c.antes > 0 || c.despues > 0))
      .filter((c) => !texto || `${c.grupo.categoria} ${c.grupo.nombre}`.toLowerCase().includes(texto))
      .sort((a, b) => a.grupo.categoria.localeCompare(b.grupo.categoria) || a.grupo.nombre.localeCompare(b.grupo.nombre));
  }, [propuesta, soloCambios, texto]);

  const cambios = useMemo(() => {
    if (!propuesta) return [];
    return propuesta.cambios
      .filter((c) => !texto || `${c.usuario} ${c.login} ${c.app} ${c.quitar} ${c.poner ?? ''}`.toLowerCase().includes(texto))
      .sort((a, b) => a.usuario.localeCompare(b.usuario) || a.app.localeCompare(b.app));
  }, [propuesta, texto]);

  const activarRegla = (id: ReglaId, valor: boolean) => setOpciones((o) => ({ ...o, reglas: { ...o.reglas, [id]: valor } }));

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
        <h3 className="text-sm font-semibold text-slate-100">Reglas de la propuesta (mínimo privilegio)</h3>
        <p className="mt-1 text-xs text-slate-400">
          Es una sugerencia calculada con los permisos reales de hoy. No toca nada en Odoo: te dice qué cambiar y por qué. Prendé o apagá cada regla para ver el
          efecto.
        </p>
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          {REGLAS.map((r) => (
            <label key={r.id} className="flex cursor-pointer gap-3 rounded border border-slate-800 bg-slate-950/40 p-3">
              <input
                type="checkbox"
                checked={opciones.reglas[r.id]}
                onChange={(e) => activarRegla(r.id, e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-600 bg-slate-950 text-brand-500 focus:ring-brand-500"
              />
              <span className="flex flex-col gap-1">
                <span className="text-sm font-medium text-slate-100">
                  {r.titulo}
                  {propuesta && (
                    <span className="ml-2 rounded bg-slate-800 px-1.5 py-0.5 text-xs font-normal text-slate-300">
                      {propuesta.porRegla[r.id]} {r.modifica ? (propuesta.porRegla[r.id] === 1 ? 'cambio' : 'cambios') : propuesta.porRegla[r.id] === 1 ? 'aviso' : 'avisos'}
                    </span>
                  )}
                </span>
                <span className="text-xs text-slate-400">{r.explicacion}</span>
                {r.id === 'admins' && (
                  <span className="flex items-center gap-2 pt-1 text-xs text-slate-300">
                    Máximo por nivel:
                    <input
                      type="number"
                      min={1}
                      max={10}
                      value={opciones.maxAdmins}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setOpciones((o) => ({ ...o, maxAdmins: Math.max(1, Number(e.target.value) || 1) }))}
                      className="w-14 rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 text-slate-100"
                    />
                  </span>
                )}
                {r.id === 'inactivas' && (
                  <span className="flex items-center gap-2 pt-1 text-xs text-slate-300">
                    Días sin ingresar:
                    <input
                      type="number"
                      min={7}
                      max={720}
                      value={opciones.diasInactividad}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setOpciones((o) => ({ ...o, diasInactividad: Math.max(7, Number(e.target.value) || 90) }))}
                      className="w-16 rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 text-slate-100"
                    />
                  </span>
                )}
              </span>
            </label>
          ))}
        </div>
      </section>

      <div className="flex flex-wrap items-end justify-between gap-4 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <div className="flex gap-1 rounded border border-slate-700 p-0.5 text-sm">
          {(
            [
              ['matriz', 'Usuarios × aplicaciones'],
              ['grupos', 'Por grupo'],
              ['cambios', 'Lista de cambios'],
            ] as const
          ).map(([v, etiqueta]) => (
            <button
              key={v}
              type="button"
              onClick={() => setVista(v)}
              className={`rounded px-3 py-1 ${vista === v ? 'bg-brand-500/20 text-brand-400' : 'text-slate-400 hover:text-slate-200'}`}
            >
              {etiqueta}
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
          {vista !== 'cambios' && (
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={soloCambios}
                onChange={(e) => setSoloCambios(e.target.checked)}
                className="h-4 w-4 rounded border-slate-600 bg-slate-950 text-brand-500 focus:ring-brand-500"
              />
              Solo lo que cambia
            </label>
          )}
          {vista === 'matriz' && (
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={soloActivos}
                onChange={(e) => setSoloActivos(e.target.checked)}
                className="h-4 w-4 rounded border-slate-600 bg-slate-950 text-brand-500 focus:ring-brand-500"
              />
              Ocultar archivadas sin cambios
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

      {query.isLoading || !propuesta ? (
        <div className="h-64 w-full animate-pulse-slow rounded-lg bg-slate-800/60" />
      ) : vista === 'matriz' ? (
        <>
          <p className="text-sm text-slate-400">
            <span className="rounded bg-slate-800/60 px-1.5 py-0.5 text-xs text-slate-500 line-through">Nivel actual</span> se quita ·{' '}
            <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-xs font-medium text-emerald-400">Nivel propuesto</span> es a lo que se baja ·{' '}
            <span className="text-xs font-medium text-red-400">sin acceso</span> si se quita la app. Las insignias de la primera columna son avisos para revisar.
          </p>
          <section className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-900">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-950/60 text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="sticky left-0 z-10 min-w-[14rem] bg-slate-950 px-4 py-3">Usuario (nombre en Odoo)</th>
                  {aplicaciones.map((app) => (
                    <th key={app} className="whitespace-nowrap px-3 py-3">
                      {app}
                    </th>
                  ))}
                  <th className="whitespace-nowrap px-3 py-3">Sin aplicación</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {usuarios.map((u) => (
                  <tr key={u.id} className="align-top">
                    <td className="sticky left-0 bg-slate-900 px-4 py-2.5">
                      <p className="font-medium text-slate-100">
                        {u.nombre}
                        {!u.activo && <span className="ml-2 rounded bg-slate-700 px-1.5 py-0.5 text-xs text-slate-300">archivada</span>}
                      </p>
                      <p className="text-xs text-slate-500">{u.login}</p>
                      {u.avisos.map((a) => (
                        <p key={a.texto} className="mt-1 text-xs text-accent-amber">
                          ⚠ {a.texto}
                        </p>
                      ))}
                    </td>
                    {aplicaciones.map((app) => (
                      <td key={app} className="px-3 py-2.5">
                        <CeldaPropuesta antes={u.accesos[app]} despues={u.accesosPropuestos[app]} />
                      </td>
                    ))}
                    <td className="px-3 py-2.5">
                      <CeldaPropuesta antes={u.accesos['Sin aplicación']} despues={u.accesosPropuestos['Sin aplicación']} />
                    </td>
                  </tr>
                ))}
                {usuarios.length === 0 && (
                  <tr>
                    <td colSpan={aplicaciones.length + 2} className="px-4 py-8 text-center text-slate-500">
                      Con estas reglas no hay nada que cambiar.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>
        </>
      ) : vista === 'grupos' ? (
        <section className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-950/60 text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-4 py-3">Aplicación / Nivel (nombre en Odoo)</th>
                <th className="px-4 py-3 text-right">Hoy</th>
                <th className="px-4 py-3 text-right">Propuesto</th>
                <th className="px-4 py-3 text-right">Diferencia</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {conteos.map(({ grupo, antes, despues }) => {
                const delta = despues - antes;
                return (
                  <tr key={grupo.id} className="hover:bg-slate-800/40">
                    <td className="px-4 py-2.5 text-slate-100">
                      <span className="text-slate-400">{grupo.categoria} / </span>
                      {grupo.nombre}
                    </td>
                    <td className="px-4 py-2.5 text-right text-slate-300">{antes}</td>
                    <td className="px-4 py-2.5 text-right text-slate-100">{despues}</td>
                    <td className={`px-4 py-2.5 text-right font-medium ${delta < 0 ? 'text-emerald-400' : delta > 0 ? 'text-amber-300' : 'text-slate-500'}`}>
                      {delta > 0 ? `+${delta}` : delta}
                    </td>
                  </tr>
                );
              })}
              {conteos.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-slate-500">
                    Sin resultados.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      ) : (
        <>
          <p className="text-sm text-slate-400">
            {cambios.length} cambio{cambios.length === 1 ? '' : 's'} para hacer en Odoo (Ajustes → Usuarios → la cuenta → pestaña Permisos de acceso). Los nombres están
            escritos igual que allá: buscá con Ctrl+F.
          </p>
          <section className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-900">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-950/60 text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-4 py-3">Usuario</th>
                  <th className="px-4 py-3">Aplicación</th>
                  <th className="px-4 py-3">Hoy</th>
                  <th className="px-4 py-3">Poner</th>
                  <th className="px-4 py-3">Motivo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {cambios.map((c, i) => (
                  <tr key={`${c.usuarioId}-${c.quitar}-${i}`} className="align-top hover:bg-slate-800/40">
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-slate-100">{c.usuario}</p>
                      <p className="text-xs text-slate-500">{c.login}</p>
                    </td>
                    <td className="px-4 py-2.5 text-slate-300">{c.app}</td>
                    <td className="px-4 py-2.5">
                      <Pastilla texto={c.quitar} />
                    </td>
                    <td className="px-4 py-2.5">
                      {c.poner ? <Pastilla texto={c.poner} tono="nuevo" /> : <span className="text-xs font-medium text-red-400">Quitar acceso</span>}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-slate-400">{c.motivo}</td>
                  </tr>
                ))}
                {cambios.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                      Con estas reglas no hay cambios.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>
          {propuesta.avisos.length > 0 && (
            <section className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
              <h3 className="text-sm font-semibold text-accent-amber">Cuentas para revisar o archivar ({propuesta.avisos.length})</h3>
              <ul className="mt-2 flex flex-col gap-1 text-sm text-slate-200">
                {propuesta.avisos.map((a) => {
                  const u = propuesta.usuarios.find((x) => x.id === a.usuarioId)!;
                  return (
                    <Fragment key={a.usuarioId}>
                      <li>
                        <span className="font-medium">{u.nombre}</span> <span className="text-xs text-slate-500">({u.login})</span> — {a.texto}
                      </li>
                    </Fragment>
                  );
                })}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
