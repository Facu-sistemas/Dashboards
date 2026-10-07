import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import QueryProvider from '../QueryProvider';
import { useApiQuery } from '../dashboard/useApiQuery';
import { useChartTheme } from '../shared/useChartTheme';
import LastUpdated from '../shared/LastUpdated';
import { dateToWeekValue, weekValueToDate } from './isoWeek';
import type { DetalleCounts, PlanProduccionDetalleResult } from '../../lib/odoo/plan-produccion-detalle';

type Familia = 'living' | 'colchones';
type Periodo = 'week' | 'month' | 'year';
type Agrupar = 'day' | 'week' | 'month';
type Vista = 'bars' | 'lines';

interface Props {
  initialDate: string;
}

const FAMILIA_TITLE: Record<Familia, string> = {
  living: 'Living',
  colchones: 'Colchones',
};
const PERIODOS: { value: Periodo; label: string }[] = [
  { value: 'week', label: 'Semana' },
  { value: 'month', label: 'Mes' },
  { value: 'year', label: 'Año' },
];
const AGRUPAR: { value: Agrupar; label: string }[] = [
  { value: 'day', label: 'Día' },
  { value: 'week', label: 'Semana' },
  { value: 'month', label: 'Mes' },
];

// Fijos (no dependen del tema): las series se distinguen entre sí, no contra el fondo.
const SERIES_COLORS = ['#38bdf8', '#f59e0b', '#34d399', '#f472b6', '#a78bfa', '#fb7185', '#2dd4bf', '#facc15', '#60a5fa', '#c084fc'];

const SELECT_CLASS = 'rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-100 focus:border-brand-500 focus:outline-none';
const dayFmt = new Intl.DateTimeFormat('es-AR', {
  day: '2-digit',
  month: '2-digit',
  timeZone: 'UTC',
});
const monthFmt = new Intl.DateTimeFormat('es-AR', {
  month: 'short',
  timeZone: 'UTC',
});
const numFmt = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 });

function utc(dateIso: string): Date {
  const [y, m, d] = dateIso.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!));
}

/** Clave y etiqueta del bucket al que cae un día según la agrupación elegida. */
function bucketOf(dateIso: string, agrupar: Agrupar): { key: string; label: string } {
  if (agrupar === 'day') return { key: dateIso, label: dayFmt.format(utc(dateIso)) };
  if (agrupar === 'month') return { key: dateIso.slice(0, 7), label: monthFmt.format(utc(dateIso)) };
  const week = dateToWeekValue(dateIso);
  return { key: week, label: `S${week.slice(-2)}` };
}

function cumplimiento(c: DetalleCounts | undefined): number | null {
  return c && c.planificadoAHoy > 0 ? (c.producido / c.planificadoAHoy) * 100 : null;
}

function addCounts(a: DetalleCounts, b: DetalleCounts): DetalleCounts {
  return {
    planificado: a.planificado + b.planificado,
    planificadoAHoy: a.planificadoAHoy + b.planificadoAHoy,
    producido: a.producido + b.producido,
    cerrado: a.cerrado + b.cerrado,
  };
}

