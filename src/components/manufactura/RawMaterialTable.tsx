import type { RawMaterialRow } from './types';

interface Props {
  rows: RawMaterialRow[];
  selectedId: number | null;
  onSelect: (row: RawMaterialRow) => void;
}

const numberFmt = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });

function formatDays(d: number | null): string {
  if (d === null) return 'sin consumo reciente';
  return `${d.toFixed(0)} días`;
}

/** Sorted by urgency server-side (fewest days until stockout first) — this table doesn't re-sort client-side, it just displays what the backend already ordered. */
export default function RawMaterialTable({ rows, selectedId, onSelect }: Props) {
  if (rows.length === 0) {
    return <p className="py-8 text-center text-sm text-slate-500">Sin materiales que coincidan con el filtro.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wide text-slate-500">
            <th className="py-2 pr-4 font-medium">Insumo</th>
            <th className="py-2 pr-4 font-medium">Stock actual</th>
            <th className="py-2 pr-4 font-medium">Punto de reorden</th>
            <th className="py-2 pr-4 font-medium">Consumo proyectado</th>
            <th className="py-2 font-medium">Días hasta quiebre</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.productId}
              onClick={() => onSelect(r)}
              className={`cursor-pointer border-b border-slate-800/60 last:border-0 hover:bg-slate-800/60 ${
                r.productId === selectedId ? 'bg-brand-500/10' : ''
              }`}
            >
              <td className="py-2 pr-4 text-slate-200">
                {r.productName}
                {r.isLow && <span className="ml-2 text-red-400">⚠</span>}
              </td>
              <td className="py-2 pr-4 text-slate-300">{numberFmt.format(r.currentStock)}</td>
              <td className="py-2 pr-4 text-slate-300">
                {r.reorderPoint !== null ? numberFmt.format(r.reorderPoint) : <span className="text-slate-600">—</span>}
              </td>
              <td className="py-2 pr-4 text-slate-300">{numberFmt.format(r.projectedConsumption)}</td>
              <td className={`py-2 ${r.isLow ? 'font-medium text-red-400' : 'text-slate-300'}`}>{formatDays(r.daysUntilStockout)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
