import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useChartTheme } from '../shared/useChartTheme';
import { money, monthShort } from './format';

export interface ChartPoint {
  month: string;
  colchones: number;
  living: number;
  ambos: number;
}

interface Props {
  points: ChartPoint[];
  selectedMonth: number;
  onSelectMonth: (monthIndex: number) => void;
}

/** Presupuesto de compra por mes, apilado por línea. Click en un mes = ver el acumulado hasta ese mes en la tabla. */
export default function PresupuestoChart({ points, selectedMonth, onSelectMonth }: Props) {
  const theme = useChartTheme();
  const compact = new Intl.NumberFormat('es-AR', { notation: 'compact', maximumFractionDigits: 1 });
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer>
        <BarChart data={points.map((p, i) => ({ ...p, label: monthShort(p.month), i }))} onClick={(e) => e?.activeTooltipIndex != null && onSelectMonth(Number(e.activeTooltipIndex))}>
          <CartesianGrid stroke={theme.grid} vertical={false} />
          <XAxis dataKey="label" stroke={theme.axis} tick={{ fill: theme.axisSecondary, fontSize: 12 }} />
          <YAxis stroke={theme.axis} tick={{ fill: theme.axisSecondary, fontSize: 12 }} tickFormatter={(v: number) => `$${compact.format(v)}`} width={64} />
          <Tooltip
            formatter={(v) => money.format(Number(v))}
            contentStyle={{ background: theme.tooltipBg, border: `1px solid ${theme.tooltipBorder}`, color: theme.tooltipText }}
            cursor={{ fill: theme.grid, opacity: 0.4 }}
          />
          <Legend wrapperStyle={{ fontSize: 12, color: theme.axisSecondary }} />
          <Bar dataKey="colchones" name="Colchones" stackId="a" fill={theme.primary} cursor="pointer" opacity={0.95} />
          <Bar dataKey="living" name="Living" stackId="a" fill={theme.secondary} cursor="pointer" />
          <Bar dataKey="ambos" name="Ambos" stackId="a" fill={theme.warn} cursor="pointer" />
        </BarChart>
      </ResponsiveContainer>
      <p className="mt-1 text-center text-xs text-slate-500">
        Click en un mes para acumular hasta ahí en la tabla · mes elegido: {monthShort(points[selectedMonth]?.month ?? '2026-01')}
      </p>
    </div>
  );
}
