import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useChartTheme } from '../shared/useChartTheme';
import { formatCompactCurrency, formatNumber } from '../gerencia/format';
import { ISC_TARGET, isc, pctDeltaRaw, type ObjetivoPoint, type Snapshot, type TrailingPoint } from './cartera-clientes-calc';

interface Props {
  snap: Snapshot;
  cutoffStr: string;
  trailIsc: TrailingPoint[];
  objetivoSerie: ObjetivoPoint[];
  periodoActivo: number;
  montoMinimo: number;
}

function IscObjetivoPanel({ snap, cutoffStr, trailIsc }: { snap: Snapshot; cutoffStr: string; trailIsc: TrailingPoint[] }) {
  const theme = useChartTheme();
  const iscNow = isc(snap);
  const gap = pctDeltaRaw(iscNow, ISC_TARGET);
  const data = trailIsc.map((t) => ({ label: t.label, isc: isc(t.snap) * 100 }));

  return (
    <div className="rounded-lg border border-brand-500/40 bg-brand-500/5 p-4">
      <p className="text-[11px] uppercase tracking-wide text-brand-400">Objetivo principal · a {cutoffStr}</p>
      <p className="mt-1 text-sm font-medium text-slate-200">Índice de Salud de la Cartera → meta 80%</p>
      <p className="mt-1 text-xs text-slate-500">
        Resume en un solo % la calidad de toda la cartera, ponderando a cada cliente por su categoría A/B/C y su estado.
      </p>
      <div className="mt-3 flex items-end gap-4">
        <span className={`text-3xl font-semibold ${iscNow >= ISC_TARGET ? 'text-status-green' : 'text-slate-100'}`}>{(iscNow * 100).toFixed(1)}%</span>
        <div className="flex flex-col text-xs">
          <span className="text-slate-500">Objetivo fijo: 80%</span>
          <span className={gap.cls === 'up' ? 'text-status-green' : gap.cls === 'down' ? 'text-status-red' : 'text-slate-400'}>
            {gap.txt} — {iscNow >= ISC_TARGET ? 'ya superás la meta' : 'para llegar a 80%'}
          </span>
        </div>
      </div>
      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-800">
        <div className="relative h-full">
          <div className="h-full rounded-full bg-brand-500" style={{ width: `${Math.min(iscNow * 100, 100)}%` }} />
          <div className="absolute top-0 h-full w-px bg-white/70" style={{ left: `${ISC_TARGET * 100}%` }} />
        </div>
      </div>
      <div className="mt-3">
        <ResponsiveContainer width="100%" height={120}>
          <AreaChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={theme.grid} />
            <XAxis dataKey="label" stroke={theme.axis} fontSize={10} hide />
            <YAxis domain={[0, 100]} hide />
            <Tooltip contentStyle={{ background: theme.tooltipBg, border: `1px solid ${theme.tooltipBorder}`, borderRadius: 8 }} labelStyle={{ color: theme.tooltipText }} itemStyle={{ color: theme.tooltipText }} formatter={(v) => `${Number(v).toFixed(1)}%`} />
            <ReferenceLine y={80} stroke="#fff" strokeOpacity={0.4} strokeDasharray="4 4" />
            <Area type="monotone" dataKey="isc" stroke={theme.primary} fill={theme.primary} fillOpacity={0.15} strokeWidth={2} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function ClientesActivosObjetivoPanel({ objetivoSerie, periodoActivo, montoMinimo }: { objetivoSerie: ObjetivoPoint[]; periodoActivo: number; montoMinimo: number }) {
  const theme = useChartTheme();
  if (objetivoSerie.length === 0) {
    return (
      <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
        <p className="text-[11px] uppercase tracking-wide text-slate-500">Palanca de apoyo</p>
        <p className="mt-1 text-sm font-medium text-slate-200">¿Cómo está la cartera activa hoy?</p>
        <p className="mt-3 text-sm text-slate-500">Sin suficiente historial para calcular esta serie todavía.</p>
      </div>
    );
  }

  const actual = objetivoSerie[objetivoSerie.length - 1]!.nActivo;
  const historicos = objetivoSerie.slice(0, -1);
  const baseline = historicos.length > 0 ? historicos.reduce((a, b) => a + b.nActivo, 0) / historicos.length : actual;
  const target = Math.round(baseline * 1.1);
  const cump = target > 0 ? actual / target : 1;
  const gap = target - actual;
  const cumpColor = cump >= 1 ? 'text-status-green' : cump >= 0.9 ? 'text-status-yellow' : 'text-status-red';
  const hoyLabel = objetivoSerie[objetivoSerie.length - 1]!.ds;

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      <p className="text-[11px] uppercase tracking-wide text-slate-500">Palanca de apoyo · siempre a hoy — {hoyLabel}</p>
      <p className="mt-1 text-sm font-medium text-slate-200">¿Cómo está la cartera activa hoy?</p>
      <p className="mt-1 text-xs text-slate-500">
        Clientes que compraron en los últimos {periodoActivo} días y superaron {formatCompactCurrency(montoMinimo)}.
      </p>
      <div className="mt-3 flex items-end gap-4">
        <span className="text-3xl font-semibold text-slate-100">{formatNumber(actual)}</span>
        <div className="flex flex-col text-xs">
          <span className="text-slate-500">Objetivo histórico +10%: {formatNumber(target)}</span>
          <span className={cumpColor}>
            Cumplimiento {(cump * 100).toFixed(0)}% {gap > 0 ? `· faltan ${formatNumber(gap)}` : ''}
          </span>
        </div>
      </div>
      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-800">
        <div className="relative h-full">
          <div className="h-full rounded-full bg-brand-500" style={{ width: `${Math.min(cump * 100, 100)}%` }} />
          {target > 0 && <div className="absolute top-0 h-full w-px bg-white/70" style={{ left: '100%' }} />}
        </div>
      </div>
      <div className="mt-3">
        <ResponsiveContainer width="100%" height={120}>
          <AreaChart data={objetivoSerie} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={theme.grid} />
            <XAxis dataKey="label" stroke={theme.axis} fontSize={10} hide />
            <YAxis hide />
            <Tooltip contentStyle={{ background: theme.tooltipBg, border: `1px solid ${theme.tooltipBorder}`, borderRadius: 8 }} labelStyle={{ color: theme.tooltipText }} itemStyle={{ color: theme.tooltipText }} />
            <ReferenceLine y={target} stroke="#fff" strokeOpacity={0.4} strokeDasharray="4 4" />
            <Area type="monotone" dataKey="nActivo" name="Clientes activos" stroke={theme.primary} fill={theme.primary} fillOpacity={0.15} strokeWidth={2} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default function CarteraObjetivos({ snap, cutoffStr, trailIsc, objetivoSerie, periodoActivo, montoMinimo }: Props) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <IscObjetivoPanel snap={snap} cutoffStr={cutoffStr} trailIsc={trailIsc} />
      <ClientesActivosObjetivoPanel objetivoSerie={objetivoSerie} periodoActivo={periodoActivo} montoMinimo={montoMinimo} />
    </div>
  );
}
