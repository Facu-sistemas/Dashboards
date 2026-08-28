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
import type { MonthlyCompliancePoint, PurchaseCurrency } from './types';

interface Props {
  currency: PurchaseCurrency;
  points: MonthlyCompliancePoint[];
}

// timeZone: 'UTC' is load-bearing — see monthOptions.ts for why.
const monthLabelFormatter = new Intl.DateTimeFormat('es-AR', { month: 'short', year: '2-digit', timeZone: 'UTC' });

function monthLabel(monthKey: string): string {
  const [year, month] = monthKey.split('-').map(Number);
  return monthLabelFormatter.format(new Date(Date.UTC(year ?? 2026, (month ?? 1) - 1, 1)));
}

export default function ComplianceTrendChart({ currency, points }: Props) {
  const chartTheme = useChartTheme();
  const money = new Intl.NumberFormat('es-AR', { style: 'currency', currency, maximumFractionDigits: 0 });
  const filtered = points.filter((p) => p.currency === currency);
  const hasAnyBudget = filtered.some((p) => p.compliancePct !== null);

  const data = filtered.map((p) => ({
    month: monthLabel(p.month),
    real: p.totalReal,
    compliancePct: p.compliancePct,
  }));

  return (
    <div>
      {!hasAnyBudget && (
        <p className="mb-2 text-xs text-slate-500">
          Todavía no hay presupuesto cargado en {currency} — se muestra solo el gasto real por mes.
        </p>
      )}
      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
          <XAxis dataKey="month" stroke={chartTheme.axis} fontSize={12} />
          <YAxis
            yAxisId="amount"
            stroke={chartTheme.axis}
            fontSize={12}
            tickFormatter={(v) => money.format(v)}
            width={90}
          />
          <YAxis
            yAxisId="pct"
            orientation="right"
            stroke={chartTheme.axis}
            fontSize={12}
            tickFormatter={(v) => `${v}%`}
          />
          <Tooltip
            contentStyle={{ background: chartTheme.tooltipBg, border: `1px solid ${chartTheme.tooltipBorder}`, borderRadius: 8 }}
            labelStyle={{ color: chartTheme.tooltipText }}
            formatter={(value: number, name: string) => (name === '% Cumplimiento' ? `${value.toFixed(0)}%` : money.format(value))}
          />
          <Legend />
          <Bar yAxisId="amount" dataKey="real" fill={chartTheme.mutedBar} radius={[4, 4, 0, 0]} name="Gasto real" />
          <Line
            yAxisId="pct"
            type="monotone"
            dataKey="compliancePct"
            stroke={chartTheme.primary}
            strokeWidth={2}
            dot={{ r: 3 }}
            connectNulls={false}
            name="% Cumplimiento"
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
