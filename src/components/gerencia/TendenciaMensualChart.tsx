import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useChartTheme } from '../shared/useChartTheme';
import { formatCompactCurrency, formatNumber } from './format';
import type { TendenciaMensualRow } from '../../lib/odoo/clientes-activos';

interface Props {
  rows: TendenciaMensualRow[];
}

// timeZone: 'UTC' — mismo motivo que en los demás gráficos mensuales del proyecto (monthOptions.ts).
const monthLabelFormatter = new Intl.DateTimeFormat('es-AR', { month: 'short', year: '2-digit', timeZone: 'UTC' });

function monthLabel(monthKey: string): string {
  const [year, month] = monthKey.split('-').map(Number);
  const label = monthLabelFormatter.format(new Date(Date.UTC(year ?? 2026, (month ?? 1) - 1, 1)));
  return label.charAt(0).toUpperCase() + label.slice(1);
}

const CLIENTES_NAME = 'Clientes activos';

/** Facturado (barras) + Clientes activos (línea, eje secundario) — la tabla de al lado sigue teniendo el detalle exacto, incluidas las notas de crédito. */
export default function TendenciaMensualChart({ rows }: Props) {
  const chartTheme = useChartTheme();
  if (rows.length === 0) return null;

  const data = rows.map((r) => ({
    month: monthLabel(r.month),
    facturado: r.facturado,
    clientesActivos: r.clientesActivos,
  }));

  return (
    <ResponsiveContainer width="100%" height={260}>
      <ComposedChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} vertical={false} />
        <XAxis dataKey="month" stroke={chartTheme.axis} fontSize={12} />
        <YAxis yAxisId="amount" stroke={chartTheme.axis} fontSize={11} tickFormatter={(v) => formatCompactCurrency(Number(v))} width={64} />
        <YAxis yAxisId="clientes" orientation="right" stroke={chartTheme.axis} fontSize={11} width={40} />
        <Tooltip
          contentStyle={{ background: chartTheme.tooltipBg, border: `1px solid ${chartTheme.tooltipBorder}`, borderRadius: 8 }}
          labelStyle={{ color: chartTheme.tooltipText }}
          itemStyle={{ color: chartTheme.tooltipText }}
          formatter={(value, name) => (name === CLIENTES_NAME ? formatNumber(Number(value)) : formatCompactCurrency(Number(value)))}
        />
        <Legend />
        <Bar yAxisId="amount" dataKey="facturado" name="Facturado" fill={chartTheme.primary} radius={[4, 4, 0, 0]} isAnimationActive={false} />
        <Line
          yAxisId="clientes"
          type="monotone"
          dataKey="clientesActivos"
          name={CLIENTES_NAME}
          stroke={chartTheme.secondary}
          strokeWidth={2}
          dot={{ r: 3 }}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
