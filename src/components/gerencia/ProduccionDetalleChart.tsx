import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useChartTheme, type ChartTheme } from '../shared/useChartTheme';
import { formatNumber } from './format';
import { colorFor, MAX_DESTACADOS } from './produccion-detalle-palette';

const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const MAX_LINES = MAX_DESTACADOS + 1;

export interface SerieProducto {
  nombre: string;
  /** Un valor por mes del año completo (índice 0 = enero) — el chart recorta con `idxs`. */
  valores: number[];
}

interface Props {
  title: string;
  series: SerieProducto[];
  /** Índices de mes (0=enero) a mostrar en el eje X, en orden — del período elegido en PeriodPicker. */
  idxs: number[];
  unidad: string;
}

function recortar(series: SerieProducto[], idxs: number[]): SerieProducto[] {
  return series.map((s) => ({ nombre: s.nombre, valores: idxs.map((i) => s.valores[i] ?? 0) }));
}

/** Agrupa todo lo que no entra en el top MAX_LINES-1 (sobre el período visible) en una línea "Otros" — nunca un 9no color generado. */
function topSeriesConOtros(series: SerieProducto[]): SerieProducto[] {
  const ordenadas = [...series].sort((a, b) => b.valores.reduce((s, v) => s + v, 0) - a.valores.reduce((s, v) => s + v, 0));
  if (ordenadas.length <= MAX_LINES) return ordenadas;
  const top = ordenadas.slice(0, MAX_LINES - 1);
  const resto = ordenadas.slice(MAX_LINES - 1);
  const nMeses = ordenadas[0]?.valores.length ?? 0;
  const otros: SerieProducto = {
    nombre: 'Otros',
    valores: Array.from({ length: nMeses }, (_, i) => resto.reduce((s, p) => s + (p.valores[i] ?? 0), 0)),
  };
  return [...top, otros];
}

/**
 * Un solo mes elegido — una línea de un punto no dice nada, un ranking de
 * barras es más legible. No hay un <Legend> nativo de Recharts para
 * categorías de un BarChart (solo para dataKeys), así que las referencias
 * cliqueables se arman a mano, mismo comportamiento de ocultar/mostrar que
 * el gráfico de líneas.
 */
function BarraUnMes({
  title,
  visibles,
  chartTheme,
  unidad,
  ocultas,
  toggle,
}: {
  title: string;
  visibles: SerieProducto[];
  chartTheme: ChartTheme;
  unidad: string;
  ocultas: Set<string>;
  toggle: (nombre: string) => void;
}) {
  const colorByNombre = new Map(visibles.map((s, i) => [s.nombre, colorFor(chartTheme, i)]));
  const dataVisible = visibles.filter((s) => !ocultas.has(s.nombre));
  // Recharts dibuja el orden del array de arriba a abajo — se invierte para que el #1 quede arriba, como en un ranking.
  const data = [...dataVisible].reverse().map((s) => ({ nombre: s.nombre, valor: s.valores[0] ?? 0 }));

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-slate-800 bg-slate-900 p-4">
      <h3 className="text-sm font-medium text-slate-300">{title}</h3>
      {data.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-500">Deseleccionaste todas las referencias.</p>
      ) : (
        <ResponsiveContainer width="100%" height={Math.max(200, data.length * 40)}>
          <BarChart data={data} layout="vertical" margin={{ top: 8, right: 24, left: 8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} horizontal={false} />
            <XAxis type="number" stroke={chartTheme.axis} fontSize={11} tickFormatter={(v) => formatNumber(Number(v))} />
            <YAxis type="category" dataKey="nombre" stroke={chartTheme.axis} fontSize={11} width={160} tick={{ fill: chartTheme.axisSecondary }} />
            <Tooltip
              contentStyle={{ background: chartTheme.tooltipBg, border: `1px solid ${chartTheme.tooltipBorder}`, borderRadius: 8 }}
              labelStyle={{ color: chartTheme.tooltipText }}
              itemStyle={{ color: chartTheme.tooltipText }}
              formatter={(value: number) => `${formatNumber(value)} ${unidad}`}
            />
            <Bar dataKey="valor" radius={[0, 4, 4, 0]} isAnimationActive={false}>
              {data.map((d) => (
                <Cell key={d.nombre} fill={colorByNombre.get(d.nombre)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
        {visibles.map((s) => {
          const oculta = ocultas.has(s.nombre);
          return (
            <button
              key={s.nombre}
              type="button"
              onClick={() => toggle(s.nombre)}
              className="flex items-center gap-1.5 text-xs"
              style={{ color: oculta ? chartTheme.axis : chartTheme.tooltipText }}
            >
              <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: oculta ? chartTheme.grid : colorByNombre.get(s.nombre) }} />
              {s.nombre}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function ProduccionDetalleChart({ title, series, idxs, unidad }: Props) {
  const chartTheme = useChartTheme();
  const [ocultas, setOcultas] = useState<Set<string>>(new Set());
  const visibles = topSeriesConOtros(recortar(series, idxs));

  const toggle = (nombre: string) => {
    setOcultas((prev) => {
      const next = new Set(prev);
      if (next.has(nombre)) next.delete(nombre);
      else next.add(nombre);
      return next;
    });
  };

  if (idxs.length === 1) {
    return <BarraUnMes title={title} visibles={visibles} chartTheme={chartTheme} unidad={unidad} ocultas={ocultas} toggle={toggle} />;
  }

  const data = idxs.map((mesIdx, i) => {
    const row: Record<string, string | number> = { mes: MESES[mesIdx] ?? '' };
    for (const s of visibles) row[s.nombre] = s.valores[i] ?? 0;
    return row;
  });

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-slate-800 bg-slate-900 p-4">
      <h3 className="text-sm font-medium text-slate-300">{title}</h3>
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} vertical={false} />
          <XAxis dataKey="mes" stroke={chartTheme.axis} fontSize={11} />
          <YAxis stroke={chartTheme.axis} fontSize={11} tickFormatter={(v) => formatNumber(Number(v))} width={52} />
          <Tooltip
            contentStyle={{ background: chartTheme.tooltipBg, border: `1px solid ${chartTheme.tooltipBorder}`, borderRadius: 8 }}
            labelStyle={{ color: chartTheme.tooltipText }}
            itemStyle={{ color: chartTheme.tooltipText }}
            formatter={(value: number) => `${formatNumber(value)} ${unidad}`}
          />
          <Legend
            onClick={(e) => toggle(String(e.value))}
            formatter={(value) => <span style={{ color: ocultas.has(String(value)) ? chartTheme.axis : chartTheme.tooltipText, cursor: 'pointer' }}>{value}</span>}
          />
          {visibles.map((s, i) => (
            <Line
              key={s.nombre}
              type="monotone"
              dataKey={s.nombre}
              name={s.nombre}
              stroke={colorFor(chartTheme, i)}
              strokeWidth={2}
              dot={{ r: 3 }}
              hide={ocultas.has(s.nombre)}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
      <p className="text-[10px] text-slate-500">Click en la referencia para mostrar/ocultar una línea. Hasta {MAX_LINES - 1} + "Otros".</p>
    </div>
  );
}
