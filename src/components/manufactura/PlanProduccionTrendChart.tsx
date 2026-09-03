import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useChartTheme } from '../shared/useChartTheme';
import type { PlanProduccionDailyRow, PlanProduccionGauge } from './types';

interface Props {
  title: string;
  rows: PlanProduccionDailyRow[];
  pick: (row: PlanProduccionDailyRow) => PlanProduccionGauge;
  unit: string;
}

const units = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });
// timeZone: 'UTC' is load-bearing — see monthOptions.ts for why.
const dayLabelFmt = new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' });

function dayLabel(dateIso: string): string {
  const [y, m, d] = dateIso.split('-').map(Number);
  return dayLabelFmt.format(new Date(Date.UTC(y!, m! - 1, d!)));
}

// Always show at least up to 150% so lines that spike above 100% (common
// day-to-day — a single order can blow past a small daily plan) still draw
// inside the chart instead of clipping at whatever the data max happens to be.
function pctDomainMax(dataMax: number): number {
  return Math.max(150, dataMax);
}

export default function PlanProduccionTrendChart({ title, rows, pick, unit }: Props) {
  const chartTheme = useChartTheme();

  const data = rows.map((r) => {
    const g = pick(r);
    return {
      day: dayLabel(r.date),
      planificado: g.planificado,
      cumplimientoPct: g.cumplimientoPct,
      cerradoPct: g.cerradoPct,
    };
  });

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      <h3 className="mb-3 text-sm font-medium text-slate-300">{title}</h3>
      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
          <XAxis dataKey="day" stroke={chartTheme.axis} fontSize={11} interval="preserveStartEnd" />
          <YAxis yAxisId="valor" stroke={chartTheme.axis} fontSize={12} tickFormatter={(v) => units.format(v)} width={50} />
          <YAxis yAxisId="pct" orientation="right" domain={[0, pctDomainMax]} stroke={chartTheme.axis} fontSize={12} tickFormatter={(v) => `${v}%`} />
          <Tooltip
            contentStyle={{ background: chartTheme.tooltipBg, border: `1px solid ${chartTheme.tooltipBorder}`, borderRadius: 8 }}
            labelStyle={{ color: chartTheme.tooltipText }}
            formatter={(value: number, name: string) => (name === 'Planificado' ? `${units.format(value)} ${unit}` : `${value.toFixed(0)}%`)}
          />
          <Legend />
          <Bar yAxisId="valor" dataKey="planificado" fill={chartTheme.mutedBar} radius={[4, 4, 0, 0]} name="Planificado" isAnimationActive={false} />
          <Line yAxisId="pct" type="monotone" dataKey="cumplimientoPct" stroke={chartTheme.primary} strokeWidth={2} dot={false} name="Cumplimiento %" isAnimationActive={false} />
          <Line yAxisId="pct" type="monotone" dataKey="cerradoPct" stroke={chartTheme.warn} strokeWidth={2} dot={false} name="Cerrado %" isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
