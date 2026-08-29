import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useChartTheme } from '../shared/useChartTheme';
import type { TicketsPorTipoRow } from './types';

interface Props {
  rows: TicketsPorTipoRow[];
}

const numberFmt = new Intl.NumberFormat('es-AR');

export default function TicketsPorTipoChart({ rows }: Props) {
  const chartTheme = useChartTheme();

  if (rows.length === 0) {
    return <p className="py-16 text-center text-sm text-slate-500">Sin tickets registrados en este período.</p>;
  }

  // Reverse so the highest count lands at the top, matching how a ranking reads.
  const data = [...rows].reverse().map((r) => ({ name: r.tipo, cantidad: r.cantidad }));
  const height = Math.max(200, data.length * 44);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 8, right: 24, left: 8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} horizontal={false} />
        <XAxis type="number" stroke={chartTheme.axis} fontSize={12} allowDecimals={false} />
        <YAxis type="category" dataKey="name" stroke={chartTheme.axis} fontSize={12} width={140} tick={{ fill: chartTheme.axisSecondary }} />
        <Tooltip
          contentStyle={{ background: chartTheme.tooltipBg, border: `1px solid ${chartTheme.tooltipBorder}`, borderRadius: 8 }}
          labelStyle={{ color: chartTheme.tooltipText }}
          itemStyle={{ color: chartTheme.tooltipText }}
          formatter={(value) => [`${numberFmt.format(Number(value))} tickets`, 'Cantidad']}
        />
        <Bar dataKey="cantidad" radius={[0, 4, 4, 0]} isAnimationActive={false}>
          {data.map((d) => (
            <Cell key={d.name} fill={d.name === 'Sin tipo' ? chartTheme.mutedBar : chartTheme.primary} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
