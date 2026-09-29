import { Bar, BarChart, CartesianGrid, Cell, LabelList, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useChartTheme } from '../shared/useChartTheme';
import { formatNumber } from './format';

const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

interface Props {
  title: string;
  ue: number[];
  cantidad: number[];
  nMeses: number;
}

function fmtGap(v: number) {
  const sign = v >= 0 ? '+' : '';
  return sign + formatNumber(v);
}

/**
 * Desvío mensual (%) entre cantidad y unidad equivalente — mismo formato que
 * DesvioMensualChart, pero sin prorrateo a días hábiles (no hay "objetivo",
 * son dos formas de medir lo mismo). En colchones el factor UE ronda 1, así
 * que el gráfico de barras agrupadas casi no se nota la diferencia; este
 * desvío la hace legible.
 */
export default function UeVsCantidadDesvioChart({ title, ue, cantidad, nMeses }: Props) {
  const chartTheme = useChartTheme();

  const data = MESES.slice(0, nMeses).map((mes, i) => {
    const u = ue[i] ?? 0;
    const c = cantidad[i] ?? 0;
    const desv = u > 0 ? (c / u) * 100 - 100 : null;
    const gap = u > 0 ? c - u : null;
    return { mes, desv, gapLabel: gap === null ? '' : fmtGap(gap) };
  });

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-slate-800 bg-slate-900 p-4">
      <h3 className="text-sm font-medium text-slate-300">{title} · Unidad equivalente vs Cantidad · Desvío mensual (%)</h3>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} margin={{ top: 18, right: 16, left: 0, bottom: 14 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} vertical={false} />
          <XAxis dataKey="mes" stroke={chartTheme.axis} fontSize={11} />
          <YAxis stroke={chartTheme.axis} fontSize={11} tickFormatter={(v) => `${Number(v).toFixed(0)}%`} width={44} />
          <ReferenceLine y={0} stroke={chartTheme.axis} />
          <Tooltip
            contentStyle={{ background: chartTheme.tooltipBg, border: `1px solid ${chartTheme.tooltipBorder}`, borderRadius: 8 }}
            labelStyle={{ color: chartTheme.tooltipText }}
            itemStyle={{ color: chartTheme.tooltipText }}
            formatter={(value: number, _name, props) => [`${value >= 0 ? '+' : ''}${value.toFixed(1)}% (${props.payload.gapLabel})`, 'Cantidad vs UE']}
          />
          <Bar dataKey="desv" radius={[3, 3, 3, 3]} isAnimationActive={false}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.desv === null ? chartTheme.mutedBar : d.desv >= 0 ? chartTheme.secondary : chartTheme.danger} />
            ))}
            <LabelList
              dataKey="gapLabel"
              position="top"
              content={(props) => {
                const { x, y, width, value, index } = props;
                const d = data[index as number];
                if (!value || d?.desv === null) return null;
                const isPositive = (d?.desv ?? 0) >= 0;
                const labelY = isPositive ? Number(y) - 6 : Number(y) + Number((props as { height?: number }).height ?? 0) + 12;
                return (
                  <text x={Number(x) + Number(width) / 2} y={labelY} fill={isPositive ? chartTheme.secondary : chartTheme.danger} fontSize={9} textAnchor="middle">
                    {value}
                  </text>
                );
              }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
