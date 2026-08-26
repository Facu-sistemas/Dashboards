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
import type { MonthlyCompliancePoint, PurchaseCurrency } from './types';

interface Props {
  currency: PurchaseCurrency;
  points: MonthlyCompliancePoint[];
}

const monthLabelFormatter = new Intl.DateTimeFormat('es-AR', { month: 'short', year: '2-digit' });

function monthLabel(monthKey: string): string {
  const [year, month] = monthKey.split('-').map(Number);
  return monthLabelFormatter.format(new Date(Date.UTC(year ?? 2026, (month ?? 1) - 1, 1)));
}

export default function ComplianceTrendChart({ currency, points }: Props) {
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
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis dataKey="month" stroke="#64748b" fontSize={12} />
          <YAxis
            yAxisId="amount"
            stroke="#64748b"
            fontSize={12}
            tickFormatter={(v) => money.format(v)}
            width={90}
          />
          <YAxis
            yAxisId="pct"
            orientation="right"
            stroke="#64748b"
            fontSize={12}
            tickFormatter={(v) => `${v}%`}
          />
          <Tooltip
            contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8 }}
            labelStyle={{ color: '#e2e8f0' }}
            formatter={(value: number, name: string) => (name === '% Cumplimiento' ? `${value.toFixed(0)}%` : money.format(value))}
          />
          <Legend />
          <Bar yAxisId="amount" dataKey="real" fill="#334155" radius={[4, 4, 0, 0]} name="Gasto real" />
          <Line
            yAxisId="pct"
            type="monotone"
            dataKey="compliancePct"
            stroke="#2f6fed"
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
