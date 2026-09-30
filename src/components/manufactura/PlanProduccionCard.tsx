import type { PlanProduccionGauge, PlanProduccionPeriodKind } from './types';

interface Props {
  title: string;
  gauge: PlanProduccionGauge;
  /** "UE" for Living, "u" for Colchones — the two categories are not on the same unit, see plan-produccion.ts. */
  unit: string;
  /** Período elegido — define a qué corresponde el "objetivo" mostrado (del día/semana/mes/año). */
  periodKind: PlanProduccionPeriodKind;
}

const OBJETIVO_LABEL: Record<PlanProduccionPeriodKind, string> = {
  day: 'objetivo del día',
  week: 'objetivo de la semana',
  month: 'objetivo del mes',
  year: 'objetivo acumulado',
};

const units = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });
const pct = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 });

/**
 * Mismo criterio visual que VentasGerenciaKpiCard (Gerencia General): valor
 * real arriba, objetivo del período debajo, badge ▲/▼ con el % de avance,
 * y una línea de "faltan recuperar"/"adelantado" contra ese objetivo.
 */
function MetricCard({
  label,
  numerator,
  denominator,
  denominatorLabel,
  pctValue,
  unit,
  hasTarget,
}: {
  label: string;
  numerator: number;
  denominator: number;
  denominatorLabel: string;
  pctValue: number;
  unit: string;
  hasTarget: boolean;
}) {
  const badgeColor = !hasTarget ? 'bg-slate-800 text-slate-400' : pctValue >= 100 ? 'bg-status-green/15 text-status-green' : pctValue >= 85 ? 'bg-status-yellow/15 text-status-yellow' : 'bg-status-red/15 text-status-red';

  const gap = denominator - numerator;
  const umbral = Math.abs(denominator) * 0.005;
  const gapLine = !hasTarget || denominator <= 0 ? null : gap > umbral ? { text: `Faltan recuperar ${units.format(gap)} ${unit}`, tone: 'text-status-red' } : gap < -umbral ? { text: `Adelantado ${units.format(-gap)} ${unit}`, tone: 'text-status-green' } : { text: 'En línea con el objetivo', tone: 'text-status-green' };

  return (
    <div className="flex h-full flex-col gap-1 rounded-lg border border-slate-800 bg-slate-900 p-4">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-semibold text-slate-100">{units.format(numerator)}</p>
      {hasTarget ? (
        <p className="text-xs text-slate-500">
          {denominatorLabel} {units.format(denominator)} {unit}
        </p>
      ) : (
        <p className="text-xs text-slate-500">{unit} — sin objetivo cargado para este período</p>
      )}
      {hasTarget && (
        <span className={`mt-2 inline-flex w-fit rounded-full px-2 py-0.5 text-xs font-semibold ${badgeColor}`}>
          {pctValue >= 100 ? '▲' : '▼'} {pct.format(pctValue)}%
        </span>
      )}
      <div className="mt-auto">{gapLine && <p className={`mt-2 border-t border-dashed border-slate-800 pt-2 text-xs font-semibold ${gapLine.tone}`}>{gapLine.text}</p>}</div>
    </div>
  );
}

export default function PlanProduccionCard({ title, gauge, unit, periodKind }: Props) {
  const hasObjetivo = gauge.objetivo > 0;
  const objetivoLabel = OBJETIVO_LABEL[periodKind];
  return (
    <div className="flex h-full flex-col gap-3">
      <h3 className="border-b border-slate-800 pb-1 text-sm font-semibold uppercase tracking-wide text-slate-300">{title}</h3>
      <div className="grid flex-1 grid-cols-1 gap-3 sm:grid-cols-3">
        <MetricCard label="Planificado" numerator={gauge.planificado} denominator={gauge.objetivo} pctValue={gauge.planificadoPct} unit={unit} hasTarget={hasObjetivo} denominatorLabel={objetivoLabel} />
        <MetricCard label="Cumplimiento" numerator={gauge.producido} denominator={gauge.planificadoAHoy} denominatorLabel="planificado a hoy" pctValue={gauge.cumplimientoPct} unit={unit} hasTarget={gauge.planificadoAHoy > 0} />
        <MetricCard label="Cerrado" numerator={gauge.cerrado} denominator={gauge.objetivo} pctValue={gauge.cerradoPct} unit={unit} hasTarget={hasObjetivo} denominatorLabel={objetivoLabel} />
      </div>
    </div>
  );
}
