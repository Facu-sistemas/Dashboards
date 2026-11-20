import { useState } from 'react';

/** Botón de Admin: hace que todas las páginas abiertas (de todos los usuarios) se recarguen solas, con un aviso de unos segundos. */
export default function RecargarPaginasAdmin() {
  const [estado, setEstado] = useState<'idle' | 'pidiendo' | 'pedida' | string>('idle');

  async function pedir() {
    if (!window.confirm('¿Recargar las páginas abiertas de TODOS los usuarios? Verán un aviso de 10 segundos y se recargan solas.')) return;
    setEstado('pidiendo');
    try {
      const res = await fetch('/api/admin/recarga-global', { method: 'POST' });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!res.ok || !json.ok) throw new Error(json.error ?? 'No se pudo pedir la recarga');
      setEstado('pedida');
      setTimeout(() => setEstado('idle'), 6000);
    } catch (err) {
      setEstado((err as Error).message);
    }
  }

  const error = estado !== 'idle' && estado !== 'pidiendo' && estado !== 'pedida' ? estado : null;
  return (
    <div className="mb-6 flex flex-wrap items-center gap-3 rounded-lg border border-slate-800 bg-slate-900/60 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-slate-200">Recargar páginas abiertas</p>
        <p className="text-xs text-slate-500">Úsalo después de desplegar: todos los que tengan la web abierta la recargan (aviso de 10 s, pueden cancelar). Tarda hasta 1 minuto en llegar.</p>
      </div>
      <button
        type="button"
        onClick={() => void pedir()}
        disabled={estado === 'pidiendo'}
        className="rounded border border-slate-700 px-3 py-1.5 text-xs text-slate-200 transition-colors hover:border-brand-500 hover:text-brand-400 disabled:opacity-60"
      >
        {estado === 'pidiendo' ? 'Pidiendo…' : estado === 'pedida' ? 'Pedido ✓' : '↻ Recargar a todos'}
      </button>
      {error && <p className="w-full text-xs text-red-400">{error}</p>}
    </div>
  );
}
