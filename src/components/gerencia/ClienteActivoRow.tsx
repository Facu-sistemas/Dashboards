import type { ClienteActivoRow as ClienteActivoRowType } from '../../lib/odoo/clientes-activos';
import { formatCompactCurrency, formatNumber } from './format';

interface Props {
  row: ClienteActivoRowType;
  rank?: number;
  expanded: boolean;
  onToggleCreditNotes: () => void;
}

export default function ClienteActivoTableRow({ row, rank, expanded, onToggleCreditNotes }: Props) {
  return (
    <tr className="border-b border-slate-800/60 last:border-0 hover:bg-slate-800/40">
      {rank !== undefined && <td className="py-2 pr-3 text-slate-500">{rank}</td>}
      <td className="py-2 pr-4 text-slate-200">{row.partnerName}</td>
      <td className="py-2 pr-4 text-right text-slate-300">{formatNumber(row.invoiceCount)}</td>
      <td className="py-2 pr-4 text-right text-slate-300">{formatCompactCurrency(row.amount)}</td>
      <td className="py-2 text-right">
        {row.creditNoteCount > 0 ? (
          <button
            type="button"
            onClick={onToggleCreditNotes}
            title={`${formatCompactCurrency(row.creditNoteAmount)} en notas de crédito — click para ver el detalle`}
            className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-amber-400 hover:bg-amber-500/10 ${
              expanded ? 'bg-amber-500/10' : ''
            }`}
          >
            ⚠ {row.creditNoteCount}
            <span aria-hidden className="text-xs">
              {expanded ? '▴' : '▾'}
            </span>
          </button>
        ) : (
          <span className="text-slate-600">—</span>
        )}
      </td>
    </tr>
  );
}
