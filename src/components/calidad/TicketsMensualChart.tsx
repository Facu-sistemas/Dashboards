import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useChartTheme } from '../shared/useChartTheme';
import type { TicketsMonthlyPoint } from './types';

interface Props {
  points: TicketsMonthlyPoint[];
}

// timeZone: 'UTC' is load-bearing — see monthOptions.ts for why.
const monthLabelFmt = new Intl.DateTimeFormat('es-AR', { month: 'short', year: '2-digit', timeZone: 'UTC' });

function monthLabel(monthKey: string): string {
  const [y, m] = monthKey.split('-').map(Number);
  const label = monthLabelFmt.format(new Date(Date.UTC(y!, m! - 1, 1)));
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export default function TicketsMensualChart({ points }: Props) {
  const chartTheme = useChartTheme();
  if (points.length === 0) return null;

  const data = points.map((p) => ({ month: monthLabel(p.month), cantidad: p.cantidad }));

  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
        <XAxis dataKey="month" stroke={chartTheme.axis} fontSize={12} />
        <YAxis stroke={chartTheme.axis} fontSize={12} allowDecimals={false} width={40} />
        <Tooltip
          contentStyle={{ background: chartTheme.tooltipBg, border: `1px solid ${chartTheme.tooltipBorder}`, borderRadius: 8 }}
          labelStyle={{ color: chartTheme.tooltipText }}
          itemStyle={{ color: chartTheme.tooltipText }}
          formatter={(value) => [`${value} tickets`, 'Cantidad']}
        />
        <Bar dataKey="cantidad" fill={chartTheme.primary} radius={[4, 4, 0, 0]} isAnimationActive={false} name="Cantidad de tickets" />
      </BarChart>
    </ResponsiveContainer>
  );
}
