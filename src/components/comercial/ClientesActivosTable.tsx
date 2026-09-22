import { Fragment, useState } from 'react';
import type { ClienteActivoRow as ClienteActivoRowType, ClientesActivosFuente, ClientesActivosPeriodo } from '../../lib/odoo/clientes-activos';
import ClienteActivoTableRow from './ClienteActivoRow';
import NotasCreditoDetailRow from './NotasCreditoDetailRow';

export type ClientesActivosSortBy = 'facturas' | 'facturado';

interface Props {
  rows: ClienteActivoRowType[];
  periodo: ClientesActivosPeriodo;
  /** Ids de compañía seleccionados, coma-separados — vacío = todas. Se reenvía tal cual al detalle de NC para que coincida con el filtro de arriba. */
  companiesParam: string;
  /** 'pedidos' oculta la columna NC — las notas de crédito son un concepto de facturación, no aplica a pedidos. */
  fuente: ClientesActivosFuente;
  sortBy: ClientesActivosSortBy;
  onSortByChange: (sortBy: ClientesActivosSortBy) => void;
  /** Envuelve la tabla en un contenedor de altura fija con scroll interno — para la lista completa, que puede tener muchas filas. */
  scrollable?: boolean;
}

function SortableHeader({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <th className="py-2 pr-4 text-right font-medium">
      <button
        type="button"
        onClick={onClick}
        className={`inline-flex items-center gap-1 hover:text-slate-300 ${active ? 'text-brand-400' : ''}`}
      >
        {label}
        {active && <span aria-hidden>▾</span>}
      </button>
    </th>
  );
}

export default function ClientesActivosTable({ rows, periodo, companiesParam, fuente, sortBy, onSortByChange, scrollable }: Props) {
  const [expandedPartnerId, setExpandedPartnerId] = useState<number | null>(null);
  const showNC = fuente === 'facturas';
  const columnCount = showNC ? 5 : 4;

  if (rows.length === 0) {
    return <p className="py-8 text-center text-sm text-slate-500">Sin clientes activos en este período.</p>;
  }

  const table = (
    <table className="w-full min-w-[520px] border-collapse text-sm">
      <thead>
        <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wide text-slate-500">
          <th className="py-2 pr-3 font-medium">#</th>
          <th className="py-2 pr-4 font-medium">Cliente</th>
          <SortableHeader
            label={fuente === 'pedidos' ? 'Pedidos' : 'Facturas'}
            active={sortBy === 'facturas'}
            onClick={() => onSortByChange('facturas')}
          />
          <SortableHeader
            label={fuente === 'pedidos' ? 'Vendido' : 'Facturado'}
            active={sortBy === 'facturado'}
            onClick={() => onSortByChange('facturado')}
          />
          {showNC && <th className="py-2 text-right font-medium">NC</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => {
          const expanded = expandedPartnerId === r.partnerId;
          return (
            <Fragment key={r.partnerId}>
              <ClienteActivoTableRow
                row={r}
                rank={i + 1}
                showNC={showNC}
                expanded={expanded}
                onToggleCreditNotes={() => setExpandedPartnerId(expanded ? null : r.partnerId)}
              />
              {expanded && showNC && (
                <NotasCreditoDetailRow partnerId={r.partnerId} periodo={periodo} companiesParam={companiesParam} colSpan={columnCount} />
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );

  if (!scrollable) {
    return <div className="overflow-x-auto">{table}</div>;
  }

  return <div className="max-h-[420px] overflow-y-auto overflow-x-auto">{table}</div>;
}
