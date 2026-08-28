import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { useChartTheme } from '../shared/useChartTheme';
import type { FacturacionComparison } from './types';

interface Props {
  data: FacturacionComparison;
}

const money = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });

export default function FacturacionSplitPieChart({ data }: Props) {
  const chartTheme = useChartTheme();
  const total = data.banco.total + data.efectivo.total;

  if (total <= 0) {
    return <p className="py-16 text-center text-sm text-slate-500">Sin facturación registrada para este período.</p>;
  }

  const slices = [
    { name: 'Facturación 1 (Banco)', value: data.banco.total, color: chartTheme.primary },
    { name: 'Facturación 2 (Efectivo)', value: data.efectivo.total, color: chartTheme.secondary },
  ];

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
          label={({ value }) => `${((Number(value) / total) * 100).toFixed(1)}%`}
        >
          {slices.map((slice) => (
            <Cell key={slice.name} fill={slice.color} stroke="none" />
          ))}
        </Pie>
        <Tooltip
          contentStyle={{ background: chartTheme.tooltipBg, border: `1px solid ${chartTheme.tooltipBorder}`, borderRadius: 8 }}
          labelStyle={{ color: chartTheme.tooltipText }}
          itemStyle={{ color: chartTheme.tooltipText }}
          formatter={(value, name) => [`${money.format(Number(value))} (${((Number(value) / total) * 100).toFixed(1)}%)`, name]}
        />
        <Legend />
      </PieChart>
    </ResponsiveContainer>
  );
}
