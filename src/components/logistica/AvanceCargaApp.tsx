import { useEffect, type ReactNode } from 'react';
import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import QueryProvider from '@/components/QueryProvider';
import { useApiQuery } from '@/components/dashboard/useApiQuery';
import LastUpdated from '@/components/shared/LastUpdated';
import { useChartTheme } from '@/components/shared/useChartTheme';

interface CargaDia {
  fecha: string;
  m3: number;
  pickings: number;
}

interface CargaLogisticaResult {
  hoy: string;
  horaActual: number;
  jornada: { inicio: number; fin: number };
  esDiaHabil: boolean;
  m3Hoy: number;
  pickingsHoy: number;
  objetivoDia: number;
  objetivoAEstaHora: number;
  faltaHoy: number;
  horasRestantes: number;
  ritmoNecesarioM3h: number;
  diasHabilesMes: number;
  diasHabilesCerrados: number;
  m3Mes: number;
  capacidadAcumulada: number;
  eficienciaPct: number | null;
  eficienciaObjetivoPct: number;
  objetivoMensualM3: number;
  porDia: CargaDia[];
  facturacion: {
    colchones: { real: number; objetivo: number };
    sillonesUE: { real: number; objetivo: number };
  };
  conversion: { m3PorColchon: number; m3PorUeSillon: number; mesesBase: string[] };
}

const REFRESH_MS = 2 * 60 * 1000;
const n0 = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });
const n1 = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const n2 = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 });

function fmtHora(h: number): string {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

const fmtFechaCorta = (iso: string) => `${iso.slice(8)}/${iso.slice(5, 7)}`;

function KpiCard({ label, children, sub, highlight }: { label: string; children: ReactNode; sub?: ReactNode; highlight?: boolean }) {
  return (
    <div className={`rounded-lg border p-4 ${highlight ? 'border-status-green/60 bg-slate-900' : 'border-slate-800 bg-slate-900'}`}>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-2 text-3xl font-semibold text-slate-100">{children}</p>
      {sub && <p className="mt-1 text-xs text-slate-400">{sub}</p>}
    </div>
  );
}

function ProgressBar({ pct, color, marker }: { pct: number; color: string; marker?: number }) {
  return (
    <div className="relative h-3 w-full rounded-full bg-slate-800">
      <div className="h-3 rounded-full" style={{ width: `${Math.min(100, Math.max(0, pct))}%`, background: color }} />
      {marker !== undefined && (
        <div className="absolute -top-1 h-5 w-0.5 bg-status-yellow" style={{ left: `${Math.min(100, Math.max(0, marker))}%` }} />
      )}
    </div>
  );
}

function colorPct(pct: number | null): string {
  if (pct === null) return 'rgb(var(--slate-600))';
  if (pct >= 95) return 'rgb(var(--status-green))';
  if (pct >= 75) return 'rgb(var(--status-yellow))';
  return 'rgb(var(--status-red))';
}

function MensualCard({ label, desc, pct, left, right }: { label: string; desc: string; pct: number | null; left: string; right: string }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="text-xs text-slate-500">{desc}</p>
      <p className="mt-3 text-4xl font-semibold text-slate-100">{pct === null ? '—' : `${n1.format(pct)}%`}</p>
      <div className="mt-3">
        <ProgressBar pct={pct ?? 0} color={colorPct(pct)} />
      </div>
      <div className="mt-2 flex justify-between text-xs text-slate-400">
        <span>{left}</span>
        <span>{right}</span>
      </div>
    </div>
  );
}

