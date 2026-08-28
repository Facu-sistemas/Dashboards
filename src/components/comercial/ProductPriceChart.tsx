import { Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { PriceSource, ProductPricePoint } from './types';

interface Props {
  points: ProductPricePoint[];
}

const money = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
// timeZone: 'UTC' is load-bearing — see monthOptions.ts for why.
const monthLabelFormatter = new Intl.DateTimeFormat('es-AR', { month: 'short', year: '2-digit', timeZone: 'UTC' });

function monthLabel(monthKey: string): string {
  const [year, month] = monthKey.split('-').map(Number);
  const label = monthLabelFormatter.format(new Date(Date.UTC(year ?? 2026, (month ?? 1) - 1, 1)));
  return label.charAt(0).toUpperCase() + label.slice(1);
}

const SOURCE_COLORS: Record<PriceSource, string> = {
  lista: '#2f6fed',
  venta: '#10b981',
  arrastrado: '#64748b',
};

const SOURCE_LABELS: Record<PriceSource, string> = {
  lista: 'Precio de lista',
  venta: 'Venta confirmada',
  arrastrado: 'Arrastrado (sin novedad ese mes)',
};

export default function ProductPriceChart({ points }: Props) {
  const data = points.map((p) => ({ month: monthLabel(p.month), price: p.price, source: p.source }));

  return (
    <ResponsiveContainer width="100%" height={320}>
      <BarChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
        <XAxis dataKey="month" stroke="#64748b" fontSize={12} />
        <YAxis stroke="#64748b" fontSize={12} tickFormatter={(v) => money.format(v)} width={90} />
        <Tooltip
          contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8 }}
          labelStyle={{ color: '#e2e8f0' }}
          itemStyle={{ color: '#e2e8f0' }}
          formatter={(value, _name, item) => {
            const source = (item?.payload as { source?: PriceSource } | undefined)?.source;
            const label = source ? SOURCE_LABELS[source] : 'Precio';
            return [money.format(Number(value)), label];
          }}
        />
        <Legend
          payload={(Object.keys(SOURCE_LABELS) as PriceSource[]).map((s) => ({
            value: SOURCE_LABELS[s],
            type: 'square',
            color: SOURCE_COLORS[s],
          }))}
        />
        <Bar dataKey="price" radius={[4, 4, 0, 0]} name="Precio" isAnimationActive={false}>
          {data.map((d, i) => (
            <Cell key={i} fill={SOURCE_COLORS[d.source]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
