import { Bar, BarChart, CartesianGrid, Cell, Legend, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useChartTheme } from '@/components/shared/useChartTheme';
import type { ReparacionesFlujoPoint } from './types';

interface Props {
  points: ReparacionesFlujoPoint[];
  granularidad: 'dia' | 'mes';
  /** Rango elegido; las barras fuera de él se atenúan (útil cuando se muestra el mes entero para un solo día). */
  desde: string;
  hasta: string;
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function etiqueta(clave: string, granularidad: 'dia' | 'mes', largo: boolean): string {
  const [y, m, d] = clave.split('-');
  const mes = MESES[Number(m) - 1] ?? m;
  if (granularidad === 'mes') return `${mes} ${y}`;
  return largo ? `${Number(d)} ${mes} ${y}` : String(Number(d));
}

export default function ReparacionesFlujoChart({ points, granularidad, desde, hasta }: Props) {
  const chartTheme = useChartTheme();

  if (points.every((p) => p.creadas === 0 && p.cerradas === 0)) {
    return <p className="py-16 text-center text-sm text-slate-500">Sin reparaciones creadas ni cerradas en este período.</p>;
  }

  const dentro = (clave: string) => {
    const ini = granularidad === 'dia' ? clave : `${clave}-01`;
    const fin = granularidad === 'dia' ? clave : `${clave}-31`;
    return fin >= desde && ini <= hasta;
  };
  const data = points.map((p) => ({ ...p, cerradasNeg: -p.cerradas, name: etiqueta(p.clave, granularidad, false), dentro: dentro(p.clave) }));

  return (
    <ResponsiveContainer width="100%" height={320}>
      <BarChart data={data} stackOffset="sign" margin={{ top: 8, right: 16, left: 0, bottom: 0 }} barCategoryGap="12%">
        <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} vertical={false} />
        <XAxis dataKey="name" stroke={chartTheme.axis} fontSize={12} interval="preserveStartEnd" />
        <YAxis stroke={chartTheme.axis} fontSize={12} allowDecimals={false} tickFormatter={(v) => String(Math.abs(Number(v)))} />
        <Tooltip
          cursor={{ fill: chartTheme.grid, opacity: 0.4 }}
          contentStyle={{ background: chartTheme.tooltipBg, border: `1px solid ${chartTheme.tooltipBorder}`, borderRadius: 8 }}
          labelStyle={{ color: chartTheme.tooltipText }}
          itemStyle={{ color: chartTheme.tooltipText }}
          labelFormatter={(_l, payload) => {
            const clave = (payload?.[0]?.payload as { clave?: string } | undefined)?.clave;
            return clave ? etiqueta(clave, granularidad, true) : '';
          }}
          formatter={(value, name) => [`${Math.abs(Number(value))} reparaciones`, name === 'creadas' ? 'Creadas' : 'Cerradas']}
        />
        <Legend
          wrapperStyle={{ fontSize: 12, color: chartTheme.axisSecondary }}
          formatter={(v) => <span style={{ color: chartTheme.axisSecondary }}>{v === 'creadas' ? 'Creadas (arriba)' : 'Cerradas (abajo)'}</span>}
        />
        <ReferenceLine y={0} stroke={chartTheme.axis} />
        <Bar dataKey="creadas" stackId="f" fill={chartTheme.primary} isAnimationActive={false}>
          {data.map((d) => (
            <Cell key={d.clave} fill={chartTheme.primary} fillOpacity={d.dentro ? 1 : 0.3} />
          ))}
        </Bar>
        <Bar dataKey="cerradasNeg" stackId="f" fill={chartTheme.secondary} isAnimationActive={false}>
          {data.map((d) => (
            <Cell key={d.clave} fill={chartTheme.secondary} fillOpacity={d.dentro ? 1 : 0.3} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
