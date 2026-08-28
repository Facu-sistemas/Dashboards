import type { ParetoClientRow } from './types';

interface Props {
  rows: ParetoClientRow[];
  primaryId: number | null;
  secondaryId: number | null;
  onSelect: (row: ParetoClientRow) => void;
}

const money = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
const units = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });

export default function ClientRankingTable({ rows, primaryId, secondaryId, onSelect }: Props) {
  if (rows.length === 0) {
    return <p className="py-8 text-center text-sm text-slate-500">Sin clientes facturados en este período.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[420px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wide text-slate-500">
            <th className="py-2 pr-4 font-medium">Cliente</th>
            <th className="py-2 pr-4 font-medium">Facturación</th>
            <th className="py-2 font-medium">Unidades</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const isPrimary = r.partnerId === primaryId;
            const isSecondary = r.partnerId === secondaryId;
            return (
              <tr
                key={r.partnerId}
                onClick={() => onSelect(r)}
                className={`cursor-pointer border-b border-slate-800/60 last:border-0 hover:bg-slate-800/60 ${
                  isPrimary ? 'bg-brand-500/10' : isSecondary ? 'bg-emerald-500/10' : ''
                }`}
              >
                <td className="py-2 pr-4 text-slate-200">
                  {r.partnerName}
                  {isPrimary && <span className="ml-2 text-brand-400">●</span>}
                  {isSecondary && <span className="ml-2 text-emerald-400">●</span>}
                </td>
                <td className="py-2 pr-4 text-slate-300">{money.format(r.amount)}</td>
                <td className="py-2 text-slate-300">{units.format(r.unitsSold)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
