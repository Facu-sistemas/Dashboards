import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import QueryProvider from '@/components/QueryProvider';
import { useApiQuery } from '@/components/dashboard/useApiQuery';
import LastUpdated from '@/components/shared/LastUpdated';
import { useChartTheme } from '@/components/shared/useChartTheme';
import type { QuizBandasData, QuizRow } from '@/lib/quiz-bandas-sheet';
import {
  computeStats,
  confusiones,
  histogramaSegundos,
  porDia,
  porHora,
  porProducto,
  shortProduct,
} from './quiz-bandas-calc';

type Filtro = 'todos' | 'errores' | 'cancelados' | 'sin-quiz';

const FILTROS: { value: Filtro; label: string }[] = [
  { value: 'errores', label: 'Con errores' },
  { value: 'cancelados', label: 'Cancelados' },
  { value: 'sin-quiz', label: 'Sin quiz' },
  { value: 'todos', label: 'Todos' },
];

const num = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });
const num1 = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 });

function fmtFecha(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}
function fmtDiaCorto(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
}
function fmtSeg(s: number | null): string {
  return s === null ? '—' : `${num1.format(s)} s`;
}

function Kpi({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'good' | 'bad' | 'warn' }) {
  const color = tone === 'good' ? 'text-status-green' : tone === 'bad' ? 'text-status-red' : tone === 'warn' ? 'text-status-yellow' : 'text-slate-100';
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${color}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4 rounded-lg border border-slate-800 bg-slate-900 p-4">
      <div>
        <h3 className="text-sm font-medium text-slate-300">{title}</h3>
        {subtitle && <p className="mt-1 text-xs text-slate-500">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

function Empty() {
  return <p className="py-8 text-center text-sm text-slate-500">Sin datos en el período elegido.</p>;
}

function QuizBandasInner() {
  const chartTheme = useChartTheme();
  const query = useApiQuery<QuizBandasData>(['quiz-bandas'], '/api/quiz-bandas');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('errores');

  const all = query.data?.rows;
  const rows = useMemo<QuizRow[]>(
    () => (all ?? []).filter((r) => r.entorno !== 'Staging' && (!desde || r.fecha >= desde) && (!hasta || r.fecha <= hasta)),
    [all, desde, hasta]
  );

  const stats = useMemo(() => computeStats(rows), [rows]);
  const dias = useMemo(() => porDia(rows), [rows]);
  const horas = useMemo(() => porHora(rows), [rows]);
  const productos = useMemo(() => porProducto(rows), [rows]);
  const histo = useMemo(() => histogramaSegundos(rows), [rows]);
  const confus = useMemo(() => confusiones(rows), [rows]);

  const registro = useMemo(() => {
    const f = rows.filter((r) =>
      filtro === 'todos'
        ? true
        : filtro === 'errores'
          ? r.intentosFallidos > 0
          : filtro === 'cancelados'
            ? r.resultado === 'cancelado'
            : r.resultado === 'sin-quiz'
    );
    return [...f].reverse();
  }, [rows, filtro]);

  const tooltipProps = {
    contentStyle: { background: chartTheme.tooltipBg, border: `1px solid ${chartTheme.tooltipBorder}`, borderRadius: 8 },
    labelStyle: { color: chartTheme.tooltipText },
    itemStyle: { color: chartTheme.tooltipText },
  };

  const loading = query.isLoading;
  const topProductos = productos.filter((p) => p.errores > 0 || p.canceladas > 0).slice(0, 8);
  const inputCls =
    'rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-100 focus:border-brand-500 focus:outline-none';

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <div className="flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-1 text-sm text-slate-300">
            Desde
            <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className={inputCls} />
          </label>
          <label className="flex flex-col gap-1 text-sm text-slate-300">
            Hasta
            <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className={inputCls} />
          </label>
          {(desde || hasta) && (
            <button
              type="button"
              onClick={() => {
                setDesde('');
                setHasta('');
              }}
              className="rounded border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800"
            >
              Ver todo
            </button>
          )}
        </div>
        <div className="flex items-center gap-4">
          <LastUpdated dataUpdatedAt={query.dataUpdatedAt} />
          <button
            type="button"
            onClick={() => void query.refetch()}
            disabled={query.isFetching}
            className="rounded border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-50"
          >
            {query.isFetching ? 'Actualizando…' : 'Actualizar'}
          </button>
        </div>
      </div>

      {query.isError && (
        <p className="rounded border border-red-900 bg-red-950/50 p-3 text-sm text-red-300">
          No se pudieron cargar los datos: {(query.error as Error).message}
        </p>
      )}

      {loading ? (
        <div className="h-24 w-full animate-pulse-slow rounded-lg bg-slate-800/60" />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Kpi label="Confirmaciones" value={num.format(stats.total)} hint={`${num.format(stats.unidades)} unidades en las MO`} />
            <Kpi
              label="Acierto al primer intento"
              value={stats.pctAcierto === null ? '—' : `${num1.format(stats.pctAcierto)}%`}
              hint={`${num.format(stats.aciertoPrimerIntento)} de ${num.format(stats.conQuiz)} quizzes`}
              tone={stats.pctAcierto === null ? undefined : stats.pctAcierto >= 95 ? 'good' : stats.pctAcierto >= 85 ? 'warn' : 'bad'}
            />
            <Kpi
              label="Errores detectados"
              value={num.format(stats.erroresTotales)}
              hint={`${num.format(stats.conError)} confirmaciones corrigieron a tiempo`}
              tone={stats.erroresTotales > 0 ? 'warn' : 'good'}
            />
            <Kpi label="Cancelados" value={num.format(stats.canceladas)} hint="El operario cerró el quiz sin confirmar" tone={stats.canceladas > 0 ? 'warn' : undefined} />
            <Kpi label="Sin quiz" value={num.format(stats.sinQuiz)} hint="Pasaron directo (producto sin verificación)" />
            <Kpi label="Tiempo mediano" value={fmtSeg(stats.segMediana)} hint="Hasta decidir la opción" />
            <Kpi label="Tiempo promedio" value={fmtSeg(stats.segPromedio)} />
            <Kpi
              label="Fallos de cantidad"
              value={num.format(stats.fallosCantidad)}
              hint={`${num.format(stats.quizzesCantidad)} quizzes de cantidad`}
              tone={stats.fallosCantidad > 0 ? 'warn' : stats.quizzesCantidad > 0 ? 'good' : undefined}
            />
          </div>

          {rows.length === 0 ? (
            <Section title="Sin registros">
              <Empty />
            </Section>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <Section title="Resultado por día" subtitle="Correctos al primer intento, con error corregido, cancelados y sin quiz.">
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={dias.map((d) => ({ ...d, dia: fmtDiaCorto(d.fecha) }))} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
                      <XAxis dataKey="dia" stroke={chartTheme.axis} fontSize={12} />
                      <YAxis stroke={chartTheme.axis} fontSize={12} allowDecimals={false} width={36} />
                      <Tooltip {...tooltipProps} />
                      <Legend wrapperStyle={{ fontSize: 12, color: chartTheme.axisSecondary }} />
                      <Bar dataKey="ok" stackId="a" name="Correcto" fill={chartTheme.secondary} isAnimationActive={false} />
                      <Bar dataKey="conError" stackId="a" name="Con error" fill={chartTheme.warn} isAnimationActive={false} />
                      <Bar dataKey="canceladas" stackId="a" name="Cancelado" fill={chartTheme.danger} isAnimationActive={false} />
                      <Bar dataKey="sinQuiz" stackId="a" name="Sin quiz" fill={chartTheme.mutedBar} radius={[4, 4, 0, 0]} isAnimationActive={false} />
                    </BarChart>
                  </ResponsiveContainer>
                </Section>

                <Section title="Actividad por hora" subtitle="Quizzes respondidos y errores a lo largo de la jornada.">
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={horas} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
                      <XAxis dataKey="hora" stroke={chartTheme.axis} fontSize={12} />
                      <YAxis stroke={chartTheme.axis} fontSize={12} allowDecimals={false} width={36} />
                      <Tooltip {...tooltipProps} />
                      <Legend wrapperStyle={{ fontSize: 12, color: chartTheme.axisSecondary }} />
                      <Bar dataKey="quizzes" name="Quizzes" fill={chartTheme.primary} radius={[4, 4, 0, 0]} isAnimationActive={false} />
                      <Bar dataKey="errores" name="Errores" fill={chartTheme.danger} radius={[4, 4, 0, 0]} isAnimationActive={false} />
                    </BarChart>
                  </ResponsiveContainer>
                </Section>
              </div>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <Section title="Cuánto tardan en decidir" subtitle="Una decisión muy rápida (≤2 s) suele ser un toque sin leer.">
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={histo} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
                      <XAxis dataKey="label" stroke={chartTheme.axis} fontSize={12} />
                      <YAxis stroke={chartTheme.axis} fontSize={12} allowDecimals={false} width={36} />
                      <Tooltip {...tooltipProps} formatter={(v) => [`${v}`, 'Quizzes']} />
                      <Bar dataKey="cantidad" name="Quizzes" fill={chartTheme.primary} radius={[4, 4, 0, 0]} isAnimationActive={false} />
                    </BarChart>
                  </ResponsiveContainer>
                </Section>

                <Section title="Productos con más errores" subtitle="Dónde más se equivocan o cancelan — candidatos a revisar etiquetado o capacitación.">
                  {topProductos.length === 0 ? (
                    <p className="py-8 text-center text-sm text-status-green">Ningún error ni cancelación en el período 🎉</p>
                  ) : (
                    <ResponsiveContainer width="100%" height={Math.max(160, topProductos.length * 34 + 30)}>
                      <BarChart
                        layout="vertical"
                        data={topProductos.map((p) => ({ ...p, nombre: shortProduct(p.producto) }))}
                        margin={{ top: 4, right: 16, left: 8, bottom: 0 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} horizontal={false} />
                        <XAxis type="number" stroke={chartTheme.axis} fontSize={12} allowDecimals={false} />
                        <YAxis type="category" dataKey="nombre" stroke={chartTheme.axis} fontSize={11} width={140} />
                        <Tooltip {...tooltipProps} />
                        <Legend wrapperStyle={{ fontSize: 12, color: chartTheme.axisSecondary }} />
                        <Bar dataKey="errores" name="Errores" fill={chartTheme.warn} radius={[0, 4, 4, 0]} isAnimationActive={false} />
                        <Bar dataKey="canceladas" name="Cancelados" fill={chartTheme.danger} radius={[0, 4, 4, 0]} isAnimationActive={false} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </Section>
              </div>

              {confus.length > 0 && (
                <Section title="Confusiones más frecuentes" subtitle="Qué opción tocaron por error en lugar de la correcta.">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="py-2 pr-4 font-medium">Correcto</th>
                          <th className="py-2 pr-4 font-medium">Tocaron</th>
                          <th className="py-2 text-right font-medium">Veces</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800 text-slate-200">
                        {confus.slice(0, 10).map((c) => (
                          <tr key={`${c.producto}|${c.elegido}`}>
                            <td className="py-2 pr-4 font-mono text-xs text-status-green">{shortProduct(c.correcto)}</td>
                            <td className="py-2 pr-4 font-mono text-xs text-status-red">{shortProduct(c.elegido)}</td>
                            <td className="py-2 text-right">{c.veces}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Section>
              )}

              <Section title="Registro detallado" subtitle="Cada fila es una confirmación de MO; el link abre la lista de órdenes en Odoo.">
                <div className="flex flex-wrap gap-2">
                  {FILTROS.map((f) => (
                    <button
                      key={f.value}
                      type="button"
                      onClick={() => setFiltro(f.value)}
                      className={`rounded-full border px-3 py-1 text-xs ${
                        filtro === f.value
                          ? 'border-brand-500 bg-brand-500/10 text-slate-100'
                          : 'border-slate-700 text-slate-400 hover:bg-slate-800'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
                {registro.length === 0 ? (
                  <Empty />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="py-2 pr-4 font-medium">Fecha</th>
                          <th className="py-2 pr-4 font-medium">Producto</th>
                          <th className="py-2 pr-4 font-medium">Resultado</th>
                          <th className="py-2 pr-4 font-medium">Tocaron</th>
                          <th className="py-2 pr-4 text-right font-medium">Seg.</th>
                          <th className="py-2 font-medium">Órdenes</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800 text-slate-200">
                        {registro.map((r, i) => (
                          <tr key={`${r.fecha}${r.hora}${i}`}>
                            <td className="whitespace-nowrap py-2 pr-4">
                              {fmtFecha(r.fecha)} <span className="text-slate-500">{r.hora.slice(0, 5)}</span>
                            </td>
                            <td className="py-2 pr-4 font-mono text-xs">{shortProduct(r.producto)}</td>
                            <td className="whitespace-nowrap py-2 pr-4">
                              <span
                                className={
                                  r.resultado === 'cancelado'
                                    ? 'text-status-red'
                                    : r.intentosFallidos > 0
                                      ? 'text-status-yellow'
                                      : r.resultado === 'sin-quiz'
                                        ? 'text-slate-400'
                                        : 'text-status-green'
                                }
                              >
                                {r.resultado === 'confirmado' && r.intentosFallidos > 0 ? `Corregido (${r.intentosFallidos} error${r.intentosFallidos > 1 ? 'es' : ''})` : r.resultadoOriginal}
                              </span>
                            </td>
                            <td className="py-2 pr-4 font-mono text-xs text-slate-400">
                              {r.opcionesElegidas.length ? r.opcionesElegidas.map(shortProduct).join(' → ') : '—'}
                            </td>
                            <td className="py-2 pr-4 text-right">{r.segundos === null ? '—' : num1.format(r.segundos)}</td>
                            <td className="py-2 text-xs">
                              {r.ordenes.length ? (
                                r.url ? (
                                  <a href={r.url} target="_blank" rel="noreferrer" className="text-brand-500 hover:underline">
                                    {r.ordenes.join(', ')}
                                  </a>
                                ) : (
                                  r.ordenes.join(', ')
                                )
                              ) : (
                                '—'
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Section>
            </>
          )}
        </>
      )}
    </div>
  );
}

/** Entry point mounted as an Astro client island (`client:load`), same pattern as the other tabs. */
export default function QuizBandasApp() {
  return (
    <QueryProvider>
      <QuizBandasInner />
    </QueryProvider>
  );
}
