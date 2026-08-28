import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useChartTheme } from '../shared/useChartTheme';
import type { FacturacionTrendPoint } from './types';

interface Props {
  points: FacturacionTrendPoint[];
}

const money = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
// timeZone: 'UTC' is load-bearing — see monthOptions.ts for why.
const monthLabelFormatter = new Intl.DateTimeFormat('es-AR', { month: 'short', year: '2-digit', timeZone: 'UTC' });

function monthLabel(monthKey: string): string {
  const [year, month] = monthKey.split('-').map(Number);
  const label = monthLabelFormatter.format(new Date(Date.UTC(year ?? 2026, (month ?? 1) - 1, 1)));
  return label.charAt(0).toUpperCase() + label.slice(1);
}

// Fixed px per month + a floor width, so the chart is wider than its
// container once there are enough months — that's what makes the
// surrounding `overflow-x-auto` wrapper actually scroll instead of just
// squeezing everything into the visible width.
const MONTH_WIDTH_PX = 90;
const MIN_CHART_WIDTH_PX = 480;

const RATIO_NAME = 'Ratio (Banco / Efectivo)';

export default function FacturacionTrendChart({ points }: Props) {
  const chartTheme = useChartTheme();
  if (points.length === 0) return null;

  const data = points.map((p) => ({
    month: monthLabel(p.month),
    banco: p.banco,
    efectivo: p.efectivo,
    ratio: p.ratio,
  }));

  const chartWidth = Math.max(data.length * MONTH_WIDTH_PX, MIN_CHART_WIDTH_PX);

  return (
    <div className="overflow-x-auto">
      <div style={{ width: chartWidth, height: 320 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
            <XAxis dataKey="month" stroke={chartTheme.axis} fontSize={12} />
            <YAxis yAxisId="amount" stroke={chartTheme.axis} fontSize={12} tickFormatter={(v) => money.format(v)} width={90} />
            <YAxis
              yAxisId="ratio"
              orientation="right"
              stroke={chartTheme.axis}
              fontSize={12}
              tickFormatter={(v) => `${Number(v).toFixed(1)}x`}
            />
            <Tooltip
              contentStyle={{ background: chartTheme.tooltipBg, border: `1px solid ${chartTheme.tooltipBorder}`, borderRadius: 8 }}
              labelStyle={{ color: chartTheme.tooltipText }}
              formatter={(value, name) => {
                if (name === RATIO_NAME) {
                  return typeof value === 'number' ? `${value.toFixed(2)}x` : 'Sin datos';
                }
                return money.format(typeof value === 'number' ? value : 0);
              }}
            />
            <Legend />
            <Bar yAxisId="amount" dataKey="banco" fill={chartTheme.primary} radius={[4, 4, 0, 0]} name="Facturación 1 (Banco)" />
            <Bar yAxisId="amount" dataKey="efectivo" fill={chartTheme.secondary} radius={[4, 4, 0, 0]} name="Facturación 2 (Efectivo)" />
            <Line
              yAxisId="ratio"
              type="monotone"
              dataKey="ratio"
              stroke={chartTheme.warn}
              strokeWidth={2}
              dot={{ r: 3 }}
              connectNulls={false}
              name={RATIO_NAME}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
