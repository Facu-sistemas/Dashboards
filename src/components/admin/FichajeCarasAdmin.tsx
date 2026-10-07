import { useState } from 'react';

export interface CaraRegistradaAdmin {
  empleadoId: number;
  empleadoNombre: string;
  cantidad: number;
  creadoEn: string;
}

interface Props {
  caras: CaraRegistradaAdmin[];
}

function formatFecha(iso: string): string {
  return new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** Caras registradas para el fichaje facial. Solo se muestra en /admin/usuarios (dev): es el único lugar donde se pueden eliminar. */
export default function FichajeCarasAdmin({ caras: inicial }: Props) {
  const [caras, setCaras] = useState(inicial);
  const [error, setError] = useState<string | null>(null);
  const [borrando, setBorrando] = useState<number | null>(null);

  async function eliminar(c: CaraRegistradaAdmin) {
    if (!window.confirm(`¿Eliminar el registro facial de ${c.empleadoNombre}? Va a tener que volver a registrarse para fichar.`)) return;
    setBorrando(c.empleadoId);
    setError(null);
    try {
      const res = await fetch('/api/admin/fichaje-caras', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ empleadoId: c.empleadoId }),
      });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!res.ok || !json.ok) throw new Error(json.error ?? 'No se pudo eliminar');
      setCaras((prev) => prev.filter((x) => x.empleadoId !== c.empleadoId));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBorrando(null);
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-sm font-medium text-slate-300">Caras registradas (Fichaje) — {caras.length}</h2>
        <p className="mt-1 text-xs text-slate-500">
          Se registran desde Fichaje → Registrar. Solo se guardan vectores numéricos, no fotos. Eliminar acá es la única forma de dar de baja una
          cara; para reemplazarla, registrala de nuevo con esta cuenta.
        </p>
      </div>

      {error && <p className="rounded border border-red-900 bg-red-950/50 p-3 text-sm text-red-300">{error}</p>}

      <div className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900">
        {caras.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-slate-500">Todavía no hay caras registradas.</p>
        ) : (
          <ul className="divide-y divide-slate-800">
            {caras.map((c) => (
              <li key={c.empleadoId} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <div>
                  <p className="text-sm font-medium text-slate-100">{c.empleadoNombre}</p>
                  <p className="text-xs text-slate-500">
                    {c.cantidad} muestras · registrada el {formatFecha(c.creadoEn)}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={borrando === c.empleadoId}
                  onClick={() => eliminar(c)}
                  className="rounded border border-red-900 px-3 py-1 text-xs text-red-400 hover:bg-red-950/50 disabled:opacity-50"
                >
                  {borrando === c.empleadoId ? 'Eliminando...' : 'Eliminar'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
