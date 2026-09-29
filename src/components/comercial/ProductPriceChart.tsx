import { Area, Bar, CartesianGrid, Cell, ComposedChart, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useChartTheme, type ChartTheme } from '../shared/useChartTheme';
import type { PriceSource, ProductPricePoint } from './types';

interface Props {
  points: ProductPricePoint[];
  onSelectMonth?: (monthKey: string) => void;
}

const money = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
// timeZone: 'UTC' is load-bearing — see monthOptions.ts for why.
const monthLabelFormatter = new Intl.DateTimeFormat('es-AR', { month: 'short', year: '2-digit', timeZone: 'UTC' });

export function monthLabel(monthKey: string): string {
  const [year, month] = monthKey.split('-').map(Number);
  const label = monthLabelFormatter.format(new Date(Date.UTC(year ?? 2026, (month ?? 1) - 1, 1)));
  return label.charAt(0).toUpperCase() + label.slice(1);
}

const SOURCE_LABELS: Record<PriceSource, string> = {
  lista: 'Precio de lista',
  venta: 'Cotizaciones (promedio)',
  arrastrado: 'Arrastrado (sin novedad ese mes)',
};

function sourceColors(theme: ChartTheme): Record<PriceSource, string> {
  return {
    lista: theme.primary,
    venta: theme.secondary,
    arrastrado: theme.axis,
  };
}

interface ChartRow {
  monthKey: string;
  month: string;
  price: number;
  source: PriceSource;
  range?: [number, number];
  count?: number;
}

export default function ProductPriceChart({ points, onSelectMonth }: Props) {
  const chartTheme = useChartTheme();
  const SOURCE_COLORS = sourceColors(chartTheme);
  const data: ChartRow[] = points.map((p) => ({
    monthKey: p.month,
    month: monthLabel(p.month),
    price: p.price,
    source: p.source,
    range: p.min != null && p.max != null ? [p.min, p.max] : undefined,
    count: p.count,
  }));

  const clickableRow = (row: ChartRow) => Boolean(onSelectMonth) && row.source === 'venta' && Boolean(row.count);

  return (
    <ResponsiveContainer width="100%" height={340}>
      <ComposedChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
        <XAxis dataKey="month" stroke={chartTheme.axis} fontSize={12} />
        <YAxis stroke={chartTheme.axis} fontSize={12} tickFormatter={(v) => money.format(v)} width={90} domain={['auto', 'auto']} />
        <Tooltip
          content={({ active, payload, label }) => {
            if (!active || !payload?.length) return null;
            const row = payload[0]?.payload as ChartRow | undefined;
            if (!row) return null;
            return (
              <div
                style={{
                  background: chartTheme.tooltipBg,
                  border: `1px solid ${chartTheme.tooltipBorder}`,
                  borderRadius: 8,
                  padding: '8px 12px',
                  color: chartTheme.tooltipText,
                  fontSize: 12,
                  lineHeight: 1.5,
                }}
              >
                <p style={{ fontWeight: 600 }}>{label}</p>
                <p>{SOURCE_LABELS[row.source]}</p>
                <p style={{ fontWeight: 600, marginTop: 2 }}>{money.format(row.price)}</p>
                {row.range && (
                  <p style={{ color: chartTheme.axisSecondary }}>
                    Rango: {money.format(row.range[0])} – {money.format(row.range[1])}
                  </p>
                )}
                {row.count ? (
                  <p style={{ color: chartTheme.axisSecondary }}>
                    {row.count} cotización{row.count === 1 ? '' : 'es'} ese mes
                  </p>
                ) : null}
                {clickableRow(row) && (
                  <p style={{ color: chartTheme.axisSecondary, marginTop: 2 }}>Click para ver el detalle</p>
                )}
              </div>
            );
          }}
        />
        <Legend
          payload={(Object.keys(SOURCE_LABELS) as PriceSource[]).map((s) => ({
            value: SOURCE_LABELS[s],
            type: 'square',
            color: SOURCE_COLORS[s],
          }))}
        />
        <Area dataKey="range" stroke="none" fill={chartTheme.secondary} fillOpacity={0.15} isAnimationActive={false} legendType="none" />
        <Bar
          dataKey="price"
          radius={[4, 4, 0, 0]}
          name="Precio"
          isAnimationActive={false}
          onClick={(_, index) => {
            const row = data[index];
            if (row && clickableRow(row)) onSelectMonth?.(row.monthKey);
          }}
        >
          {data.map((d, i) => (
            <Cell key={i} fill={SOURCE_COLORS[d.source]} cursor={clickableRow(d) ? 'pointer' : 'default'} />
          ))}
        </Bar>
      </ComposedChart>
    </ResponsiveContainer>
  );
}
