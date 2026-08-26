import StatusBadge from './StatusBadge';
import type { CategoryBudgetStatus, PurchaseCurrency } from './types';

interface Props {
  currency: PurchaseCurrency;
  rows: CategoryBudgetStatus[];
}

function formatter(currency: PurchaseCurrency) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  });
}

export default function ComplianceTable({ currency, rows }: Props) {
  const money = formatter(currency);

  if (rows.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-slate-500">
        Sin compras registradas en {currency} para este período.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wide text-slate-500">
            <th className="py-2 pr-4 font-medium">Categoría</th>
            <th className="py-2 pr-4 font-medium">Presupuestado</th>
            <th className="py-2 pr-4 font-medium">Real</th>
            <th className="py-2 pr-4 font-medium">% Cumplimiento</th>
            <th className="py-2 font-medium">Estado</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.categoryId} className="border-b border-slate-800/60 last:border-0">
              <td className="py-2 pr-4 text-slate-200">{r.categoryName}</td>
              <td className="py-2 pr-4 text-slate-300">
                {r.budgetAmount !== null ? money.format(r.budgetAmount) : <span className="text-slate-600">—</span>}
              </td>
              <td className="py-2 pr-4 text-slate-300">{money.format(r.realAmount)}</td>
              <td className="py-2 pr-4 text-slate-300">
                {r.compliancePct !== null ? `${r.compliancePct.toFixed(0)}%` : <span className="text-slate-600">—</span>}
              </td>
              <td className="py-2">
                <StatusBadge status={r.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
