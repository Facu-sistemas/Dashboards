import type { ClienteActivoRow as ClienteActivoRowType } from '../../lib/odoo/clientes-activos';
import { formatCompactCurrency, formatNumber } from '../gerencia/format';

interface Props {
  row: ClienteActivoRowType;
  rank?: number;
  /** false en fuente 'pedidos' — las notas de crédito no aplican, se omite la columna entera. */
  showNC: boolean;
  expanded: boolean;
  onToggleCreditNotes: () => void;
}

/** Cuando hay notas de crédito, toda la fila es clickeable para abrir el detalle (no solo el ícono) — ya tenemos el dato, no hace falta apuntarle al ícono chiquito. */
export default function ClienteActivoTableRow({ row, rank, showNC, expanded, onToggleCreditNotes }: Props) {
  const tieneNC = showNC && row.creditNoteCount > 0;

  return (
    <tr
      role={tieneNC ? 'button' : undefined}
      tabIndex={tieneNC ? 0 : undefined}
      onClick={tieneNC ? onToggleCreditNotes : undefined}
      onKeyDown={
        tieneNC
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onToggleCreditNotes();
              }
            }
          : undefined
      }
      title={tieneNC ? `${formatCompactCurrency(row.creditNoteAmount)} en notas de crédito — click para ver el detalle` : undefined}
      className={`border-b border-slate-800/60 last:border-0 hover:bg-slate-800/40 ${tieneNC ? 'cursor-pointer' : ''} ${expanded ? 'bg-amber-500/5' : ''}`}
    >
      {rank !== undefined && <td className="py-2 pr-3 text-slate-500">{rank}</td>}
      <td className="py-2 pr-4 text-slate-200">{row.partnerName}</td>
      <td className="py-2 pr-4 text-right text-slate-300">{formatNumber(row.invoiceCount)}</td>
      <td className="py-2 pr-4 text-right text-slate-300">{formatCompactCurrency(row.amount)}</td>
      {showNC && (
        <td className="py-2 text-right">
          {tieneNC ? (
            <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-amber-400 ${expanded ? 'bg-amber-500/10' : ''}`}>
              ⚠ {row.creditNoteCount}
              <span aria-hidden className="text-xs">
                {expanded ? '▴' : '▾'}
              </span>
            </span>
          ) : (
            <span className="text-slate-600">—</span>
          )}
        </td>
      )}
    </tr>
  );
}
