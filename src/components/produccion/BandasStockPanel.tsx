import { useState } from 'react';
import { TELAS_LIST } from '../../lib/bandas-calc';

export interface StockRowInput {
  id: string;
  tela: string;
  alto: string;
  cantidad: string;
}

interface Props {
  rows: StockRowInput[];
  onAddRow: (tela?: string, alto?: number, cantidad?: number) => void;
  onUpdateRow: (id: string, patch: Partial<Omit<StockRowInput, 'id'>>) => void;
  onRemoveRow: (id: string) => void;
  onImport: (rows: { tela: string; alto: number; cantidad: number }[]) => void;
  onClear: () => void;
}

const inputClasses =
  'w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100 focus:border-brand-500 focus:outline-none';

export default function BandasStockPanel({ rows, onAddRow, onUpdateRow, onRemoveRow, onImport, onClear }: Props) {
  const [expanded, setExpanded] = useState(false);
  const importInputId = 'bandas-stock-import';

  function exportarStock() {
    const stock: Record<string, number> = {};
    for (const r of rows) {
      const alto = parseInt(r.alto, 10);
      const cantidad = parseInt(r.cantidad, 10) || 1;
      if (r.tela && alto > 0) {
        const k = `${r.tela}||${alto}`;
        stock[k] = (stock[k] ?? 0) + cantidad;
      }
    }
    if (Object.keys(stock).length === 0) {
      alert('No hay stock cargado para exportar.');
      return;
    }
    const blob = new Blob([JSON.stringify(stock, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `stock_rollos_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(String(ev.target?.result)) as Record<string, number>;
        const parsed = Object.entries(data)
          .map(([k, cantidad]) => {
            const [tela, altoStr] = k.split('||');
            const alto = parseInt(altoStr ?? '', 10);
            return tela && alto > 0 ? { tela, alto, cantidad } : null;
          })
          .filter((r): r is { tela: string; alto: number; cantidad: number } => r !== null);
        onImport(parsed);
        setExpanded(true);
      } catch (err) {
        alert(`Error al importar: ${err instanceof Error ? err.message : String(err)}`);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <span className="flex items-center gap-2 text-sm font-medium text-slate-200">
          Stock de rollos disponibles
          <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-400">
            {rows.length} cargado{rows.length !== 1 ? 's' : ''}
          </span>
        </span>
        <span className="text-xs text-slate-500">{expanded ? '▲ Cerrar' : '▼ Expandir'}</span>
      </button>

      {expanded && (
        <div className="border-t border-slate-800 px-4 py-4">
          <p className="mb-3 text-xs text-slate-500">
            Cargá los rollos que ya tenés cortados y guardados. Se descuentan automáticamente al calcular.
          </p>

          <div className="mb-1.5 grid grid-cols-[1fr_100px_90px_28px] gap-2 text-xs uppercase tracking-wide text-slate-500">
            <span>Tela</span>
            <span>Alto (cm)</span>
            <span>Cantidad</span>
            <span />
          </div>

          <div className="flex flex-col gap-2">
            {rows.map((row) => (
              <div key={row.id} className="grid grid-cols-[1fr_100px_90px_28px] items-center gap-2">
                <select
                  value={row.tela}
                  onChange={(e) => onUpdateRow(row.id, { tela: e.target.value })}
                  className={inputClasses}
                >
                  <option value="">—</option>
                  {TELAS_LIST.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min={1}
                  max={210}
                  placeholder="ej: 33"
                  value={row.alto}
                  onChange={(e) => onUpdateRow(row.id, { alto: e.target.value })}
                  className={inputClasses}
                />
                <input
                  type="number"
                  min={1}
                  placeholder="ej: 2"
                  value={row.cantidad}
                  onChange={(e) => onUpdateRow(row.id, { cantidad: e.target.value })}
                  className={inputClasses}
                />
                <button
                  type="button"
                  onClick={() => onRemoveRow(row.id)}
                  className="text-lg text-slate-600 hover:text-red-400"
                  aria-label="Quitar fila"
                >
                  ×
                </button>
              </div>
            ))}
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                onAddRow();
                setExpanded(true);
              }}
              className="rounded border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-brand-500 hover:text-brand-400"
            >
              + Agregar rollo
            </button>
            <button
              type="button"
              onClick={exportarStock}
              className="rounded border border-brand-600/50 px-3 py-1.5 text-xs text-brand-400 hover:bg-brand-500/10"
            >
              ↓ Exportar stock
            </button>
            <label
              htmlFor={importInputId}
              className="cursor-pointer rounded border border-indigo-500/50 px-3 py-1.5 text-xs text-indigo-300 hover:bg-indigo-500/10"
            >
              ↑ Importar stock
            </label>
            <input id={importInputId} type="file" accept=".json" className="hidden" onChange={handleImportFile} />
            <button
              type="button"
              onClick={() => {
                if (confirm('¿Limpiar todo el stock?')) onClear();
              }}
              className="rounded border border-red-500/40 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10"
            >
              ✕ Limpiar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
