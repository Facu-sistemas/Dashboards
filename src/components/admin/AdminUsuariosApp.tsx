import { useState } from 'react';
import { AREAS } from '../../lib/areas.config';

export interface UsuarioConPermisos {
  id: string;
  username: string;
  nombreCompleto: string | null;
  rol: 'dev' | 'usuario';
  areasActivas: string[];
}

interface Props {
  usuarios: UsuarioConPermisos[];
}

function areaName(slug: string): string {
  return AREAS.find((a) => a.slug === slug)?.name ?? slug;
}

function AreaToggle({
  usuario,
  areaSlug,
  onError,
}: {
  usuario: UsuarioConPermisos;
  areaSlug: string;
  onError: (message: string) => void;
}) {
  const [checked, setChecked] = useState(usuario.areasActivas.includes(areaSlug));
  const [pending, setPending] = useState(false);

  async function toggle() {
    const next = !checked;
    setChecked(next);
    setPending(true);
    try {
      const res = await fetch('/api/admin/usuarios', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: usuario.id, areaSlug, activo: next }),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) throw new Error(body.error ?? 'No se pudo actualizar el permiso.');
    } catch (err) {
      setChecked(!next); // revert optimistic update
      onError(err instanceof Error ? err.message : 'No se pudo actualizar el permiso.');
    } finally {
      setPending(false);
    }
  }

  return (
    <label className={`flex items-center gap-1.5 text-xs ${pending ? 'opacity-60' : ''}`}>
      <input type="checkbox" checked={checked} disabled={pending} onChange={toggle} className="accent-brand-500" />
      {areaName(areaSlug)}
    </label>
  );
}

function UsuarioRow({ usuario, onError }: { usuario: UsuarioConPermisos; onError: (message: string) => void }) {
  return (
    <div className="flex flex-col gap-2 rounded border border-slate-800 bg-slate-950/40 p-3">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-sm font-medium text-slate-200">{usuario.username}</span>
        {usuario.nombreCompleto && <span className="text-xs text-slate-500">{usuario.nombreCompleto}</span>}
        {usuario.rol === 'dev' && (
          <span className="rounded bg-brand-500/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-brand-400">dev</span>
        )}
      </div>

      {usuario.rol === 'dev' ? (
        <p className="text-xs text-slate-500">Ve todas las áreas — no gestiona permisos por acá.</p>
      ) : (
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {AREAS.map((area) => (
            <AreaToggle key={area.slug} usuario={usuario} areaSlug={area.slug} onError={onError} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function AdminUsuariosApp({ usuarios }: Props) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [nombreCompleto, setNombreCompleto] = useState('');
  const [areas, setAreas] = useState<string[]>([]);
  const [creando, setCreando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const usernameValida = /^[a-z0-9-]+$/.test(username.trim());
  const passwordValida = password.length >= 8;
  const formValido = usernameValida && passwordValida;

  function toggleAreaSeleccionada(slug: string) {
    setAreas((prev) => (prev.includes(slug) ? prev.filter((a) => a !== slug) : [...prev, slug]));
  }

  async function crearCuenta() {
    if (!formValido) return;
    setCreando(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/usuarios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password, nombreCompleto: nombreCompleto.trim(), areas }),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) throw new Error(body.error ?? 'No se pudo crear la cuenta.');
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear la cuenta.');
      setCreando(false);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-slate-300">Cuentas existentes</h2>
        {usuarios.length === 0 ? (
          <p className="text-sm text-slate-500">No hay cuentas todavía.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {usuarios.map((u) => (
              <UsuarioRow key={u.id} usuario={u} onError={setError} />
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-4 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <h2 className="text-sm font-medium text-slate-300">Agregar cuenta de área</h2>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm text-slate-300">
            Usuario
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="ej: almacen"
              className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 placeholder:text-slate-600 focus:border-brand-500 focus:outline-none"
            />
            {username.length > 0 && !usernameValida && (
              <span className="text-xs text-red-400">Solo minúsculas, números y guiones.</span>
            )}
          </label>

          <label className="flex flex-col gap-1 text-sm text-slate-300">
            Nombre (opcional)
            <input
              type="text"
              value={nombreCompleto}
              onChange={(e) => setNombreCompleto(e.target.value)}
              placeholder="ej: Almacén"
              className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 placeholder:text-slate-600 focus:border-brand-500 focus:outline-none"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm text-slate-300 sm:col-span-2">
            Contraseña
            <input
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Mínimo 8 caracteres — se comparte con el equipo del área"
              className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 placeholder:text-slate-600 focus:border-brand-500 focus:outline-none"
            />
            {password.length > 0 && !passwordValida && <span className="text-xs text-red-400">Mínimo 8 caracteres.</span>}
          </label>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-sm text-slate-300">Áreas habilitadas</span>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {AREAS.map((area) => (
              <label key={area.slug} className="flex items-center gap-1.5 text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={areas.includes(area.slug)}
                  onChange={() => toggleAreaSeleccionada(area.slug)}
                  className="accent-brand-500"
                />
                {area.name}
              </label>
            ))}
          </div>
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <button
          type="button"
          disabled={!formValido || creando}
          onClick={crearCuenta}
          className="self-start rounded bg-brand-500 px-4 py-1.5 text-sm font-medium text-slate-950 transition-colors hover:bg-brand-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {creando ? 'Creando…' : 'Crear cuenta'}
        </button>
      </section>
    </div>
  );
}
