import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useChartTheme } from '../shared/useChartTheme';

export interface CantidadVsProduccionPoint {
  month: string;
  unidadesFabricadas: number;
  cantidad: number;
  ratio: number | null;
}

interface Props {
  points: CantidadVsProduccionPoint[];
  fabricadoLabel: string;
  cantidadLabel: string;
  ratioLabel: string;
}

const unidades = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });
// timeZone: 'UTC' is load-bearing — see monthOptions.ts for why.
const monthLabelFmt = new Intl.DateTimeFormat('es-AR', { month: 'short', year: '2-digit', timeZone: 'UTC' });

function monthLabel(monthKey: string): string {
  const [y, m] = monthKey.split('-').map(Number);
  const label = monthLabelFmt.format(new Date(Date.UTC(y!, m! - 1, 1)));
  return label.charAt(0).toUpperCase() + label.slice(1);
}

const MONTH_WIDTH_PX = 90;
const MIN_CHART_WIDTH_PX = 480;

export default function ReparacionesVsProduccionChart({ points, fabricadoLabel, cantidadLabel, ratioLabel }: Props) {
  const chartTheme = useChartTheme();
  if (points.length === 0) return null;

  const data = points.map((p) => ({
    month: monthLabel(p.month),
    unidadesFabricadas: p.unidadesFabricadas,
    cantidad: p.cantidad,
    ratio: p.ratio,
  }));
  const chartWidth = Math.max(data.length * MONTH_WIDTH_PX, MIN_CHART_WIDTH_PX);

  return (
    <div className="overflow-x-auto">
      <div style={{ width: chartWidth, height: 280 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
            <XAxis dataKey="month" stroke={chartTheme.axis} fontSize={12} />
            <YAxis yAxisId="unidades" stroke={chartTheme.axis} fontSize={12} tickFormatter={(v) => unidades.format(v)} width={70} />
            <YAxis
              yAxisId="ratio"
              orientation="right"
              stroke={chartTheme.axisSecondary}
              fontSize={12}
              tickFormatter={(v) => unidades.format(v)}
            />
            <Tooltip
              contentStyle={{ background: chartTheme.tooltipBg, border: `1px solid ${chartTheme.tooltipBorder}`, borderRadius: 8 }}
              labelStyle={{ color: chartTheme.tooltipText }}
              formatter={(value, name, item) => {
                if (name === ratioLabel) {
                  return typeof value === 'number' ? unidades.format(value) : 'Sin unidades fabricadas ese mes';
                }
                const formatted = unidades.format(typeof value === 'number' ? value : 0);
                if (name === cantidadLabel) {
                  const fabricadas = (item.payload as { unidadesFabricadas: number } | undefined)?.unidadesFabricadas ?? 0;
                  const cantidad = typeof value === 'number' ? value : 0;
                  const pct = fabricadas > 0 ? `${((cantidad / fabricadas) * 100).toFixed(1)}%` : 'sin fabricación ese mes';
                  return `${formatted} (${pct} del total fabricado)`;
                }
                return formatted;
              }}
            />
            <Legend />
            <Bar yAxisId="unidades" dataKey="unidadesFabricadas" fill={chartTheme.primary} name={fabricadoLabel} isAnimationActive={false} />
            <Bar yAxisId="unidades" dataKey="cantidad" fill={chartTheme.secondary} name={cantidadLabel} isAnimationActive={false} />
            <Line
              yAxisId="ratio"
              type="monotone"
              dataKey="ratio"
              stroke={chartTheme.warn}
              strokeWidth={2}
              dot={{ r: 3 }}
              connectNulls={false}
              name={ratioLabel}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
