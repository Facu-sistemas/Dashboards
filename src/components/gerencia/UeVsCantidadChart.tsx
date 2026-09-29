import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useChartTheme } from '../shared/useChartTheme';
import { formatNumber } from './format';

const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

interface Props {
  title: string;
  ue: number[];
  cantidad: number[];
  nMeses: number;
}

/** Barras agrupadas por mes: unidad equivalente vs cantidad — no depende del toggle de medida, muestra siempre las dos. */
export default function UeVsCantidadChart({ title, ue, cantidad, nMeses }: Props) {
  const chartTheme = useChartTheme();
  const data = MESES.slice(0, nMeses).map((mes, i) => ({ mes, ue: ue[i] ?? 0, cantidad: cantidad[i] ?? 0 }));

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-slate-800 bg-slate-900 p-4">
      <h3 className="text-sm font-medium text-slate-300">{title} · Unidad equivalente vs Cantidad</h3>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} vertical={false} />
          <XAxis dataKey="mes" stroke={chartTheme.axis} fontSize={11} />
          <YAxis stroke={chartTheme.axis} fontSize={11} tickFormatter={(v) => formatNumber(Number(v))} width={48} />
          <Tooltip
            contentStyle={{ background: chartTheme.tooltipBg, border: `1px solid ${chartTheme.tooltipBorder}`, borderRadius: 8 }}
            labelStyle={{ color: chartTheme.tooltipText }}
            itemStyle={{ color: chartTheme.tooltipText }}
            formatter={(value: number) => formatNumber(value)}
          />
          <Legend />
          <Bar dataKey="ue" name="Unidad equivalente" fill={chartTheme.primary} radius={[4, 4, 0, 0]} isAnimationActive={false} />
          <Bar dataKey="cantidad" name="Cantidad" fill={chartTheme.secondary} radius={[4, 4, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
