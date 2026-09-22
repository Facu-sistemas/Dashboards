import { formatCompactCurrency, formatNumber } from '../gerencia/format';
import type { TendenciaMensualRow } from '../../lib/odoo/clientes-activos';

// timeZone: 'UTC' — mismo motivo que en los demás gráficos mensuales del proyecto (monthOptions.ts): un "YYYY-MM" no tiene hora, y sin fijar la zona el mes puede leerse corrido en Argentina.
const monthLabelFormatter = new Intl.DateTimeFormat('es-AR', { month: 'short', year: '2-digit', timeZone: 'UTC' });

function monthLabel(monthKey: string): string {
  const [year, month] = monthKey.split('-').map(Number);
  const label = monthLabelFormatter.format(new Date(Date.UTC(year ?? 2026, (month ?? 1) - 1, 1)));
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** Flecha de variación contra el mes anterior — null en el primer mes de la serie (no hay con qué comparar). */
function Variacion({ actual, anterior }: { actual: number; anterior: number | null }) {
  if (anterior === null || anterior === 0) return null;
  const pct = ((actual - anterior) / anterior) * 100;
  if (Math.abs(pct) < 0.5) return <span className="ml-1.5 text-xs text-slate-500">≈</span>;
  return (
    <span className={`ml-1.5 text-xs font-medium ${pct >= 0 ? 'text-status-green' : 'text-status-red'}`}>
      {pct >= 0 ? '▲' : '▼'} {Math.abs(pct).toFixed(0)}%
    </span>
  );
}

interface Props {
  rows: TendenciaMensualRow[];
}

/** Detalle exacto mes a mes — el gráfico de al lado (TendenciaMensualChart) es para ver la forma de la tendencia de un vistazo. */
export default function TendenciaMensualTable({ rows }: Props) {
  if (rows.length === 0) return null;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wide text-slate-500">
            <th className="py-2 pr-4 font-medium">Mes</th>
            <th className="py-2 pr-4 text-right font-medium">Clientes activos</th>
            <th className="py-2 pr-4 text-right font-medium">Facturas</th>
            <th className="py-2 pr-4 text-right font-medium">Facturado</th>
            <th className="py-2 text-right font-medium">Notas de crédito</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const prev = i > 0 ? rows[i - 1]! : null;
            return (
              <tr key={r.month} className="border-b border-slate-800/60 last:border-0">
                <td className="py-2 pr-4 text-slate-300">{monthLabel(r.month)}</td>
                <td className="py-2 pr-4 text-right text-slate-100">
                  {formatNumber(r.clientesActivos)}
                  <Variacion actual={r.clientesActivos} anterior={prev?.clientesActivos ?? null} />
                </td>
                <td className="py-2 pr-4 text-right text-slate-100">{formatNumber(r.facturas)}</td>
                <td className="py-2 pr-4 text-right text-slate-100">
                  {formatCompactCurrency(r.facturado)}
                  <Variacion actual={r.facturado} anterior={prev?.facturado ?? null} />
                </td>
                <td className="py-2 text-right text-amber-400">{formatCompactCurrency(r.notasCreditoMonto)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
