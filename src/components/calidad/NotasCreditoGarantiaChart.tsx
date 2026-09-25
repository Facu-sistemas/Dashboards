import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useChartTheme } from '../shared/useChartTheme';
import type { NotasCreditoGarantiaPoint } from './types';

interface Props {
  points: NotasCreditoGarantiaPoint[];
}

const money = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
// timeZone: 'UTC' is load-bearing — see monthOptions.ts for why.
const monthLabelFmt = new Intl.DateTimeFormat('es-AR', { month: 'short', year: '2-digit', timeZone: 'UTC' });

function monthLabel(monthKey: string): string {
  const [y, m] = monthKey.split('-').map(Number);
  const label = monthLabelFmt.format(new Date(Date.UTC(y!, m! - 1, 1)));
  return label.charAt(0).toUpperCase() + label.slice(1);
}

// Same fixed-width-per-month pattern as FacturacionTrendChart — this grows
// one month at a time from Sept 2026 on, so it'll outgrow its container
// eventually and needs the same horizontal-scroll treatment.
const MONTH_WIDTH_PX = 90;
const MIN_CHART_WIDTH_PX = 480;

const PCT_NAME = '% del total de notas de crédito';

export default function NotasCreditoGarantiaChart({ points }: Props) {
  const chartTheme = useChartTheme();
  if (points.length === 0) return null;

  const hasSinSector = points.some((p) => p.sinSector > 0);
  const data = points.map((p) => ({
    month: monthLabel(p.month),
    living: p.living,
    colchon: p.colchon,
    sinSector: p.sinSector,
    pct: p.pctDelTotal,
  }));
  const chartWidth = Math.max(data.length * MONTH_WIDTH_PX, MIN_CHART_WIDTH_PX);

  return (
    <div className="overflow-x-auto">
      <div style={{ width: chartWidth, height: 280 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
            <XAxis dataKey="month" stroke={chartTheme.axis} fontSize={12} />
            <YAxis yAxisId="amount" stroke={chartTheme.axis} fontSize={12} tickFormatter={(v) => money.format(v)} width={90} />
            <YAxis
              yAxisId="pct"
              orientation="right"
              stroke={chartTheme.axis}
              fontSize={12}
              tickFormatter={(v) => `${Number(v).toFixed(0)}%`}
            />
            <Tooltip
              contentStyle={{ background: chartTheme.tooltipBg, border: `1px solid ${chartTheme.tooltipBorder}`, borderRadius: 8 }}
              labelStyle={{ color: chartTheme.tooltipText }}
              formatter={(value, name) => {
                if (name === PCT_NAME) {
                  return typeof value === 'number' ? `${value.toFixed(1)}%` : 'Sin notas de crédito ese mes';
                }
                return money.format(typeof value === 'number' ? value : 0);
              }}
            />
            <Legend />
            <Bar yAxisId="amount" dataKey="living" stackId="sector" fill={chartTheme.primary} name="Living" isAnimationActive={false} />
            <Bar yAxisId="amount" dataKey="colchon" stackId="sector" fill={chartTheme.secondary} name="Colchón" isAnimationActive={false} />
            {hasSinSector && (
              <Bar yAxisId="amount" dataKey="sinSector" stackId="sector" fill={chartTheme.mutedBar} name="Sin sector" isAnimationActive={false} />
            )}
            <Line
              yAxisId="pct"
              type="monotone"
              dataKey="pct"
              stroke={chartTheme.warn}
              strokeWidth={2}
              dot={{ r: 3 }}
              connectNulls={false}
              name={PCT_NAME}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
