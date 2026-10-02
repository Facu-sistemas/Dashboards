import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useChartTheme } from '../shared/useChartTheme';

export interface MontoYHorasPoint {
  month: string;
  monto: number;
  horas: number;
}

interface Props {
  points: MontoYHorasPoint[];
  montoLabel: string;
}

const money = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
const horasFmt = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });
// timeZone: 'UTC' is load-bearing — see monthOptions.ts for why.
const monthLabelFmt = new Intl.DateTimeFormat('es-AR', { month: 'short', year: '2-digit', timeZone: 'UTC' });

function monthLabel(monthKey: string): string {
  const [y, m] = monthKey.split('-').map(Number);
  const label = monthLabelFmt.format(new Date(Date.UTC(y!, m! - 1, 1)));
  return label.charAt(0).toUpperCase() + label.slice(1);
}

const MONTH_WIDTH_PX = 90;
const MIN_CHART_WIDTH_PX = 480;

const HORAS_NAME = 'Horas de reparación';

export default function HorasYRecuperadoChart({ points, montoLabel }: Props) {
  const chartTheme = useChartTheme();
  if (points.length === 0) return null;

  const data = points.map((p) => ({
    month: monthLabel(p.month),
    monto: p.monto,
    horas: p.horas,
  }));
  const chartWidth = Math.max(data.length * MONTH_WIDTH_PX, MIN_CHART_WIDTH_PX);

  return (
    <div className="overflow-x-auto">
      <div style={{ width: chartWidth, height: 280 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
            <XAxis dataKey="month" stroke={chartTheme.axis} fontSize={12} />
            <YAxis yAxisId="money" stroke={chartTheme.axis} fontSize={12} tickFormatter={(v) => money.format(v)} width={90} />
            <YAxis
              yAxisId="horas"
              orientation="right"
              stroke={chartTheme.axisSecondary}
              fontSize={12}
              tickFormatter={(v) => horasFmt.format(v)}
            />
            <Tooltip
              contentStyle={{ background: chartTheme.tooltipBg, border: `1px solid ${chartTheme.tooltipBorder}`, borderRadius: 8 }}
              labelStyle={{ color: chartTheme.tooltipText }}
              formatter={(value, name) => {
                if (name === HORAS_NAME) {
                  return `${horasFmt.format(typeof value === 'number' ? value : 0)} hs`;
                }
                return money.format(typeof value === 'number' ? value : 0);
              }}
            />
            <Legend />
            <Bar yAxisId="money" dataKey="monto" fill={chartTheme.primary} name={montoLabel} isAnimationActive={false} />
            <Line
              yAxisId="horas"
              type="monotone"
              dataKey="horas"
              stroke={chartTheme.warn}
              strokeWidth={2}
              dot={{ r: 3 }}
              connectNulls={false}
              name={HORAS_NAME}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
