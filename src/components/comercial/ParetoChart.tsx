import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { ParetoClientRow } from './types';

interface Props {
  rows: ParetoClientRow[];
}

const money = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });

function truncate(name: string, max = 16): string {
  return name.length > max ? `${name.slice(0, max - 1)}…` : name;
}

const CUMULATIVE_NAME = '% Acumulado';

export default function ParetoChart({ rows }: Props) {
  if (rows.length === 0) {
    return <p className="py-16 text-center text-sm text-slate-500">Sin facturación registrada para este período.</p>;
  }

  const data = rows.map((r) => ({
    name: truncate(r.partnerName),
    fullName: r.partnerName,
    amount: r.amount,
    cumulativePct: r.cumulativePct,
  }));

  return (
    <ResponsiveContainer width="100%" height={380}>
      <ComposedChart data={data} margin={{ top: 8, right: 24, left: 0, bottom: 56 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
        <XAxis dataKey="name" stroke="#64748b" fontSize={11} angle={-35} textAnchor="end" interval={0} height={90} />
        <YAxis yAxisId="amount" stroke="#64748b" fontSize={12} tickFormatter={(v) => money.format(Number(v))} width={90} />
        <YAxis yAxisId="pct" orientation="right" domain={[0, 100]} stroke="#64748b" fontSize={12} tickFormatter={(v) => `${v}%`} />
        <Tooltip
          contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8 }}
          labelStyle={{ color: '#e2e8f0' }}
          itemStyle={{ color: '#e2e8f0' }}
          labelFormatter={(label, payload) => (payload?.[0]?.payload as { fullName?: string } | undefined)?.fullName ?? label}
          formatter={(value, name) =>
            name === CUMULATIVE_NAME ? `${Number(value).toFixed(1)}%` : money.format(Number(value))
          }
        />
        <Legend />
        <ReferenceLine
          yAxisId="pct"
          y={80}
          stroke="#94a3b8"
          strokeDasharray="4 4"
          label={{ value: '80%', position: 'insideTopRight', fill: '#94a3b8', fontSize: 11 }}
        />
        <Bar yAxisId="amount" dataKey="amount" fill="#2f6fed" radius={[4, 4, 0, 0]} name="Facturación" isAnimationActive={false} />
        <Line
          yAxisId="pct"
          type="monotone"
          dataKey="cumulativePct"
          stroke="#f59e0b"
          strokeWidth={2}
          dot={{ r: 4 }}
          name={CUMULATIVE_NAME}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
