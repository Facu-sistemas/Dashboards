import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useChartTheme } from '../shared/useChartTheme';
import { formatCompactCurrency } from '../gerencia/format';
import { monthLabel } from './month-label';
import type { ChequeMesPoint } from '../../lib/odoo/credito-clientes';

interface Props {
  data: ChequeMesPoint[];
}

export default function CreditoChequesChart({ data }: Props) {
  const theme = useChartTheme();

  if (data.length === 0) {
    return <p className="py-8 text-center text-sm text-slate-500">Sin cheques en cartera con fecha de pago futura.</p>;
  }

  const chartData = data.map((d) => ({ label: monthLabel(d.month), monto: d.monto }));

  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={theme.grid} vertical={false} />
        <XAxis dataKey="label" stroke={theme.axis} fontSize={12} />
        <YAxis stroke={theme.axis} fontSize={12} tickFormatter={(v) => formatCompactCurrency(Number(v))} width={70} />
        <Tooltip
          contentStyle={{ background: theme.tooltipBg, border: `1px solid ${theme.tooltipBorder}`, borderRadius: 8 }}
          labelStyle={{ color: theme.tooltipText }}
          itemStyle={{ color: theme.tooltipText }}
          formatter={(v) => [formatCompactCurrency(Number(v)), 'Monto']}
        />
        <Bar dataKey="monto" name="Monto" fill={theme.secondary} radius={[4, 4, 0, 0]} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}
