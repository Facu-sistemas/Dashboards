import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
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
  if (rows.length === 0) return null;

  const data = bucketTopN(rows, topN);
  const money = new Intl.NumberFormat('es-AR', { style: 'currency', currency, maximumFractionDigits: 0 });

  return (
    <ResponsiveContainer width="100%" height={320}>
      <BarChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 48 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
        <XAxis
          dataKey="categoryName"
          stroke="#64748b"
          fontSize={12}
          angle={-35}
          textAnchor="end"
          interval={0}
          height={70}
        />
        <YAxis stroke="#64748b" fontSize={12} tickFormatter={(v) => money.format(v)} width={90} />
        <Tooltip
          contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8 }}
          labelStyle={{ color: '#e2e8f0' }}
          formatter={(value: number) => money.format(value)}
        />
        <Legend />
        <Bar dataKey="presupuestado" fill="#64748b" radius={[4, 4, 0, 0]} name="Presupuestado" />
        <Bar dataKey="real" fill="#2f6fed" radius={[4, 4, 0, 0]} name="Real" />
      </BarChart>
    </ResponsiveContainer>
  );
}
