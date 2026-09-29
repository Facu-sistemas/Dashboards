import { monthLabel } from './ProductPriceChart';
import type { ProductQuotationDetail } from './types';

interface Props {
  productName: string;
  month: string;
  details: ProductQuotationDetail[];
  onClose: () => void;
}

const money = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
const dateFormatter = new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: 'short', year: 'numeric' });

/** Drill-down for a 'venta' bar: every quotation line that fed into that month's average, so the number isn't a black box. */
export default function QuotationDetailModal({ productName, month, details, onClose }: Props) {
  const rows = [...details].sort((a, b) => a.date.localeCompare(b.date));
  const avg = rows.length ? rows.reduce((acc, r) => acc + r.price, 0) / rows.length : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="max-h-[80vh] w-full max-w-xl overflow-y-auto rounded-lg border border-slate-800 bg-slate-900 p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-medium text-slate-100">{productName}</h3>
            <p className="text-sm text-slate-500">
              {monthLabel(month)} {month.slice(0, 4)} — {rows.length} cotización{rows.length === 1 ? '' : 'es'}
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-500 hover:text-slate-300" aria-label="Cerrar">
            ✕
          </button>
        </div>

        {rows.length === 0 ? (
          <p className="text-sm text-slate-500">Sin cotizaciones para este mes.</p>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="py-2 pr-3 font-medium">Cotización</th>
                <th className="py-2 pr-3 font-medium">Fecha</th>
                <th className="py-2 pr-3 text-right font-medium">Cant.</th>
                <th className="py-2 text-right font-medium">Precio unit.</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.orderId}-${r.date}`} className="border-b border-slate-800/60 last:border-0">
                  <td className="py-1.5 pr-3 text-slate-300">{r.orderName}</td>
                  <td className="py-1.5 pr-3 text-slate-500">{dateFormatter.format(new Date(r.date))}</td>
                  <td className="py-1.5 pr-3 text-right text-slate-400">{r.qty}</td>
                  <td className="py-1.5 text-right text-slate-200">{money.format(r.price)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3} className="pt-2 text-right text-xs uppercase tracking-wide text-slate-500">
                  Promedio
                </td>
                <td className="pt-2 text-right font-medium text-slate-100">{money.format(avg)}</td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </div>
  );
}
