import { useApiQuery } from '../dashboard/useApiQuery';
import { monthLabel, money } from './presupuesto-dinamico-utils';
import type { InsumoBreakdownResult } from './types';

interface Props {
  year: number;
  productId: number;
  productName: string;
  month: string;
  onClose: () => void;
}

/** Drill-down for one Presupuestado cell — every model's BOM contribution plus any redistributed-generic share (regla 4.4), so the final $ figure in the main tree isn't a black box. */
export default function InsumoBreakdownModal({ year, productId, productName, month, onClose }: Props) {
  const query = useApiQuery<InsumoBreakdownResult>(
    ['presupuesto-dinamico-breakdown', year, productId, month],
    `/api/presupuesto-dinamico-breakdown?${new URLSearchParams({ year: String(year), productId: String(productId), month })}`
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-slate-800 bg-slate-900 p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-medium text-slate-100">{productName}</h3>
            <p className="text-sm text-slate-500">
              {monthLabel(month)} {month.slice(0, 4)} — cómo se calculó el Presupuestado
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-500 hover:text-slate-300" aria-label="Cerrar">
            ✕
          </button>
        </div>

        {query.isLoading && <div className="h-32 w-full animate-pulse-slow rounded-lg bg-slate-800/60" />}
        {query.isError && (
          <p className="text-sm text-red-400">No se pudo cargar el detalle: {(query.error as Error).message}</p>
        )}

        {query.data &&
          (query.data.entries.length === 0 ? (
            <p className="text-sm text-slate-500">Sin contribuciones registradas para este insumo/mes.</p>
          ) : (
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="py-2 pr-3 font-medium">Origen</th>
                  <th className="py-2 pr-3 font-medium">Detalle</th>
                  <th className="py-2 text-right font-medium">Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {query.data.entries.map((e, i) => (
                  <tr key={i} className="border-b border-slate-800/60 last:border-0">
                    <td className="py-1.5 pr-3 text-slate-300">{e.label}</td>
                    <td className="py-1.5 pr-3 text-slate-500">{e.detail}</td>
                    <td className="py-1.5 text-right text-slate-200">{money.format(e.subtotalArs)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={2} className="pt-2 text-right text-xs uppercase tracking-wide text-slate-500">
                    Total
                  </td>
                  <td className="pt-2 text-right font-medium text-slate-100">{money.format(query.data.totalArs)}</td>
                </tr>
              </tfoot>
            </table>
          ))}
      </div>
    </div>
  );
}