function FamiliaSection({ familia, initialDate }: Props & { familia: Familia }) {
  const chartTheme = useChartTheme();
  const [periodo, setPeriodo] = useState<Periodo>('month');
  const [agrupar, setAgrupar] = useState<Agrupar>('day');
  const [date, setDate] = useState(initialDate);
  const [vista, setVista] = useState<Vista>('bars');
  // Se muestran todas las series; acá van las que se destildaron.
  const [hidden, setHidden] = useState<string[]>([]);

  const query = useApiQuery<PlanProduccionDetalleResult>(
    ['plan-produccion-detalle', familia, periodo, date],
    `/api/plan-produccion-detalle?${new URLSearchParams({ familia, period: periodo, date })}`,
  );
  const data = query.data;

  const selected = useMemo(() => {
    return (data?.series ?? []).map((s) => s.key).filter((k) => !hidden.includes(k));
  }, [hidden, data]);

  function toggle(key: string) {
    setHidden(selected.includes(key) ? [...hidden, key] : hidden.filter((k) => k !== key));
  }

  const totals = useMemo(() => {
    const acc: Record<string, DetalleCounts> = {};
    for (const day of data?.days ?? []) {
      for (const [key, c] of Object.entries(day.values))
        acc[key] = addCounts(
          acc[key] ?? {
            planificado: 0,
            planificadoAHoy: 0,
            producido: 0,
            cerrado: 0,
          },
          c,
        );
    }
    return acc;
  }, [data]);

  const chartData = useMemo(() => {
    const buckets = new Map<string, { label: string; values: Record<string, DetalleCounts> }>();
    for (const day of data?.days ?? []) {
      const { key, label } = bucketOf(day.date, agrupar);
      let b = buckets.get(key);
      if (!b) buckets.set(key, (b = { label, values: {} }));
      for (const [k, c] of Object.entries(day.values)) {
        b.values[k] = addCounts(
          b.values[k] ?? {
            planificado: 0,
            planificadoAHoy: 0,
            producido: 0,
            cerrado: 0,
          },
          c,
        );
      }
    }
    return [...buckets.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, b]) => {
        const row: Record<string, string | number | null> = { label: b.label };
        for (const key of selected) row[key] = cumplimiento(b.values[key]);
        return row;
      })
      .filter((row) => selected.some((k) => row[k] !== null));
  }, [data, agrupar, selected]);

  const ranking = useMemo(
    () =>
      (data?.series ?? [])
        .map((s) => ({
          ...s,
          counts: totals[s.key],
          pct: cumplimiento(totals[s.key]),
        }))
        .sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1)),
    [data, totals],
  );

  const colorOf = (key: string) => SERIES_COLORS[(data?.series ?? []).findIndex((s) => s.key === key) % SERIES_COLORS.length];
  const unit = data?.unit ?? (familia === 'living' ? 'UE' : 'u');

  return (
    <section className="flex flex-col gap-6">
      <h2 className="text-base font-semibold text-slate-100">{FAMILIA_TITLE[familia]}</h2>
      <div className="flex flex-wrap items-end justify-between gap-4 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <div className="flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-1 text-sm text-slate-300">
            Período
            <select
              value={periodo}
              onChange={(e) => {
                const next = e.target.value as Periodo;
                setPeriodo(next);
                setAgrupar(next === 'year' ? 'month' : 'day');
              }}
              className={SELECT_CLASS}
            >
              {PERIODOS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>

          {periodo === 'week' && (
            <label className="flex flex-col gap-1 text-sm text-slate-300">
              Semana
              <input type="week" value={dateToWeekValue(date)} onChange={(e) => setDate(weekValueToDate(e.target.value))} className={SELECT_CLASS} />
            </label>
          )}
          {periodo === 'month' && (
            <label className="flex flex-col gap-1 text-sm text-slate-300">
              Mes
              <input type="month" value={date.slice(0, 7)} onChange={(e) => e.target.value && setDate(`${e.target.value}-01`)} className={SELECT_CLASS} />
            </label>
          )}
          {periodo === 'year' && (
            <label className="flex flex-col gap-1 text-sm text-slate-300">
              Año
              <input type="number" value={date.slice(0, 4)} onChange={(e) => setDate(`${e.target.value}-01-01`)} className={`w-24 ${SELECT_CLASS}`} />
            </label>
          )}

          <label className="flex flex-col gap-1 text-sm text-slate-300">
            Agrupar por
            <select value={agrupar} onChange={(e) => setAgrupar(e.target.value as Agrupar)} className={SELECT_CLASS}>
              {AGRUPAR.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <LastUpdated dataUpdatedAt={query.dataUpdatedAt} />
      </div>

      {query.isError && (
        <p className="rounded border border-red-900 bg-red-950/50 p-3 text-sm text-red-300">
          No se pudieron cargar los datos: {(query.error as Error).message}
        </p>
      )}

      {query.isLoading ? (
        <div className="h-96 w-full animate-pulse-slow rounded-lg bg-slate-800/60" />
      ) : (
        <>
          <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
            <h3 className="mb-1 text-sm font-medium text-slate-300">Qué comparar</h3>
            <p className="mb-3 text-xs text-slate-500">Elegí las ramas o líneas individuales que quieras ver en el gráfico.</p>
            <div className="flex flex-wrap gap-2">
              {(data?.series ?? []).map((s) => {
                const on = selected.includes(s.key);
                return (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => toggle(s.key)}
                    className={`rounded-full border px-3 py-1 text-xs transition ${on ? 'border-transparent text-slate-950' : 'border-slate-700 text-slate-300 hover:border-slate-500'}`}
                    style={on ? { background: colorOf(s.key) } : undefined}
                  >
                    {s.label}
                  </button>
                );
              })}
              {(data?.series.length ?? 0) === 0 && <span className="text-sm text-slate-500">Sin órdenes planificadas en este período.</span>}
            </div>
          </div>

          <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-medium text-slate-300">
                Cumplimiento % — {FAMILIA_TITLE[familia]} · por {AGRUPAR.find((a) => a.value === agrupar)!.label.toLowerCase()}
              </h3>
              <div className="inline-flex overflow-hidden rounded border border-slate-700 text-xs">
                {(
                  [
                    ['bars', 'Barras'],
                    ['lines', 'Líneas'],
                  ] as const
                ).map(([v, label]) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setVista(v)}
                    className={`px-3 py-1 ${vista === v ? 'bg-brand-500 text-slate-950' : 'text-slate-300 hover:bg-slate-800'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <ResponsiveContainer width="100%" height={320}>
              {vista === 'lines' ? (
                <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
                  <XAxis dataKey="label" stroke={chartTheme.axis} fontSize={11} interval="preserveStartEnd" />
                  <YAxis
                    domain={[0, (max: number) => Math.max(120, Math.ceil(max / 10) * 10)]}
                    stroke={chartTheme.axis}
                    fontSize={12}
                    tickFormatter={(v) => `${v}%`}
                    width={50}
                  />
                  <Tooltip
                    contentStyle={{
                      background: chartTheme.tooltipBg,
                      border: `1px solid ${chartTheme.tooltipBorder}`,
                      borderRadius: 8,
                    }}
                    labelStyle={{ color: chartTheme.tooltipText }}
                    formatter={(value: number) => `${value.toFixed(0)}%`}
                  />
                  <Legend />
                  {selected.map((key) => (
                    <Line
                      key={key}
                      type="monotone"
                      dataKey={key}
                      name={data?.series.find((s) => s.key === key)?.label ?? key}
                      stroke={colorOf(key)}
                      strokeWidth={2}
                      dot={agrupar !== 'day'}
                      connectNulls
                      isAnimationActive={false}
                    />
                  ))}
                </LineChart>
              ) : (
                <BarChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
                  <XAxis dataKey="label" stroke={chartTheme.axis} fontSize={11} interval="preserveStartEnd" />
                  <YAxis
                    domain={[0, (max: number) => Math.max(120, Math.ceil(max / 10) * 10)]}
                    stroke={chartTheme.axis}
                    fontSize={12}
                    tickFormatter={(v) => `${v}%`}
                    width={50}
                  />
                  <Tooltip
                    contentStyle={{
                      background: chartTheme.tooltipBg,
                      border: `1px solid ${chartTheme.tooltipBorder}`,
                      borderRadius: 8,
                    }}
                    labelStyle={{ color: chartTheme.tooltipText }}
                    formatter={(value: number) => `${value.toFixed(0)}%`}
                  />
                  <Legend />
                  {selected.map((key) => (
                    <Bar
                      key={key}
                      dataKey={key}
                      name={data?.series.find((s) => s.key === key)?.label ?? key}
                      fill={colorOf(key)}
                      radius={[3, 3, 0, 0]}
                      isAnimationActive={false}
                    />
                  ))}
                </BarChart>
              )}
            </ResponsiveContainer>
          </div>

          <div className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-900 p-4">
            <h3 className="mb-1 text-sm font-medium text-slate-300">¿Qué línea cumple más?</h3>
            <p className="mb-3 text-xs text-slate-500">
              Cumplimiento = producido el mismo día planificado ÷ planificado hasta hoy, sobre todo el período. Cantidades en {unit}.
            </p>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800 text-left text-xs uppercase text-slate-500">
                  <th className="py-2 pr-4">Serie</th>
                  <th className="py-2 pr-4 text-right">Planificado</th>
                  <th className="py-2 pr-4 text-right">Planif. a hoy</th>
                  <th className="py-2 pr-4 text-right">Producido en fecha</th>
                  <th className="py-2 pr-4 text-right">Cerrado</th>
                  <th className="py-2 text-right">Cumplimiento</th>
                </tr>
              </thead>
              <tbody>
                {ranking.map((r) => (
                  <tr key={r.key} className="border-b border-slate-800/60 text-slate-200">
                    <td className="py-2 pr-4">
                      <span className="mr-2 inline-block h-2.5 w-2.5 rounded-full" style={{ background: colorOf(r.key) }} />
                      {r.label}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">{numFmt.format(r.counts?.planificado ?? 0)}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{numFmt.format(r.counts?.planificadoAHoy ?? 0)}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{numFmt.format(r.counts?.producido ?? 0)}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{numFmt.format(r.counts?.cerrado ?? 0)}</td>
                    <td className="py-2 text-right font-medium tabular-nums">{r.pct === null ? '—' : `${r.pct.toFixed(0)}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

/** Entry point mounted as an Astro client island (`client:load`), same pattern as the other tabs. */
export default function PlanProduccionDetalleApp({ initialDate }: Props) {
  return (
    <QueryProvider>
      <div className="flex flex-col gap-12">
        <FamiliaSection familia="living" initialDate={initialDate} />
        <FamiliaSection familia="colchones" initialDate={initialDate} />
      </div>
    </QueryProvider>
  );
}
