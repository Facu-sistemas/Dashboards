import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ComposedChart, LabelList, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import QueryProvider from '@/components/QueryProvider';
import { useApiQuery } from '@/components/dashboard/useApiQuery';
import LastUpdated from '@/components/shared/LastUpdated';
import { useChartTheme } from '@/components/shared/useChartTheme';
import type { RoturasAnio, RoturasResponse } from '@/lib/odoo/roturas';

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const MESES_CORTO = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

const num1 = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 });

const sum = (xs: (number | null)[]) => xs.reduce<number>((a, v) => a + (v ?? 0), 0);

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-semibold text-slate-100">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

function RoturasInner() {
  const chartTheme = useChartTheme();
  const query = useApiQuery<RoturasResponse>(['devoluciones-roturas'], '/api/devoluciones-roturas');
  const anios = query.data?.anios;
  const years = useMemo(() => Object.keys(anios ?? {}).sort(), [anios]);
  const [elegido, setElegido] = useState<string | null>(null);

  const actual = years[years.length - 1];
  const previo = years.length > 1 ? years[years.length - 2] : undefined;
  const anioDetalle = elegido && years.includes(elegido) ? elegido : actual;

  const tooltipProps = {
    contentStyle: { background: chartTheme.tooltipBg, border: `1px solid ${chartTheme.tooltipBorder}`, borderRadius: 8 },
    labelStyle: { color: chartTheme.tooltipText },
    itemStyle: { color: chartTheme.tooltipText },
  };
  const legendProps = { wrapperStyle: { fontSize: 12, color: chartTheme.axisSecondary } };

  // Comparativa Transporte año anterior vs. actual. La reducción compara solo los meses ya cargados del año actual.
  const comparativa = useMemo(() => {
    if (!anios || !actual || !previo) return null;
    const cur = anios[actual]!.transporte;
    const prev = anios[previo]!.transporte;
    const idx = cur.map((v, i) => (v !== null ? i : -1)).filter((i) => i >= 0);
    if (idx.length === 0) return null;
    const sCur = idx.reduce((a, i) => a + cur[i]!, 0);
    const sPrev = idx.reduce((a, i) => a + (prev[i] ?? 0), 0);
    return {
      rows: MESES.map((mes, i) => ({ mes, previo: prev[i], actual: cur[i] })),
      pct: sPrev > 0 ? (1 - sCur / sPrev) * 100 : null,
      desde: MESES[idx[0]!]!.toLowerCase(),
      hasta: MESES[idx[idx.length - 1]!]!.toLowerCase(),
      sCur,
      sPrev,
    };
  }, [anios, actual, previo]);

  const detalle: RoturasAnio | undefined = anioDetalle ? anios?.[anioDetalle] : undefined;
  const stack = useMemo(() => {
    if (!detalle) return null;
    const rows = MESES_CORTO.map((mes, i) => {
      const t = detalle.transporte[i];
      const c = detalle.calidad[i];
      return { mes, transporte: t, calidad: c, total: t === null && c === null ? null : (t ?? 0) + (c ?? 0) };
    });
    const cargados = rows.filter((r) => r.total !== null).length;
    const tTot = sum(detalle.transporte);
    const cTot = sum(detalle.calidad);
    return { rows, cargados, tTot, cTot, total: tTot + cTot };
  }, [detalle]);

  if (query.isError) {
    return (
      <p className="rounded border border-red-900 bg-red-950/50 p-3 text-sm text-red-300">
        No se pudieron cargar los ingresos por rotura: {(query.error as Error).message}
      </p>
    );
  }
  if (query.isLoading || !anios) {
    return <div className="h-64 w-full animate-pulse-slow rounded-lg bg-slate-800/60" />;
  }

  const card = 'flex flex-col gap-4 rounded-lg border border-slate-800 bg-slate-900 p-4';

  return (
    <div className="flex flex-col gap-4">
      {comparativa && actual && previo && (
        <section className={card}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="text-sm font-medium text-slate-300">
                Ingresos por rotura — Transporte {previo} vs. {actual}
              </h3>
              <p className="mt-1 text-xs text-slate-500">Barras: {previo}. Línea: {actual} (solo meses cargados).</p>
            </div>
            <LastUpdated dataUpdatedAt={query.dataUpdatedAt} />
          </div>
          <ResponsiveContainer width="100%" height={320}>
            <ComposedChart data={comparativa.rows} margin={{ top: 20, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
              <XAxis dataKey="mes" stroke={chartTheme.axis} fontSize={12} />
              <YAxis stroke={chartTheme.axis} fontSize={12} allowDecimals={false} width={32} />
              <Tooltip {...tooltipProps} />
              <Legend {...legendProps} />
              <Bar dataKey="previo" name={`Transporte ${previo}`} fill={chartTheme.danger} radius={[4, 4, 0, 0]} isAnimationActive={false}>
                <LabelList dataKey="previo" position="insideTop" fill="#fff" fontSize={12} />
              </Bar>
              <Line
                dataKey="actual"
                name={`Transporte ${actual}`}
                stroke={chartTheme.tooltipText}
                strokeWidth={2}
                dot={{ r: 4, fill: chartTheme.tooltipText }}
                connectNulls={false}
                isAnimationActive={false}
              >
                <LabelList dataKey="actual" position="top" fill={chartTheme.tooltipText} fontSize={12} />
              </Line>
            </ComposedChart>
          </ResponsiveContainer>
          {comparativa.pct !== null && (
            <p className="rounded-lg border border-slate-800 bg-slate-950/40 p-3 text-sm text-slate-300">
              Del {previo} al {actual}, {comparativa.pct >= 0 ? 'se redujeron' : 'aumentaron'} un{' '}
              <span className={`font-semibold ${comparativa.pct >= 0 ? 'text-status-green' : 'text-status-red'}`}>
                {num1.format(Math.abs(comparativa.pct))}%
              </span>{' '}
              los ingresos de reclamos por roturas de sofá sobre transportes ({comparativa.sPrev} → {comparativa.sCur}, de {comparativa.desde} a{' '}
              {comparativa.hasta}).
            </p>
          )}
        </section>
      )}

      {stack && anioDetalle && (
        <section className={card}>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h3 className="text-sm font-medium text-slate-300">Ingresos por rotura {anioDetalle} — Transporte y Calidad</h3>
              <p className="mt-1 text-xs text-slate-500">Unidades que ingresaron por mes, según el origen del problema.</p>
            </div>
            {years.length > 1 && (
              <label className="flex flex-col gap-1 text-sm text-slate-300">
                Año
                <select
                  value={anioDetalle}
                  onChange={(e) => setElegido(e.target.value)}
                  className="min-w-[7rem] rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-100 focus:border-brand-500 focus:outline-none"
                >
                  {[...years].reverse().map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="Total" value={String(stack.total)} hint={`${stack.cargados} meses cargados`} />
            <Kpi label="Transporte" value={String(stack.tTot)} hint={stack.total > 0 ? `${num1.format((stack.tTot / stack.total) * 100)}% del total` : undefined} />
            <Kpi label="Calidad" value={String(stack.cTot)} hint={stack.total > 0 ? `${num1.format((stack.cTot / stack.total) * 100)}% del total` : undefined} />
            <Kpi label="Promedio mensual" value={stack.cargados > 0 ? num1.format(stack.total / stack.cargados) : '—'} hint="Transporte + Calidad" />
          </div>

          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={stack.rows} margin={{ top: 20, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
              <XAxis dataKey="mes" stroke={chartTheme.axis} fontSize={12} />
              <YAxis stroke={chartTheme.axis} fontSize={12} allowDecimals={false} width={32} />
              <Tooltip {...tooltipProps} />
              <Legend {...legendProps} />
              <Bar dataKey="transporte" stackId="a" name="Transporte" fill={chartTheme.primary} isAnimationActive={false}>
                <LabelList dataKey="transporte" position="center" fill="#fff" fontSize={11} formatter={(v: unknown) => (Number(v) > 0 ? String(v) : '')} />
              </Bar>
              <Bar dataKey="calidad" stackId="a" name="Calidad" fill={chartTheme.danger} radius={[4, 4, 0, 0]} isAnimationActive={false}>
                <LabelList dataKey="calidad" position="center" fill="#fff" fontSize={11} formatter={(v: unknown) => (Number(v) > 0 ? String(v) : '')} />
                <LabelList dataKey="total" position="top" fill={chartTheme.tooltipText} fontSize={12} fontWeight={600} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </section>
      )}
    </div>
  );
}

/** Entry point mounted as an Astro client island (`client:load`), same pattern as the other tabs. */
export default function RoturasApp() {
  return (
    <QueryProvider>
      <RoturasInner />
    </QueryProvider>
  );
}
