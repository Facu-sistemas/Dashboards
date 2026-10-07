import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

/**
 * Fuerza a re-leer la tabla "Equipo de gestión" (objetivos) desde Odoo: el
 * server descarta su cache de lecturas y después se refrescan las queries de
 * Gerencia/Plan de producción que dependen de esa tabla.
 */
export default function GerenciaSyncButton() {
  const queryClient = useQueryClient();
  const [sincronizando, setSincronizando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sincronizar() {
    setSincronizando(true);
    setError(null);
    try {
      const res = await fetch('/api/gerencia-sync?refresh=1', { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error('No se pudo sincronizar con Odoo.');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['ventas-gerencia'] }),
        queryClient.invalidateQueries({ queryKey: ['facturacion-gerencia'] }),
        queryClient.invalidateQueries({ queryKey: ['produccion-gerencia'] }),
        queryClient.invalidateQueries({ queryKey: ['plan-produccion'] }),
        queryClient.invalidateQueries({ queryKey: ['plan-produccion-diaria'] }),
      ]);
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
        className="flex items-center gap-1.5 rounded border border-slate-700 px-3 py-1.5 text-xs text-slate-300 transition-colors hover:border-brand-500 hover:text-brand-400 disabled:cursor-not-allowed disabled:opacity-50"
      >
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
        {sincronizando ? 'Sincronizando…' : 'Forzar sincronización'}
      </button>
    </div>
  );
}
