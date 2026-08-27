import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { MaterialMonthlyPoint } from './types';

interface Props {
  points: MaterialMonthlyPoint[];
  reorderPoint: number | null;
}

const numberFmt = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });
// timeZone: 'UTC' is load-bearing — see monthOptions.ts for why.
const monthLabelFormatter = new Intl.DateTimeFormat('es-AR', { month: 'short', year: '2-digit', timeZone: 'UTC' });

function monthLabel(monthKey: string): string {
  const [year, month] = monthKey.split('-').map(Number);
  const label = monthLabelFormatter.format(new Date(Date.UTC(year ?? 2026, (month ?? 1) - 1, 1)));
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/**
 * Trend chart — the exact snapshot numbers (stock, days-to-stockout) live
 * in the stat row above this, not overlaid here. The one exception is the
 * reorder-point line: kept as a light visual anchor on user request, even
 * though strictly speaking it's a level (as of today) drawn over a flow
 * (monthly movement) — it's just a reference, not implying the bars
 * "cross" it in any literal sense.
 */
export default function MaterialHistoryChart({ points, reorderPoint }: Props) {
  const data = points.map((p) => ({ month: monthLabel(p.month), consumption: p.consumption }));

  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
        <XAxis dataKey="month" stroke="#64748b" fontSize={12} />
        <YAxis stroke="#64748b" fontSize={12} tickFormatter={(v) => numberFmt.format(Number(v))} width={70} />
        <Tooltip
          contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8 }}
          labelStyle={{ color: '#e2e8f0' }}
          itemStyle={{ color: '#e2e8f0' }}
          formatter={(value) => [`${numberFmt.format(Number(value))} / mes`, 'Consumo']}
        />
        <Bar dataKey="consumption" fill="#2f6fed" radius={[4, 4, 0, 0]} name="Consumo mensual" isAnimationActive={false} />
        {reorderPoint !== null && (
          <ReferenceLine
            y={reorderPoint}
            stroke="#ef4444"
            strokeDasharray="4 4"
            label={{ value: 'Punto de reorden', position: 'insideBottomRight', fill: '#ef4444', fontSize: 11 }}
          />
        )}
      </BarChart>
    </ResponsiveContainer>
  );
}
