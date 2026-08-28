import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useChartTheme } from '../shared/useChartTheme';
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
  const chartTheme = useChartTheme();
  const data = points.map((p) => ({ month: monthLabel(p.month), consumption: p.consumption }));

  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
        <XAxis dataKey="month" stroke={chartTheme.axis} fontSize={12} />
        <YAxis stroke={chartTheme.axis} fontSize={12} tickFormatter={(v) => numberFmt.format(Number(v))} width={70} />
        <Tooltip
          contentStyle={{ background: chartTheme.tooltipBg, border: `1px solid ${chartTheme.tooltipBorder}`, borderRadius: 8 }}
          labelStyle={{ color: chartTheme.tooltipText }}
          itemStyle={{ color: chartTheme.tooltipText }}
          formatter={(value) => [`${numberFmt.format(Number(value))} / mes`, 'Consumo']}
        />
        <Bar dataKey="consumption" fill={chartTheme.primary} radius={[4, 4, 0, 0]} name="Consumo mensual" isAnimationActive={false} />
        {reorderPoint !== null && (
          <ReferenceLine
            y={reorderPoint}
            stroke={chartTheme.danger}
            strokeDasharray="4 4"
            label={{ value: 'Punto de reorden', position: 'insideBottomRight', fill: chartTheme.danger, fontSize: 11 }}
          />
        )}
      </BarChart>
    </ResponsiveContainer>
  );
}
