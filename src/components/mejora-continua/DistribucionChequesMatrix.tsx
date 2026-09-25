import { useMemo, useState } from 'react';
import { monthLabel } from './month-label';
import { formatCompactCurrency } from '../gerencia/format';
import { formatExactCurrency } from './amount-format';
import type { CreditoClientesData } from '../../lib/odoo/credito-clientes';

interface Props {
  data: CreditoClientesData;
}

interface MatrixRow {
  partnerId: number;
  partnerName: string;
  total: number;
  porMes: Map<string, number>;
}

export default function DistribucionChequesMatrix({ data }: Props) {
  const [search, setSearch] = useState('');
  const [exactPartnerId, setExactPartnerId] = useState<number | null>(null);

  const months = data.chequesPorMes.map((m) => m.month);
  const nameById = useMemo(() => new Map(data.clientes.map((c) => [c.partnerId, c.partnerName])), [data.clientes]);

  const rows: MatrixRow[] = useMemo(() => {
    const out: MatrixRow[] = [];
    for (const [idStr, meses] of Object.entries(data.chequesPorMesPorCliente)) {
      if (meses.length === 0) continue;
      const partnerId = Number(idStr);
      const porMes = new Map(meses.map((m) => [m.month, m.monto]));
      const total = meses.reduce((s, m) => s + m.monto, 0);
      out.push({ partnerId, partnerName: nameById.get(partnerId) ?? `#${partnerId}`, total, porMes });
    }
    return out.sort((a, b) => b.total - a.total);
  }, [data.chequesPorMesPorCliente, nameById]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? rows.filter((r) => r.partnerName.toLowerCase().includes(q)) : rows;
  }, [rows, search]);

  const grandTotalByMonth = useMemo(() => {
    const totals = new Map<string, number>();
    for (const month of months) totals.set(month, rows.reduce((s, r) => s + (r.porMes.get(month) ?? 0), 0));
    return totals;
  }, [rows, months]);
  const grandTotal = [...grandTotalByMonth.values()].reduce((s, v) => s + v, 0);

  if (months.length === 0) {
    return <p className="py-8 text-center text-sm text-slate-500">Sin cheques con fecha de pago futura.</p>;
  }

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
          {filtered.length.toLocaleString('es-AR')} de {rows.length.toLocaleString('es-AR')} clientes con cheques · click en una fila para ver sus cifras exactas
        </p>
      </div>

      {filtered.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-500">Sin resultados.</p>
      ) : (
        <div className="max-h-[600px] overflow-auto rounded border border-slate-800">
          {/* table-fixed + colgroup: el ancho de cada columna queda fijo desde el
              arranque (dimensionado para el monto exacto más largo posible), así
              alternar compacto/exacto en una fila no recalcula el ancho de toda la
              tabla ni corre el scroll horizontal. */}
          <table className="w-full min-w-[760px] table-fixed border-collapse text-sm">
            <colgroup>
              <col className="w-[220px]" />
              {months.map((m) => (
                <col key={m} className="w-[175px]" />
              ))}
              <col className="w-[175px]" />
            </colgroup>
            <thead className="sticky top-0 z-20 bg-slate-900">
              <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="sticky left-0 z-20 whitespace-nowrap bg-slate-900 py-2 pl-3 pr-4 font-medium">Cliente</th>
                {months.map((m) => (
                  <th key={m} className="whitespace-nowrap py-2 pr-4 text-right font-medium">
                    {monthLabel(m)}
                  </th>
                ))}
                <th className="whitespace-nowrap py-2 pr-4 text-right font-medium text-slate-300">Total</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const exact = r.partnerId === exactPartnerId;
                const fmt = exact ? formatExactCurrency : formatCompactCurrency;
                const rowBg = exact ? 'bg-slate-700/50' : 'hover:bg-slate-800/40';
                const stickyBg = exact ? 'bg-slate-700' : 'bg-slate-950';
                return (
                  <tr
                    key={r.partnerId}
                    onClick={() => setExactPartnerId((prev) => (prev === r.partnerId ? null : r.partnerId))}
                    className={`cursor-pointer border-b border-slate-800/60 last:border-0 ${rowBg}`}
                  >
                    <td className={`sticky left-0 z-10 truncate py-2 pl-3 pr-4 text-slate-200 ${stickyBg}`} title={r.partnerName}>
                      {r.partnerName}
                    </td>
                    {months.map((m) => {
                      const monto = r.porMes.get(m) ?? 0;
                      return (
                        <td key={m} className="whitespace-nowrap py-2 pr-4 text-right tabular-nums text-slate-300">
                          {monto === 0 ? <span className="text-slate-700">—</span> : fmt(monto)}
                        </td>
                      );
                    })}
                    <td className="whitespace-nowrap py-2 pr-4 text-right tabular-nums font-semibold text-slate-100">{fmt(r.total)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="sticky bottom-0 z-20 bg-slate-900">
              <tr className="border-t border-slate-800 text-xs uppercase tracking-wide text-slate-400">
                <th className="sticky left-0 z-20 whitespace-nowrap bg-slate-900 py-2 pl-3 pr-4 text-left font-medium">Total</th>
                {months.map((m) => (
                  <td key={m} className="whitespace-nowrap py-2 pr-4 text-right tabular-nums font-semibold text-slate-200">
                    {formatCompactCurrency(grandTotalByMonth.get(m) ?? 0)}
                  </td>
                ))}
                <td className="whitespace-nowrap py-2 pr-4 text-right tabular-nums font-semibold text-brand-400">{formatCompactCurrency(grandTotal)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
