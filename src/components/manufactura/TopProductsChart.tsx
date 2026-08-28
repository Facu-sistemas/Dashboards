import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useChartTheme } from '../shared/useChartTheme';
import type { TopProductRow } from './types';

interface Props {
  title: string;
  rows: TopProductRow[];
  color: string;
}

const numberFmt = new Intl.NumberFormat('es-AR');

export default function TopProductsChart({ title, rows, color }: Props) {
  const chartTheme = useChartTheme();
  if (rows.length === 0) {
    return (
      <div className="flex flex-col gap-3 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <h3 className="text-sm font-medium text-slate-300">{title}</h3>
        <p className="py-8 text-center text-sm text-slate-500">Sin ventas confirmadas registradas.</p>
      </div>
    );
  }

  // Recharts' vertical layout draws array order top-to-bottom — reverse so
  // #1 (highest units) lands at the top, matching how a ranking reads.
  const data = [...rows].reverse().map((r) => ({
    name: r.productName,
    subcategory: r.subcategoryName,
    units: r.unitsSold,
  }));

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-slate-800 bg-slate-900 p-4">
      <h3 className="text-sm font-medium text-slate-300">{title}</h3>
      <ResponsiveContainer width="100%" height={380}>
        <BarChart data={data} layout="vertical" margin={{ top: 8, right: 24, left: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} horizontal={false} />
          <XAxis type="number" stroke={chartTheme.axis} fontSize={12} tickFormatter={(v) => numberFmt.format(Number(v))} />
          <YAxis type="category" dataKey="name" stroke={chartTheme.axis} fontSize={11} width={230} tick={{ fill: chartTheme.axisSecondary }} />
          <Tooltip
            contentStyle={{ background: chartTheme.tooltipBg, border: `1px solid ${chartTheme.tooltipBorder}`, borderRadius: 8 }}
            labelStyle={{ color: chartTheme.tooltipText }}
            itemStyle={{ color: chartTheme.tooltipText }}
            formatter={(value, _name, item) => {
              const subcategory = (item?.payload as { subcategory?: string } | undefined)?.subcategory;
              return [`${numberFmt.format(Number(value))} u.`, subcategory || 'Unidades vendidas'];
            }}
          />
          <Bar dataKey="units" fill={color} radius={[0, 4, 4, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
