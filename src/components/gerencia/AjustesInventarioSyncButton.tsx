import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

/**
 * Fuerza a re-leer Ajustes de inventario desde Odoo: el server descarta su
 * cache propio (10 min, por año) y el cache de lecturas de Odoo, y después se
 * refresca la query de la pestaña con los filtros actuales. Mismo patrón que
 * GerenciaSyncButton.tsx, pero para el cache propio de este tab en vez del de
 * la tabla "Equipo de gestión".
 */
export default function AjustesInventarioSyncButton() {
  const queryClient = useQueryClient();
  const [sincronizando, setSincronizando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sincronizar() {
    setSincronizando(true);
    setError(null);
    try {
      const res = await fetch('/api/ajustes-inventario?refresh=1', { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error('No se pudo sincronizar con Odoo.');
      await queryClient.invalidateQueries({ queryKey: ['ajustes-inventario'] });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo sincronizar con Odoo.');
    } finally {
      setSincronizando(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      {error && <p className="text-xs text-red-400">{error}</p>}
      <button
        type="button"
        onClick={sincronizar}
        disabled={sincronizando}
        className="flex min-w-[10.5rem] items-center justify-center gap-1.5 whitespace-nowrap rounded border border-slate-700 px-3 py-1.5 text-xs text-slate-300 transition-colors hover:border-brand-500 hover:text-brand-400 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {/* El glyph llega hasta el borde del viewBox (24x24): al girar con animate-spin, las puntas se salen de su caja de 14x14 si nada las recorta — por eso va en un span con overflow-hidden del mismo tamaño. */}
        <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center overflow-hidden">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`h-3.5 w-3.5 ${sincronizando ? 'animate-spin' : ''}`}
          >
            <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
            <path d="M3 3v5h5" />
            <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
            <path d="M16 16h5v5" />
          </svg>
        </span>
        {sincronizando ? 'Sincronizando…' : 'Forzar sincronización'}
      </button>
    </div>
  );
}
