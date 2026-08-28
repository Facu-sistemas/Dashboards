import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useChartTheme } from '../shared/useChartTheme';
import type { CategoryBudgetStatus, PurchaseCurrency } from './types';

interface Props {
  currency: PurchaseCurrency;
  rows: CategoryBudgetStatus[];
  topN?: number;
}

interface ChartRow {
  categoryName: string;
  presupuestado: number;
  real: number;
}

/** Top N categories by real spend, the rest folded into "Otras" — keeps the chart readable. */
function bucketTopN(rows: CategoryBudgetStatus[], topN: number): ChartRow[] {
  const sorted = [...rows].sort((a, b) => b.realAmount - a.realAmount);
  const top = sorted.slice(0, topN);
  const rest = sorted.slice(topN);

  const chartRows: ChartRow[] = top.map((r) => ({
    categoryName: r.categoryName,
    presupuestado: r.budgetAmount ?? 0,
    real: r.realAmount,
  }));

  if (rest.length > 0) {
    chartRows.push({
      categoryName: `Otras (${rest.length})`,
      presupuestado: rest.reduce((sum, r) => sum + (r.budgetAmount ?? 0), 0),
      real: rest.reduce((sum, r) => sum + r.realAmount, 0),
    });
  }

  return chartRows;
}

export default function ComplianceBarChart({ currency, rows, topN = 8 }: Props) {
  const chartTheme = useChartTheme();
  if (rows.length === 0) return null;

  const data = bucketTopN(rows, topN);
  const money = new Intl.NumberFormat('es-AR', { style: 'currency', currency, maximumFractionDigits: 0 });

  return (
    <ResponsiveContainer width="100%" height={320}>
      <BarChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 48 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
        <XAxis
          dataKey="categoryName"
          stroke={chartTheme.axis}
          fontSize={12}
          angle={-35}
          textAnchor="end"
          interval={0}
          height={70}
        />
        <YAxis stroke={chartTheme.axis} fontSize={12} tickFormatter={(v) => money.format(v)} width={90} />
        <Tooltip
          contentStyle={{ background: chartTheme.tooltipBg, border: `1px solid ${chartTheme.tooltipBorder}`, borderRadius: 8 }}
          labelStyle={{ color: chartTheme.tooltipText }}
          formatter={(value: number) => money.format(value)}
        />
        <Legend />
        <Bar dataKey="presupuestado" fill={chartTheme.axis} radius={[4, 4, 0, 0]} name="Presupuestado" />
        <Bar dataKey="real" fill={chartTheme.primary} radius={[4, 4, 0, 0]} name="Real" />
      </BarChart>
    </ResponsiveContainer>
  );
}
