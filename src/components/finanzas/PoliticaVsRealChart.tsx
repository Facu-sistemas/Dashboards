import { Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useChartTheme } from '../shared/useChartTheme';
import { getSemaforo, type PoliticaSemaforoStatus } from './politica-vs-real-utils';
import type { PoliticaVsRealGroupRow } from './types';

interface Props {
  rows: PoliticaVsRealGroupRow[];
  umbralPct: number;
}

const money = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });

export default function PoliticaVsRealChart({ rows, umbralPct }: Props) {
  const chartTheme = useChartTheme();
  if (rows.length === 0) return null;

  const colorByStatus: Record<PoliticaSemaforoStatus, string> = {
    verde: chartTheme.secondary,
    amarillo: chartTheme.warn,
    rojo: chartTheme.danger,
    'sin-datos': chartTheme.mutedBar,
  };

  // Recharts' vertical layout draws array order top-to-bottom — reverse so
  // the group with the highest capital real lands at the top.
  const data = [...rows].reverse().map((r) => ({
    name: r.groupName,
    objetivo: r.capitalObjetivo,
    real: r.capitalReal,
    status: getSemaforo(r.desviacionPct, umbralPct),
  }));

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-slate-800 bg-slate-900 p-4">
      <h3 className="text-sm font-medium text-slate-300">Capital Objetivo vs Real por grupo</h3>
      <ResponsiveContainer width="100%" height={Math.max(240, data.length * 48)}>
        <BarChart data={data} layout="vertical" margin={{ top: 8, right: 24, left: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} horizontal={false} />
          {/*
            Escala logarítmica: el Mínimo mock (30 días fijos de cobertura
            para todos los SKU, ver politica-vs-real.ts) puede disparar el
            Capital Objetivo de un grupo muy por encima del resto (ej.
            insumos de alto consumo diario) — en escala lineal ese outlier
            aplasta a cero visual el resto de las barras. Log deja los
            grupos comparables mientras no se reemplace el mock por la
            fórmula real.
          */}
          <XAxis
            type="number"
            scale="log"
            domain={[1, 'auto']}
            allowDataOverflow
            stroke={chartTheme.axis}
            fontSize={12}
            tickFormatter={(v) => money.format(Number(v))}
          />
          <YAxis type="category" dataKey="name" stroke={chartTheme.axis} fontSize={11} width={180} tick={{ fill: chartTheme.axisSecondary }} />
          <Tooltip
            contentStyle={{ background: chartTheme.tooltipBg, border: `1px solid ${chartTheme.tooltipBorder}`, borderRadius: 8 }}
            labelStyle={{ color: chartTheme.tooltipText }}
            itemStyle={{ color: chartTheme.tooltipText }}
            formatter={(value: number) => money.format(value)}
          />
          <Legend />
          <Bar dataKey="objetivo" fill={chartTheme.mutedBar} radius={[0, 4, 4, 0]} name="Capital Objetivo" isAnimationActive={false} />
          <Bar dataKey="real" radius={[0, 4, 4, 0]} name="Capital Real" isAnimationActive={false}>
            {data.map((d, i) => (
              <Cell key={i} fill={colorByStatus[d.status]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
