import { fmtMoney, fmtNumber, fmtPct } from '@/lib/rentabilidad/format';
import type { ClaveGlosario } from '@/lib/rentabilidad/glosario';
import type { Metricas } from '@/lib/rentabilidad/types';
import Etiqueta from './Etiqueta';

function Kpi({ label, value, hint, tip }: { label: string; value: string; hint?: string; tip: ClaveGlosario }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      <p className="text-xs uppercase tracking-wide text-slate-500">
        <Etiqueta clave={tip}>{label}</Etiqueta>
      </p>
      <p className="mt-1 text-xl font-semibold text-slate-100">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export default function KpiRentabilidad({ totales, extra }: { totales: Metricas; extra?: { label: string; value: string; tip: ClaveGlosario }[] }) {
  const sinCosto = totales.contribucion === null;
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
      <Kpi label="Monto s/flete" value={fmtMoney(totales.venta)} tip="venta" />
      <Kpi label="Cantidad" value={fmtNumber(totales.cantidad)} tip="cantidad" />
      {extra?.map((e) => <Kpi key={e.label} label={e.label} value={e.value} tip={e.tip} />)}
      <Kpi
        label="% Contribución"
        value={sinCosto ? 'Sin costo' : fmtPct(totales.contribucionPct)}
        hint={sinCosto ? undefined : `Objetivo ${fmtPct(totales.objetivoPct)} · cobertura ${fmtPct(totales.cobertura * 100)}`}
        tip="contribucionPct"
      />
      <Kpi label="Margen perdido" value={sinCosto ? 'Sin costo' : fmtMoney(totales.margenPerdido)} tip="margenPerdido" />
    </div>
  );
}