function DiarioChart({ data }: { data: CargaLogisticaResult }) {
  const t = useChartTheme();
  const rows = data.porDia.map((d) => ({ dia: fmtFechaCorta(d.fecha), m3: Math.round(d.m3 * 10) / 10, pickings: d.pickings }));
  const objetivoDiario = data.diasHabilesMes > 0 ? data.objetivoMensualM3 / data.diasHabilesMes : 0;
  return (
    <div style={{ height: 240 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={t.grid} />
          <XAxis dataKey="dia" stroke={t.axis} fontSize={12} />
          <YAxis stroke={t.axis} fontSize={12} width={50} />
          <Tooltip
            contentStyle={{ background: t.tooltipBg, border: `1px solid ${t.tooltipBorder}`, borderRadius: 8 }}
            labelStyle={{ color: t.tooltipText }}
            formatter={(v, _n, item) => [`${n1.format(Number(v))} m³ · ${(item.payload as { pickings: number }).pickings} pickings`, 'Cargado']}
          />
          {objetivoDiario > 0 && (
            <ReferenceLine
              y={objetivoDiario}
              stroke={t.warn}
              strokeDasharray="4 4"
              label={{ value: `Objetivo ${n0.format(objetivoDiario)} m³`, fill: t.warn, fontSize: 11, position: 'insideTopRight' }}
            />
          )}
          <Bar dataKey="m3" fill={t.primary} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function Inner() {
  const query = useApiQuery<CargaLogisticaResult>(['logistica-carga'], '/api/logistica-carga');
  const { refetch } = query;
  useEffect(() => {
    const id = setInterval(() => void refetch(), REFRESH_MS);
    return () => clearInterval(id);
  }, [refetch]);

  const d = query.data;
  if (query.isError && !d) {
    return (
      <p className="rounded border border-red-900 bg-red-950/50 p-3 text-sm text-red-300">
        No se pudieron cargar los datos: {(query.error as Error).message}
      </p>
    );
  }
  if (!d) return <div className="h-64 w-full animate-pulse-slow rounded-lg bg-slate-800/60" />;

  const pctDia = d.objetivoDia > 0 ? (d.m3Hoy / d.objetivoDia) * 100 : 0;
  const pctEsperado = d.objetivoDia > 0 ? (d.objetivoAEstaHora / d.objetivoDia) * 100 : 0;
  const delta = d.m3Hoy - d.objetivoAEstaHora;
  const estado = !d.esDiaHabil ? 'DÍA NO HÁBIL' : delta >= 0 ? 'ADELANTADO' : 'ATRASADO';
  const estadoClass = !d.esDiaHabil ? 'text-slate-400' : delta >= 0 ? 'text-status-green' : 'text-status-red';
  const col = d.facturacion.colchones;
  const sil = d.facturacion.sillonesUE;
  const pct = (r: number, o: number) => (o > 0 ? (r / o) * 100 : null);
  const brecha = d.eficienciaPct === null ? null : d.eficienciaPct - d.eficienciaObjetivoPct;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-slate-400">
          {d.hoy.split('-').reverse().join('/')} · {fmtHora(d.horaActual)} · jornada {fmtHora(d.jornada.inicio)}–{fmtHora(d.jornada.fin)} · se actualiza solo cada 2 min
        </p>
        <LastUpdated dataUpdatedAt={query.dataUpdatedAt} />
      </div>

      <section>
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Seguimiento del día</h3>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiCard
            label="m³ validados hoy"
            highlight
            sub={
              d.esDiaHabil ? (
                <span className={delta >= 0 ? 'text-status-green' : 'text-status-red'}>
                  {delta >= 0 ? '▲' : '▼'} {n1.format(Math.abs(delta))} m³ {delta >= 0 ? 'sobre' : 'bajo'} el ritmo esperado · {d.pickingsHoy} pickings
                </span>
              ) : (
                'Hoy no es día hábil'
              )
            }
          >
            {n0.format(d.m3Hoy)} <span className="text-lg text-slate-400">m³</span>
          </KpiCard>
          <KpiCard label="Objetivo a esta hora" sub="Según horas productivas transcurridas">
            {n0.format(d.objetivoAEstaHora)} <span className="text-lg text-slate-400">m³</span>
          </KpiCard>
          <KpiCard label="Objetivo del día" sub={`Faltan ${n0.format(d.faltaHoy)} m³ para completar`}>
            {n0.format(d.objetivoDia)} <span className="text-lg text-slate-400">m³</span>
          </KpiCard>
          <KpiCard label="Ritmo necesario" sub={`Para alcanzar el objetivo a las ${fmtHora(d.jornada.fin)}`}>
            {n1.format(d.ritmoNecesarioM3h)} <span className="text-lg text-slate-400">m³/h</span>
          </KpiCard>
        </div>
      </section>

      <section className="rounded-lg border border-slate-800 bg-slate-900 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold text-slate-100">Progreso del objetivo diario</h3>
            <p className="text-xs text-slate-400">Volumen contabilizado al validar el picking completo</p>
          </div>
          <span className={`rounded border border-slate-700 px-3 py-1 text-xs font-bold ${estadoClass}`}>{estado}</span>
        </div>
        <div className="mt-4 flex items-end justify-between">
          <p className="text-5xl font-semibold text-slate-100">
            {n1.format(pctDia)}%<span className="ml-2 text-sm font-normal text-slate-400">completado</span>
          </p>
          <p className="text-sm text-slate-400">
            {n0.format(d.m3Hoy)} / {n0.format(d.objetivoDia)} m³
          </p>
        </div>
        <div className="mt-4">
          <ProgressBar pct={pctDia} color="rgb(var(--status-green))" marker={pctEsperado} />
        </div>
        <p className="mt-2 text-xs text-status-yellow" style={{ paddingLeft: `${Math.min(85, Math.max(0, pctEsperado - 6))}%` }}>
          Esperado: {n0.format(d.objetivoAEstaHora)} m³
        </p>
      </section>

      <section>
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Resultado mensual acumulado</h3>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          <MensualCard
            label="Eficiencia de m³ del mes"
            desc="m³ cargados / capacidad KPI acumulada"
            pct={d.eficienciaPct}
            left={`Objetivo: ${d.eficienciaObjetivoPct}%`}
            right={brecha === null ? '' : `Brecha: ${brecha >= 0 ? '+' : '−'}${n1.format(Math.abs(brecha))} pp`}
          />
          <MensualCard
            label="Colchones facturados"
            desc="Cantidad facturada contra cantidad objetivo"
            pct={pct(col.real, col.objetivo)}
            left={`Facturados: ${n0.format(col.real)}`}
            right={`Objetivo: ${n0.format(col.objetivo)} un.`}
          />
          <MensualCard
            label="Sillones facturados"
            desc="Cantidad equivalente contra cantidad objetivo"
            pct={pct(sil.real, sil.objetivo)}
            left={`Facturados: ${n0.format(sil.real)} eq.`}
            right={`Objetivo: ${n0.format(sil.objetivo)} eq.`}
          />
        </div>
      </section>

      <section className="rounded-lg border border-slate-800 bg-slate-900 p-5">
        <h3 className="text-base font-semibold text-slate-100">m³ cargados por día</h3>
        <p className="mb-3 text-xs text-slate-400">
          Acumulado del mes: {n0.format(d.m3Mes)} m³ de {n0.format(d.capacidadAcumulada)} m³ de capacidad · objetivo mensual {n0.format(d.objetivoMensualM3)} m³ en {d.diasHabilesMes} días hábiles
        </p>
        <DiarioChart data={d} />
      </section>

      <p className="text-xs text-slate-500">
        Objetivo m³ = objetivo mensual de facturación (colchones en unidades × {n2.format(d.conversion.m3PorColchon)} m³/colchón + sillones en UE × {n2.format(d.conversion.m3PorUeSillon)} m³/UE, promedios de {d.conversion.mesesBase.join(', ')}) ÷ días hábiles del mes.
        Criterio diario: movimientos WH/Existencias → WH/Salida contabilizados únicamente al pasar a estado Hecho.
      </p>
    </div>
  );
}

export default function AvanceCargaApp() {
  return (
    <QueryProvider>
      <Inner />
    </QueryProvider>
  );
}
