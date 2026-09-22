import {
  activosRentables,
  frecuenciaCliente,
  isc,
  pctDelta,
  pctDeltaRaw,
  type CarteraRecord,
  type Categoria,
  type Snapshot,
} from './cartera-clientes-calc';
import { formatCompactCurrency, formatNumber } from '../gerencia/format';

interface Props {
  snap: Snapshot;
  snapPrev: Snapshot;
  byClient: Map<number, CarteraRecord[]>;
  cutoffStr: string;
  compareCutoffStr: string;
  periodoActivo: number;
  montoMinimo: number;
}

const money = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });

function computeFrecuenciaPromedio(snap: Snapshot, byClient: Map<number, CarteraRecord[]>, cutoffStr: string): number | null {
  const activeBroad = snap.clientStats.filter((c) => c.estado === 'Activo' || c.estado === 'Nuevo');
  const freqs: number[] = [];
  for (const c of activeBroad) {
    const f = frecuenciaCliente(byClient.get(c.ci) ?? [], cutoffStr);
    if (f !== null) freqs.push(f);
  }
  if (freqs.length === 0) return null;
  return freqs.reduce((a, b) => a + b, 0) / freqs.length;
}

function computeRotacion(clients: { ci: number }[], byClient: Map<number, CarteraRecord[]>, cutoffStr: string): { pct: number; alta: number; n: number } {
  let alta = 0;
  let n = 0;
  for (const c of clients) {
    const f = frecuenciaCliente(byClient.get(c.ci) ?? [], cutoffStr);
    if (f === null) continue;
    n++;
    if (f <= 30) alta++;
  }
  return { pct: n > 0 ? alta / n : 0, alta, n };
}

function DeltaBadge({ delta }: { delta: { cls: 'up' | 'down' | 'flat'; txt: string } }) {
  const cls =
    delta.cls === 'up' ? 'bg-status-green/15 text-status-green' : delta.cls === 'down' ? 'bg-status-red/15 text-status-red' : 'bg-slate-800 text-slate-400';
  const arrow = delta.cls === 'up' ? '▲' : delta.cls === 'down' ? '▼' : '—';
  return <span className={`mt-2 inline-flex w-fit rounded-full px-2 py-0.5 text-xs font-semibold ${cls}`}>{arrow} {delta.txt}</span>;
}

function KpiCard({ label, value, unit, delta, note }: { label: string; value: string; unit?: string; delta?: { cls: 'up' | 'down' | 'flat'; txt: string }; note?: string }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-semibold text-slate-100">
        {value}
        {unit && <span className="ml-1 text-sm font-normal text-slate-400">{unit}</span>}
      </p>
      {delta && <DeltaBadge delta={delta} />}
      {note && <p className="mt-2 text-[11px] text-slate-500">{note}</p>}
    </div>
  );
}

function CategoriaHealthCard({ cat, snap, dormidoTarget, perdidoTarget }: { cat: Categoria; snap: Snapshot; dormidoTarget: number; perdidoTarget: number }) {
  const enCat = snap.clientStats.filter((c) => c.cat === cat);
  const total = enCat.length;
  const dormidos = enCat.filter((c) => c.estado === 'Dormido').length;
  const perdidos = enCat.filter((c) => c.estado === 'Perdido').length;
  const pctDormidos = total > 0 ? dormidos / total : 0;
  const pctPerdidos = total > 0 ? perdidos / total : 0;

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      <p className="text-xs uppercase tracking-wide text-slate-500">Categoría {cat} — Dormidos / Perdidos</p>
      <p className="mt-1 text-[11px] text-slate-500">{total} clientes en esta categoría</p>
      <div className="mt-3 flex items-baseline gap-2">
        <span className="w-16 text-xs text-slate-400">Dormidos</span>
        <span className={`text-lg font-semibold ${pctDormidos >= dormidoTarget ? 'text-status-red' : 'text-status-green'}`}>
          {(pctDormidos * 100).toFixed(1)}%
        </span>
        <span className="text-[10px] text-slate-500">({dormidos})</span>
        <span className="ml-auto text-[10px] text-slate-500">obj. &lt;{(dormidoTarget * 100).toFixed(0)}%</span>
      </div>
      <div className="mt-1.5 flex items-baseline gap-2">
        <span className="w-16 text-xs text-slate-400">Perdidos</span>
        <span className={`text-lg font-semibold ${pctPerdidos >= perdidoTarget ? 'text-status-red' : 'text-status-green'}`}>
          {(pctPerdidos * 100).toFixed(1)}%
        </span>
        <span className="text-[10px] text-slate-500">({perdidos})</span>
        <span className="ml-auto text-[10px] text-slate-500">obj. &lt;{(perdidoTarget * 100).toFixed(0)}%</span>
      </div>
    </div>
  );
}

export default function CarteraKpiGrid({ snap, snapPrev, byClient, cutoffStr, compareCutoffStr, periodoActivo, montoMinimo }: Props) {
  const active = activosRentables(snap);
  const activePrev = activosRentables(snapPrev);

  const prevByCi = snapPrev.byCi;
  const recuperados = snap.clientStats.filter((c) => {
    const p = prevByCi.get(c.ci);
    const wasDown = p && (p.estado === 'Dormido' || p.estado === 'Perdido');
    const isUp = c.estado === 'Activo' || c.estado === 'Nuevo';
    return wasDown && isUp;
  }).length;

  const nuevos = snap.clientStats.filter((c) => c.estado === 'Nuevo').length;

  const freqAvg = computeFrecuenciaPromedio(snap, byClient, cutoffStr);

  const rot = computeRotacion(active, byClient, cutoffStr);
  const rotPrev = computeRotacion(activePrev, byClient, compareCutoffStr);

  const iscNow = isc(snap);
  const iscPrev = isc(snapPrev);

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <KpiCard
        label="Clientes activos"
        value={money.format(active.length)}
        unit={`/ ${money.format(snap.clientStats.length)}`}
        delta={pctDelta(active.length, activePrev.length)}
        note={`compró en ${periodoActivo}d y superó ${formatCompactCurrency(montoMinimo)}`}
      />
      <KpiCard
        label="Recuperados en período"
        value={money.format(recuperados)}
        note="Dormido/Perdido → Activo · objetivo >20/año"
      />
      <KpiCard label="Clientes nuevos" value={money.format(nuevos)} note="primera compra en ventana activa" />
      <KpiCard
        label="Frecuencia promedio"
        value={freqAvg === null ? '—' : formatNumber(Math.round(freqAvg))}
        unit={freqAvg === null ? undefined : 'días'}
        note="entre compras, clientes activos"
      />
      <KpiCard
        label="Rotación (alta frecuencia)"
        value={`${(rot.pct * 100).toFixed(1)}%`}
        delta={pctDelta(rot.pct, rotPrev.pct)}
        note={`${rot.alta} de ${rot.n} activos compran cada ≤30 días · objetivo: subir`}
      />
      <KpiCard
        label="Índice Salud Cartera"
        value={`${(iscNow * 100).toFixed(1)}%`}
        delta={pctDeltaRaw(iscNow, iscPrev)}
        note="ISC ponderado A/B/C × Estado"
      />
      <CategoriaHealthCard cat="A" snap={snap} dormidoTarget={0.02} perdidoTarget={0.02} />
      <CategoriaHealthCard cat="B" snap={snap} dormidoTarget={0.1} perdidoTarget={0.05} />
    </div>
  );
}
