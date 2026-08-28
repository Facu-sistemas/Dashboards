import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { ClientMonthlySeries } from './types';

interface Props {
  series: ClientMonthlySeries[];
}

const money = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
// timeZone: 'UTC' is load-bearing — see monthOptions.ts for why.
const monthLabelFormatter = new Intl.DateTimeFormat('es-AR', { month: 'short', year: '2-digit', timeZone: 'UTC' });

function monthLabel(monthKey: string): string {
  const [year, month] = monthKey.split('-').map(Number);
  const label = monthLabelFormatter.format(new Date(Date.UTC(year ?? 2026, (month ?? 1) - 1, 1)));
  return label.charAt(0).toUpperCase() + label.slice(1);
}

const COLORS = ['#2f6fed', '#10b981'];

export default function ClientMonthlyChart({ series }: Props) {
  if (series.length === 0) return null;

  const months = series[0]!.points.map((p) => p.month);
  const data = months.map((month, i) => {
    const row: Record<string, string | number> = { month: monthLabel(month) };
    for (const s of series) {
      row[s.partnerName] = s.points[i]?.amount ?? 0;
    }
    return row;
  });

  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
        <XAxis dataKey="month" stroke="#64748b" fontSize={12} />
        <YAxis stroke="#64748b" fontSize={12} tickFormatter={(v) => money.format(Number(v))} width={90} />
        <Tooltip
          contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8 }}
          labelStyle={{ color: '#e2e8f0' }}
          itemStyle={{ color: '#e2e8f0' }}
          formatter={(value) => money.format(Number(value))}
        />
        <Legend />
        {series.map((s, i) => (
          <Bar key={s.partnerId} dataKey={s.partnerName} fill={COLORS[i % COLORS.length]} radius={[4, 4, 0, 0]} isAnimationActive={false} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
