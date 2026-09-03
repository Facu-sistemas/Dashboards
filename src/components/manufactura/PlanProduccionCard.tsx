import type { PlanProduccionGauge } from './types';

interface Props {
  title: string;
  gauge: PlanProduccionGauge;
  /** "UE" for Living, "u" for Colchones — the two categories are not on the same unit, see plan-produccion.ts. */
  unit: string;
}

const units = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });
const pct = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 });

function MetricCard({ label, pctValue, numerator, denominator, unit, hasTarget }: { label: string; pctValue: number; numerator: number; denominator: number; unit: string; hasTarget: boolean }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-slate-800 bg-slate-900 p-4">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      {hasTarget ? (
        <>
          <p className="text-2xl font-semibold text-emerald-400">{pct.format(pctValue)}%</p>
          <p className="text-xs text-slate-500">
            {units.format(numerator)} / {units.format(denominator)} {unit}
          </p>
        </>
      ) : (
        <>
          <p className="text-2xl font-semibold text-slate-100">{units.format(numerator)}</p>
          <p className="text-xs text-slate-500">{unit} — sin objetivo cargado para este período</p>
        </>
      )}
    </div>
  );
}

export default function PlanProduccionCard({ title, gauge, unit }: Props) {
  const hasObjetivo = gauge.objetivo > 0;
  return (
    <div className="flex flex-col gap-3">
      <h3 className="border-b border-slate-800 pb-1 text-sm font-semibold uppercase tracking-wide text-slate-300">{title}</h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <MetricCard label="Planificado" pctValue={gauge.planificadoPct} numerator={gauge.planificado} denominator={gauge.objetivo} unit={unit} hasTarget={hasObjetivo} />
        <MetricCard label="Cumplimiento" pctValue={gauge.cumplimientoPct} numerator={gauge.producido} denominator={gauge.planificado} unit={unit} hasTarget />
        <MetricCard label="Cerrado" pctValue={gauge.cerradoPct} numerator={gauge.cerrado} denominator={gauge.objetivo} unit={unit} hasTarget={hasObjetivo} />
      </div>
    </div>
  );
}
