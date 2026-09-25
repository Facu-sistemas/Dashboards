import { Fragment, useMemo, useState } from 'react';
import { formatCompactCurrency } from '../gerencia/format';
import { monthLabel } from './month-label';
import { formatExactCurrency } from './amount-format';
import type { ChequeMesPoint, ClienteCreditoRow } from '../../lib/odoo/credito-clientes';

export type CreditoSortBy = 'totalCredito' | 'totalPorCobrar' | 'totalChequesActivos' | 'pedidosPendientesConIva';

const COLUMN_COUNT = 7;

interface Props {
  rows: ClienteCreditoRow[];
  chequesPorMesPorCliente: Record<number, ChequeMesPoint[]>;
  selectedPartnerId: number | null;
  onSelectClient: (partnerId: number) => void;
  sortBy: CreditoSortBy;
  onSortByChange: (sortBy: CreditoSortBy) => void;
}

/** Fila expandida con el detalle mes a mes de los cheques de un cliente — mismo dato que alimenta el gráfico de arriba, pero en cifras exactas. */
function ChequesMesDetailRow({ meses, colSpan }: { meses: ChequeMesPoint[]; colSpan: number }) {
  return (
    <tr className="border-b border-slate-800/60 bg-slate-950/40">
      <td colSpan={colSpan} className="px-4 py-3">
        {meses.length === 0 ? (
          <p className="text-xs text-slate-500">Sin cheques en cartera con fecha de pago futura.</p>
        ) : (
          <div className="flex flex-wrap gap-4">
            {meses.map((m) => (
              <div key={m.month} className="flex flex-col">
                <span className="text-[10px] uppercase tracking-wide text-slate-500">{monthLabel(m.month)}</span>
                <span className="text-sm tabular-nums text-slate-200">{formatExactCurrency(m.monto)}</span>
              </div>
            ))}
          </div>
        )}
      </td>
    </tr>
  );
}

const SORT_LABELS: Record<CreditoSortBy, string> = {
  totalCredito: 'Total Crédito',
  totalPorCobrar: 'Por Cobrar',
  totalChequesActivos: 'Cheques Activos',
  pedidosPendientesConIva: 'Pedidos Pend.',
};

function SortableHeader({
  sortKey,
  active,
  onClick,
  title,
}: {
  sortKey: CreditoSortBy;
  active: boolean;
  onClick: () => void;
  title?: string;
}) {
  return (
    <th className="py-2 pr-4 text-right font-medium">
      <button
        type="button"
        onClick={onClick}
        title={title}
        className={`inline-flex items-center gap-1 hover:text-slate-300 ${active ? 'text-brand-400' : ''}`}
      >
        {SORT_LABELS[sortKey]}
        {active && <span aria-hidden>▾</span>}
      </button>
    </th>
  );
}

/** Rojo si ya superó el límite, ámbar si está por encima del 80%, verde si hay margen — null cuando no hay límite cargado. */
function usoLimiteColor(totalCredito: number, limiteCredito: number): string | null {
  if (limiteCredito <= 0) return null;
  const pct = totalCredito / limiteCredito;
  if (pct >= 1) return 'text-status-red';
  if (pct >= 0.8) return 'text-status-yellow';
  return 'text-status-green';
}

export default function CreditoChequesTable({ rows, chequesPorMesPorCliente, selectedPartnerId, onSelectClient, sortBy, onSortByChange }: Props) {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = q ? rows.filter((r) => r.partnerName.toLowerCase().includes(q)) : rows;
    return [...base].sort((a, b) => b[sortBy] - a[sortBy]);
  }, [rows, search, sortBy]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar cliente..."
          className="w-64 rounded border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-brand-500 focus:outline-none"
        />
        <p className="text-xs text-slate-500">
          {filtered.length.toLocaleString('es-AR')} de {rows.length.toLocaleString('es-AR')} clientes
        </p>
      </div>

      {filtered.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-500">Sin resultados.</p>
      ) : (
        <div className="max-h-[480px] overflow-y-auto overflow-x-auto rounded border border-slate-800">
          <table className="w-full min-w-[760px] border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-slate-900">
              <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="py-2 pl-3 pr-4 font-medium">Cliente</th>
                <SortableHeader sortKey="totalPorCobrar" active={sortBy === 'totalPorCobrar'} onClick={() => onSortByChange('totalPorCobrar')} />
                <th className="py-2 pr-4 text-right font-medium">Límite</th>
                <SortableHeader
                  sortKey="totalChequesActivos"
                  active={sortBy === 'totalChequesActivos'}
                  onClick={() => onSortByChange('totalChequesActivos')}
                  title="Click en una fila para ver el detalle mes a mes"
                />
                <th className="py-2 pr-4 text-right font-medium">Pedidos (neto)</th>
                <SortableHeader sortKey="pedidosPendientesConIva" active={sortBy === 'pedidosPendientesConIva'} onClick={() => onSortByChange('pedidosPendientesConIva')} />
                <SortableHeader sortKey="totalCredito" active={sortBy === 'totalCredito'} onClick={() => onSortByChange('totalCredito')} />
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const selected = r.partnerId === selectedPartnerId;
                const usoColor = usoLimiteColor(r.totalCredito, r.limiteCredito);
                return (
                  <Fragment key={r.partnerId}>
                    <tr
                      onClick={() => onSelectClient(r.partnerId)}
                      className={`cursor-pointer border-b border-slate-800/60 last:border-0 hover:bg-slate-800/40 ${selected ? 'bg-brand-500/10' : ''}`}
                    >
                      <td className="py-2 pl-3 pr-4 text-slate-200">
                        <span className="mr-1 inline-block w-3 text-slate-600">{selected ? '▾' : '▸'}</span>
                        {r.partnerName}
                      </td>
                      <td className="py-2 pr-4 text-right tabular-nums text-slate-300">{formatCompactCurrency(r.totalPorCobrar)}</td>
                      <td className="py-2 pr-4 text-right tabular-nums text-slate-400">
                        {r.limiteCredito > 0 ? formatCompactCurrency(r.limiteCredito) : '—'}
                      </td>
                      <td className="py-2 pr-4 text-right tabular-nums text-slate-300">{formatCompactCurrency(r.totalChequesActivos)}</td>
                      <td className="py-2 pr-4 text-right tabular-nums text-slate-400">{formatCompactCurrency(r.pedidosPendientesNeto)}</td>
                      <td className="py-2 pr-4 text-right tabular-nums text-slate-300">{formatCompactCurrency(r.pedidosPendientesConIva)}</td>
                      <td className={`py-2 pr-4 text-right tabular-nums font-semibold ${usoColor ?? 'text-slate-100'}`}>
                        {formatCompactCurrency(r.totalCredito)}
                      </td>
                    </tr>
                    {selected && <ChequesMesDetailRow meses={chequesPorMesPorCliente[r.partnerId] ?? []} colSpan={COLUMN_COUNT} />}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
