import { useApiQuery } from '@/components/dashboard/useApiQuery';
import type { AjusteMovimiento } from '@/lib/odoo/ajustes-inventario';

const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const money = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
const qtyFmt = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 });
const dateFmt = new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

function mesLabel(mes: string): string {
  const [y, m] = mes.split('-');
  return `${MESES[Number(m) - 1]} ${y}`;
}

function signClass(v: number): string {
  return v < 0 ? 'text-red-400' : v > 0 ? 'text-emerald-400' : 'text-slate-400';
}

interface Props {
  productId: number;
  producto: string;
  uom: string;
  year: number;
  mes: string;
  onClose: () => void;
}

/**
 * Drill-down de una fila de producto del detalle por mes: todas las capas de
 * Valoración (stock.valuation.layer) que suman su Cant. neta / $ neto, una
 * por movimiento. Mismo patrón que QuotationDetailModal.tsx (Comercial).
 */
export default function AjusteMovimientosModal({ productId, producto, uom, year, mes, onClose }: Props) {
  const query = useApiQuery<AjusteMovimiento[]>(
    ['ajustes-inventario-movimientos', year, mes, productId],
    `/api/ajustes-inventario-movimientos?year=${year}&mes=${mes}&productId=${productId}`
  );
  const rows = query.data ?? [];
  const totalCantidad = rows.reduce((a, r) => a + r.cantidad, 0);
  const totalValor = rows.reduce((a, r) => a + r.valor, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-slate-800 bg-slate-900 p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-medium text-slate-100">{producto}</h3>
            <p className="text-sm text-slate-500">
              {mesLabel(mes)} — {query.isLoading ? 'cargando…' : `${rows.length} movimiento${rows.length === 1 ? '' : 's'}`}
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-500 hover:text-slate-300" aria-label="Cerrar">
            ✕
          </button>
        </div>

        {query.isError && (
          <p className="rounded border border-red-900 bg-red-950/50 p-3 text-sm text-red-300">
            No se pudieron cargar los movimientos: {(query.error as Error).message}
          </p>
        )}

        {query.isLoading ? (
          <div className="h-40 w-full animate-pulse-slow rounded-lg bg-slate-800/60" />
        ) : rows.length === 0 ? (
          <p className="text-sm text-slate-500">Sin movimientos de este producto en {mesLabel(mes)}.</p>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="py-2 pr-3 font-medium">Fecha</th>
                <th className="py-2 pr-3 font-medium">Movimiento</th>
                <th className="py-2 pr-3 text-right font-medium">Cant. ({uom || 'u'})</th>
                <th className="py-2 text-right font-medium">$</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.layerId} className="border-b border-slate-800/60 last:border-0">
                  <td className="py-1.5 pr-3 text-slate-500">{dateFmt.format(new Date(r.fecha))}</td>
                  <td className="py-1.5 pr-3 text-slate-300">
                    {r.movimiento}
                    {r.difHistorial && (
                      <span title="Este movimiento no coincide con el Historial de movimientos" className="ml-1.5 text-amber-400">
                        ⚠
                      </span>
                    )}
                  </td>
                  <td className={`py-1.5 pr-3 text-right tabular-nums ${signClass(r.cantidad)}`}>{qtyFmt.format(r.cantidad)}</td>
                  <td className={`py-1.5 text-right tabular-nums ${signClass(r.valor)}`}>{money.format(r.valor)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2} className="pt-2 text-right text-xs uppercase tracking-wide text-slate-500">
                  Total
                </td>
                <td className={`pt-2 text-right font-medium tabular-nums ${signClass(totalCantidad)}`}>{qtyFmt.format(totalCantidad)}</td>
                <td className={`pt-2 text-right font-medium tabular-nums ${signClass(totalValor)}`}>{money.format(totalValor)}</td>
              </tr>
            </tfoot>
          </table>
        )}
        {rows.some((r) => r.difHistorial) && (
          <p className="mt-3 text-[10px] text-slate-500">⚠ movimiento cuya cantidad en Valoración no coincide con el Historial de movimientos.</p>
        )}
      </div>
    </div>
  );
}
