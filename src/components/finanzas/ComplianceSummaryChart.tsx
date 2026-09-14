import { CartesianGrid, Line, LineChart, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useChartTheme } from '../shared/useChartTheme';
import { monthLabel } from './presupuesto-dinamico-utils';

interface Props {
  points: { month: string; compliancePct: number | null }[];
}

/** Resumen ejecutivo — % de Cumplimiento total por mes, con la banda 85%-110% resaltada (sección 5 del doc). */
export default function ComplianceSummaryChart({ points }: Props) {
  const chartTheme = useChartTheme();
  const data = points.map((p) => ({ month: monthLabel(p.month), compliancePct: p.compliancePct }));
  const hasAnyData = points.some((p) => p.compliancePct !== null);

  if (!hasAnyData) {
    return (
      <p className="py-8 text-center text-sm text-slate-500">
        Sin datos suficientes todavía (falta consenso de unidades o presupuesto calculable en estos meses).
      </p>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
        <ReferenceArea y1={85} y2={110} fill={chartTheme.secondary} fillOpacity={0.08} />
        <XAxis dataKey="month" stroke={chartTheme.axis} fontSize={12} />
        <YAxis stroke={chartTheme.axis} fontSize={12} tickFormatter={(v) => `${v}%`} width={50} />
        <Tooltip
          contentStyle={{ background: chartTheme.tooltipBg, border: `1px solid ${chartTheme.tooltipBorder}`, borderRadius: 8 }}
          labelStyle={{ color: chartTheme.tooltipText }}
          formatter={(value) => (typeof value === 'number' ? [`${value.toFixed(0)}%`, '% Cumplimiento'] : ['Sin datos', '% Cumplimiento'])}
        />
        <Line type="monotone" dataKey="compliancePct" stroke={chartTheme.primary} strokeWidth={2} dot={{ r: 3 }} connectNulls={false} name="% Cumplimiento" />
      </LineChart>
    </ResponsiveContainer>
  );
}
