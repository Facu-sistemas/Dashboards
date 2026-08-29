import type { OeeCategoryGauge, OeeMonthlyRow } from './types';

interface Props {
  rows: OeeMonthlyRow[];
}

const units = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });
const pctFmt = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });
// timeZone: 'UTC' is load-bearing — see monthOptions.ts for why.
const monthLabelFmt = new Intl.DateTimeFormat('es-AR', { month: 'short', year: '2-digit', timeZone: 'UTC' });

function monthLabel(monthKey: string): string {
  const [y, m] = monthKey.split('-').map(Number);
  return monthLabelFmt.format(new Date(Date.UTC(y!, m! - 1, 1)));
}

function cell(gauge: OeeCategoryGauge): string {
  return `${units.format(gauge.produced)} / ${units.format(gauge.planned)} u. (${pctFmt.format(gauge.pctComplete)}%)`;
}

export default function OeeMonthlySummary({ rows }: Props) {
  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      <h3 className="mb-3 text-sm font-medium text-slate-300">Últimos 6 meses — cumplido / planificado</h3>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="py-2 pr-4 font-medium">Mes</th>
              <th className="py-2 pr-4 font-medium">Colchones</th>
              <th className="py-2 pr-4 font-medium">Living</th>
              <th className="py-2 font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.month} className="border-b border-slate-800/60 last:border-0">
                <td className="py-2 pr-4 capitalize text-slate-200">{monthLabel(r.month)}</td>
                <td className="py-2 pr-4 text-slate-300">{cell(r.colchones)}</td>
                <td className="py-2 pr-4 text-slate-300">{cell(r.living)}</td>
                <td className="py-2 text-slate-300">{cell(r.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
