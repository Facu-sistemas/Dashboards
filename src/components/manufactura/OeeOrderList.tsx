import type { OeeOrderSummary } from './types';

interface Props {
  title: string;
  orders: OeeOrderSummary[];
  total: number;
  emptyLabel: string;
}

export default function OeeOrderList({ title, orders, total, emptyLabel }: Props) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-slate-800 bg-slate-900 p-4">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-medium text-slate-300">{title}</h3>
        <span className="text-xs text-slate-500">{total}</span>
      </div>
      {orders.length === 0 ? (
        <p className="py-4 text-center text-sm text-slate-500">{emptyLabel}</p>
      ) : (
        <ul className="max-h-72 overflow-y-auto text-sm">
          {orders.map((o) => (
            <li key={o.id} className="flex items-baseline justify-between gap-3 border-b border-slate-800/60 py-1.5 last:border-0">
              <span className="truncate text-slate-200">{o.productName}</span>
              <span className="shrink-0 text-xs text-slate-500">{o.reference}</span>
            </li>
          ))}
        </ul>
      )}
      {total > orders.length && (
        <p className="text-xs text-slate-600">Mostrando {orders.length} de {total}.</p>
      )}
    </div>
  );
}
