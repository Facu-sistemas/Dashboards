import { Bar, BarChart, CartesianGrid, Cell, LabelList, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useChartTheme } from '../shared/useChartTheme';
import { formatValue } from './format';

const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

interface Props {
  title: string;
  real: number[];
  objetivo: number[];
  diasTranscurridos: number[];
  diasTotal: number[];
  nMeses: number;
  format?: 'currency' | 'number';
}

function fmtGap(v: number, format: 'currency' | 'number') {
  const sign = v >= 0 ? '+' : '';
  return sign + formatValue(v, format);
}

/**
 * Desvío mensual (%): mismo gráfico que el tablero original
 * (public/data/index.html, makeDesvioPctChart) — barra = pct.cumplimiento
 * del mes menos 100, con la diferencia en unidades/$ como etiqueta arriba
 * (si sobró) o abajo (si faltó) de cada barra. `objetivo` ya viene prorrateado
 * a días hábiles transcurridos de cada mes individual (no acumulado).
 */
export default function DesvioMensualChart({ title, real, objetivo, diasTranscurridos, diasTotal, nMeses, format = 'number' }: Props) {
  const chartTheme = useChartTheme();

  const data = MESES.slice(0, nMeses).map((mes, i) => {
    const dt = diasTranscurridos[i] ?? 0;
    const dm = diasTotal[i] ?? 0;
    const objProrr = dm > 0 ? (objetivo[i] ?? 0) * (dt / dm) : 0;
    const r = real[i] ?? 0;
    const desv = objProrr > 0 ? (r / objProrr) * 100 - 100 : null;
    const gap = objProrr > 0 ? r - objProrr : null;
    return { mes, desv, gapLabel: gap === null ? '' : fmtGap(gap, format) };
  });

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-slate-800 bg-slate-900 p-4">
      <h3 className="text-sm font-medium text-slate-300">{title} · Desvío mensual (%)</h3>
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
            formatter={(value: number, _name, props) => [`${value >= 0 ? '+' : ''}${value.toFixed(1)}% (${props.payload.gapLabel})`, 'Desvío']}
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
