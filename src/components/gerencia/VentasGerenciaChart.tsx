import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useChartTheme } from '../shared/useChartTheme';
import { formatValue as fmt } from './format';

const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

interface Props {
  title: string;
  real: number[];
  objetivo: number[];
  nMeses: number;
  format?: 'currency' | 'number';
}

export default function VentasGerenciaChart({ title, real, objetivo, nMeses, format = 'number' }: Props) {
  const chartTheme = useChartTheme();
  const data = MESES.slice(0, nMeses).map((mes, i) => ({ mes, real: real[i] ?? 0, objetivo: objetivo[i] ?? 0 }));

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-slate-800 bg-slate-900 p-4">
      <h3 className="text-sm font-medium text-slate-300">{title} · Real vs Objetivo</h3>
      <ResponsiveContainer width="100%" height={220}>
        <ComposedChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} vertical={false} />
          <XAxis dataKey="mes" stroke={chartTheme.axis} fontSize={11} />
          <YAxis stroke={chartTheme.axis} fontSize={11} tickFormatter={(v) => fmt(Number(v), format)} width={format === 'currency' ? 56 : 48} />
          <Tooltip
            contentStyle={{ background: chartTheme.tooltipBg, border: `1px solid ${chartTheme.tooltipBorder}`, borderRadius: 8 }}
            labelStyle={{ color: chartTheme.tooltipText }}
            itemStyle={{ color: chartTheme.tooltipText }}
            formatter={(value: number) => fmt(value, format)}
          />
          <Legend />
          <Bar dataKey="real" name="Real" fill={chartTheme.primary} radius={[4, 4, 0, 0]} isAnimationActive={false} />
          <Line type="monotone" dataKey="objetivo" name="Objetivo" stroke={chartTheme.axisSecondary} strokeDasharray="5 4" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
