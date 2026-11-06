import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useChartTheme } from '@/components/shared/useChartTheme';
import type { TicketsPorMotivoRow } from './types';

const numberFmt = new Intl.NumberFormat('es-AR');

export default function TicketsPorMotivoChart({ rows }: { rows: TicketsPorMotivoRow[] }) {
  const chartTheme = useChartTheme();

  if (rows.length === 0) {
    return <p className="py-16 text-center text-sm text-slate-500">Sin tickets creados en este período.</p>;
  }

  const total = rows.reduce((s, r) => s + r.cantidad, 0);
  // Invertido para que el de mayor cantidad quede arriba, como un ranking.
  const data = [...rows].reverse().map((r) => ({ name: r.motivo, cantidad: r.cantidad }));
  const height = Math.max(200, data.length * 44);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 8, right: 24, left: 8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} horizontal={false} />
        <XAxis type="number" stroke={chartTheme.axis} fontSize={12} allowDecimals={false} />
        <YAxis type="category" dataKey="name" stroke={chartTheme.axis} fontSize={12} width={110} tick={{ fill: chartTheme.axisSecondary }} />
        <Tooltip
          cursor={{ fill: chartTheme.grid, opacity: 0.4 }}
          contentStyle={{ background: chartTheme.tooltipBg, border: `1px solid ${chartTheme.tooltipBorder}`, borderRadius: 8 }}
          labelStyle={{ color: chartTheme.tooltipText }}
          itemStyle={{ color: chartTheme.tooltipText }}
          formatter={(value) => [`${numberFmt.format(Number(value))} tickets (${((Number(value) / total) * 100).toFixed(0)}%)`, 'Cantidad']}
        />
        <Bar dataKey="cantidad" radius={[0, 4, 4, 0]} isAnimationActive={false}>
          {data.map((d) => (
            <Cell key={d.name} fill={d.name === 'Sin motivo' ? chartTheme.mutedBar : chartTheme.primary} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
