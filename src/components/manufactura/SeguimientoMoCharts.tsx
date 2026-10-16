import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useChartTheme, type ChartTheme } from '@/components/shared/useChartTheme';
import type { SeguimientoGrupo, SeguimientoSemaforo } from '@/lib/odoo/seguimiento-mo';

const LABELS: Record<SeguimientoSemaforo, string> = { verde: 'En tiempo', amarillo: 'Atención', rojo: 'Demorada' };
const SEMAFOROS: SeguimientoSemaforo[] = ['verde', 'amarillo', 'rojo'];
const numberFmt = new Intl.NumberFormat('es-AR');

function colorOf(c: SeguimientoSemaforo, theme: ChartTheme): string {
  return c === 'verde' ? theme.secondary : c === 'amarillo' ? theme.warn : theme.danger;
}

function tooltipProps(theme: ChartTheme) {
  return {
    contentStyle: { background: theme.tooltipBg, border: `1px solid ${theme.tooltipBorder}`, borderRadius: 8 },
    labelStyle: { color: theme.tooltipText },
    itemStyle: { color: theme.tooltipText },
  };
}

interface Props {
  grupo: SeguimientoGrupo;
  semaforo: SeguimientoSemaforo | null;
  sector: string | null;
  onSemaforo: (c: SeguimientoSemaforo | null) => void;
  onSector: (s: string | null) => void;
}

/** Anillo con el % por semáforo (clic = filtra) */
export function SemaforoDonut({ grupo, semaforo, onSemaforo }: Pick<Props, 'grupo' | 'semaforo' | 'onSemaforo'>) {
  const theme = useChartTheme();
  if (grupo.total === 0) return <p className="py-16 text-center text-sm text-slate-500">No hay MO abiertas.</p>;

  const slices = SEMAFOROS.filter((c) => grupo[c] > 0).map((c) => ({ key: c, name: LABELS[c], value: grupo[c], color: colorOf(c, theme) }));

  return (
    <ResponsiveContainer width="100%" height={260}>
      <PieChart>
        <Pie
          data={slices}
          dataKey="value"
          nameKey="name"
          cx="50%"
          cy="50%"
          innerRadius={60}
          outerRadius={95}
          paddingAngle={2}
          isAnimationActive={false}
          label={({ value }) => `${((Number(value) / grupo.total) * 100).toFixed(0)}%`}
          onClick={(d) => onSemaforo(semaforo === d.key ? null : (d.key as SeguimientoSemaforo))}
          style={{ cursor: 'pointer' }}
        >
          {slices.map((s) => (
            <Cell key={s.key} fill={s.color} stroke="none" opacity={semaforo && semaforo !== s.key ? 0.35 : 1} />
          ))}
        </Pie>
        <Tooltip
          {...tooltipProps(theme)}
          formatter={(value, name) => [`${numberFmt.format(Number(value))} (${((Number(value) / grupo.total) * 100).toFixed(1)}%)`, name]}
        />
        <Legend />
      </PieChart>
    </ResponsiveContainer>
  );
}

/** Barras apiladas por sector: verde / amarillo / rojo (clic en una barra = filtra por sector) */
export function SectoresBars({ grupo, sector, onSector }: Pick<Props, 'grupo' | 'sector' | 'onSector'>) {
  const theme = useChartTheme();
  if (grupo.sectores.length === 0) return null;

  const data = grupo.sectores.map((s) => ({ sector: s.sector, verde: s.verde, amarillo: s.amarillo, rojo: s.rojo }));

  return (
    <ResponsiveContainer width="100%" height={Math.max(180, data.length * 48 + 50)}>
      <BarChart data={data} layout="vertical" margin={{ top: 8, right: 24, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={theme.grid} horizontal={false} />
        <XAxis type="number" stroke={theme.axis} fontSize={12} allowDecimals={false} />
        <YAxis type="category" dataKey="sector" stroke={theme.axis} fontSize={12} width={90} />
        <Tooltip {...tooltipProps(theme)} cursor={{ fill: theme.grid, opacity: 0.4 }} formatter={(value, name) => [numberFmt.format(Number(value)), name]} />
        <Legend />
        {SEMAFOROS.map((c, i) => (
          <Bar
            key={c}
            dataKey={c}
            name={LABELS[c]}
            stackId="sector"
            fill={colorOf(c, theme)}
            radius={i === SEMAFOROS.length - 1 ? [0, 4, 4, 0] : 0}
            isAnimationActive={false}
            style={{ cursor: 'pointer' }}
            onClick={(d: { sector?: string }) => d.sector && onSector(sector === d.sector ? null : d.sector)}
          >
            {data.map((row) => (
              <Cell key={row.sector} opacity={sector && sector !== row.sector ? 0.35 : 1} />
            ))}
          </Bar>
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
