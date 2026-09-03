import type { PlanProduccionGauge } from './types';

interface Props {
  title: string;
  gauge: PlanProduccionGauge;
  /** "UE" for Living, "u" for Colchones — the two categories are not on the same unit, see plan-produccion.ts. */
  unit: string;
}

const units = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });
const pct = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 });

export default function PlanProduccionCard({ title, gauge, unit }: Props) {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="border-b border-slate-800 pb-1 text-sm font-semibold uppercase tracking-wide text-slate-300">{title}</h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-1 rounded-lg border border-slate-800 bg-slate-900 p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Planificado</p>
          <p className="text-2xl font-semibold text-slate-100">{units.format(gauge.planificado)}</p>
          <p className="text-xs text-slate-500">{unit}</p>
        </div>
        <div className="flex flex-col gap-1 rounded-lg border border-slate-800 bg-slate-900 p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Cumplimiento</p>
          <p className="text-2xl font-semibold text-emerald-400">{pct.format(gauge.cumplimientoPct)}%</p>
          <p className="text-xs text-slate-500">
            {units.format(gauge.producido)} / {units.format(gauge.planificado)} {unit}
          </p>
        </div>
        <div className="flex flex-col gap-1 rounded-lg border border-slate-800 bg-slate-900 p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Cerrado</p>
          <p className="text-2xl font-semibold text-emerald-400">{pct.format(gauge.cerradoPct)}%</p>
          <p className="text-xs text-slate-500">
            {units.format(gauge.cerrado)} / {units.format(gauge.planificado)} {unit}
          </p>
        </div>
      </div>
    </div>
  );
}
