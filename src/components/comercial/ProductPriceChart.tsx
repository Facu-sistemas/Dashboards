import { Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useChartTheme, type ChartTheme } from '../shared/useChartTheme';
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

const SOURCE_LABELS: Record<PriceSource, string> = {
  lista: 'Precio de lista',
  venta: 'Venta confirmada',
  arrastrado: 'Arrastrado (sin novedad ese mes)',
};

function sourceColors(theme: ChartTheme): Record<PriceSource, string> {
  return {
    lista: theme.primary,
    venta: theme.secondary,
    arrastrado: theme.axis,
  };
}

export default function ProductPriceChart({ points }: Props) {
  const chartTheme = useChartTheme();
  const SOURCE_COLORS = sourceColors(chartTheme);
  const data = points.map((p) => ({ month: monthLabel(p.month), price: p.price, source: p.source }));

  return (
    <ResponsiveContainer width="100%" height={320}>
      <BarChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
        <XAxis dataKey="month" stroke={chartTheme.axis} fontSize={12} />
        <YAxis stroke={chartTheme.axis} fontSize={12} tickFormatter={(v) => money.format(v)} width={90} />
        <Tooltip
          contentStyle={{ background: chartTheme.tooltipBg, border: `1px solid ${chartTheme.tooltipBorder}`, borderRadius: 8 }}
          labelStyle={{ color: chartTheme.tooltipText }}
          itemStyle={{ color: chartTheme.tooltipText }}
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
