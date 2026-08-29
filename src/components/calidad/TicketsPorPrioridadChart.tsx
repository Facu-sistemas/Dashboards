import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { useChartTheme, type ChartTheme } from '../shared/useChartTheme';
import type { TicketsPorPrioridadRow } from './types';

interface Props {
  rows: TicketsPorPrioridadRow[];
}

const numberFmt = new Intl.NumberFormat('es-AR');

function colorFor(prioridad: string, theme: ChartTheme): string {
  switch (prioridad) {
    case 'Baja':
      return theme.secondary;
    case 'Media':
      return theme.primary;
    case 'Alta':
      return theme.warn;
    case 'Urgente':
      return theme.danger;
    default:
      return theme.mutedBar;
  }
}

export default function TicketsPorPrioridadChart({ rows }: Props) {
  const chartTheme = useChartTheme();
  const total = rows.reduce((sum, r) => sum + r.cantidad, 0);

  if (total === 0) {
    return <p className="py-16 text-center text-sm text-slate-500">Sin tickets registrados en este período.</p>;
  }

  const slices = rows.filter((r) => r.cantidad > 0).map((r) => ({ name: r.prioridad, value: r.cantidad, color: colorFor(r.prioridad, chartTheme) }));

  return (
    <ResponsiveContainer width="100%" height={320}>
      <PieChart>
        <Pie
          data={slices}
          dataKey="value"
          nameKey="name"
          cx="50%"
          cy="50%"
          innerRadius={70}
          outerRadius={110}
          paddingAngle={2}
          isAnimationActive={false}
          label={({ value }) => `${((Number(value) / total) * 100).toFixed(0)}%`}
        >
          {slices.map((slice) => (
            <Cell key={slice.name} fill={slice.color} stroke="none" />
          ))}
        </Pie>
        <Tooltip
          contentStyle={{ background: chartTheme.tooltipBg, border: `1px solid ${chartTheme.tooltipBorder}`, borderRadius: 8 }}
          labelStyle={{ color: chartTheme.tooltipText }}
          itemStyle={{ color: chartTheme.tooltipText }}
          formatter={(value, name) => [`${numberFmt.format(Number(value))} (${((Number(value) / total) * 100).toFixed(1)}%)`, name]}
        />
        <Legend />
      </PieChart>
    </ResponsiveContainer>
  );
}
