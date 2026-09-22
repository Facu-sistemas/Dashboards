import type { ReactNode } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useChartTheme } from '../shared/useChartTheme';
import { activosRentables, isc, type CarteraRecord, type Categoria, type Estado, type Snapshot, type TrailingPoint } from './cartera-clientes-calc';

interface Props {
  snap: Snapshot;
  trail: TrailingPoint[];
  records: CarteraRecord[];
}

const CATS: Categoria[] = ['A', 'B', 'C'];
const ESTADOS: Estado[] = ['Activo', 'Dormido', 'Perdido', 'Nuevo'];

function ChartBox({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      <p className="text-sm font-medium text-slate-200">{title}</p>
      {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
      <div className="mt-3">{children}</div>
    </div>
  );
}

function CompositionChart({ snap }: { snap: Snapshot }) {
  const theme = useChartTheme();
  const colors: Record<Estado, string> = { Activo: theme.secondary, Dormido: theme.warn, Perdido: theme.danger, Nuevo: theme.primary };

  const data = CATS.map((cat) => {
    const row: Record<string, number | string> = { cat: `Categoría ${cat}` };
    for (const estado of ESTADOS) row[estado] = snap.clientStats.filter((c) => c.cat === cat && c.estado === estado).length;
    return row;
  });

  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={theme.grid} />
        <XAxis dataKey="cat" stroke={theme.axis} fontSize={12} />
        <YAxis stroke={theme.axis} fontSize={12} allowDecimals={false} />
        <Tooltip contentStyle={{ background: theme.tooltipBg, border: `1px solid ${theme.tooltipBorder}`, borderRadius: 8 }} labelStyle={{ color: theme.tooltipText }} itemStyle={{ color: theme.tooltipText }} />
        <Legend />
        {ESTADOS.map((estado) => (
          <Bar key={estado} dataKey={estado} stackId="x" fill={colors[estado]} isAnimationActive={false} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

function IscEvolutionChart({ trail }: { trail: TrailingPoint[] }) {
  const theme = useChartTheme();
  const data = trail.map((t) => ({ label: t.label, isc: isc(t.snap) * 100 }));

  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={theme.grid} />
        <XAxis dataKey="label" stroke={theme.axis} fontSize={11} />
        <YAxis domain={[0, 100]} stroke={theme.axis} fontSize={12} tickFormatter={(v) => `${v}%`} />
        <Tooltip
          contentStyle={{ background: theme.tooltipBg, border: `1px solid ${theme.tooltipBorder}`, borderRadius: 8 }}
          labelStyle={{ color: theme.tooltipText }}
          itemStyle={{ color: theme.tooltipText }}
          formatter={(v) => `${Number(v).toFixed(1)}%`}
        />
        <Line type="monotone" dataKey="isc" name="ISC %" stroke={theme.primary} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
        <ReferenceLine y={80} stroke={theme.axisSecondary} strokeDasharray="4 4" label={{ value: 'Meta 80%', position: 'insideTopRight', fill: theme.axisSecondary, fontSize: 11 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}

function ActivosEvolutionChart({ trail, records }: { trail: TrailingPoint[]; records: CarteraRecord[] }) {
  const theme = useChartTheme();

  const compradoresPorMes = new Map<string, Set<number>>();
  for (const r of records) {
    const mk = r[1].slice(0, 7);
    if (!compradoresPorMes.has(mk)) compradoresPorMes.set(mk, new Set());
    compradoresPorMes.get(mk)!.add(r[0]);
  }

  const data = trail.map((t) => ({
    label: t.label,
    compradores: compradoresPorMes.get(t.label)?.size ?? 0,
    activos: activosRentables(t.snap).length,
  }));

  const desvios = data.filter((d) => d.activos > 0).map((d) => ((d.compradores - d.activos) / d.activos) * 100);
  const desvioProm = desvios.length > 0 ? desvios.reduce((a, b) => a + b, 0) / desvios.length : 0;

  return (
    <>
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={theme.grid} />
          <XAxis dataKey="label" stroke={theme.axis} fontSize={11} />
          <YAxis stroke={theme.axis} fontSize={12} allowDecimals={false} />
          <Tooltip contentStyle={{ background: theme.tooltipBg, border: `1px solid ${theme.tooltipBorder}`, borderRadius: 8 }} labelStyle={{ color: theme.tooltipText }} itemStyle={{ color: theme.tooltipText }} />
          <Legend />
          <Line type="monotone" dataKey="compradores" name="Compradores del mes" stroke={theme.axisSecondary} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
          <Line type="monotone" dataKey="activos" name="Clientes Activos" stroke={theme.secondary} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
      <p className="mt-2 text-[11px] text-slate-500">
        Desvío promedio compradores vs. activos: {desvioProm >= 0 ? '+' : ''}
        {desvioProm.toFixed(1)}% — la brecha son clientes que compraron algo en el mes pero no llegan al umbral de "Activo Rentable" (recencia + monto mínimo).
      </p>
    </>
  );
}

export default function CarteraCharts({ snap, trail, records }: Props) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartBox title="Composición de cartera" subtitle="Clientes por estado × categoría">
          <CompositionChart snap={snap} />
        </ChartBox>
        <ChartBox title="Índice de Salud de la Cartera (ISC)" subtitle="Evolución mensual">
          <IscEvolutionChart trail={trail} />
        </ChartBox>
      </div>
      <ChartBox title="Evolución de clientes activos" subtitle="Compradores del mes vs. Clientes Activos (recencia + monto mínimo)">
        <ActivosEvolutionChart trail={trail} records={records} />
      </ChartBox>
    </div>
  );
}
