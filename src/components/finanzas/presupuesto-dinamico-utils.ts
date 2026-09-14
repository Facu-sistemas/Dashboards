import type { InsumoMonthFigure, PresupuestoComplianceStatus } from './types';

export const QUARTERS: { label: string; monthNumbers: number[] }[] = [
  { label: 'T1', monthNumbers: [1, 2, 3] },
  { label: 'T2', monthNumbers: [4, 5, 6] },
  { label: 'T3', monthNumbers: [7, 8, 9] },
  { label: 'T4', monthNumbers: [10, 11, 12] },
];

const MONTH_LABELS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

export function monthLabel(monthKey: string): string {
  const monthNumber = Number(monthKey.slice(5, 7));
  return MONTH_LABELS[monthNumber - 1] ?? monthKey;
}

export function monthsInQuarter(months: string[], monthNumbers: number[]): string[] {
  return months.filter((m) => monthNumbers.includes(Number(m.slice(5, 7))));
}

function complianceStatus(pct: number | null): PresupuestoComplianceStatus {
  if (pct === null) return 'no-data';
  if (pct >= 85 && pct <= 110) return 'green';
  if (pct >= 70 && pct <= 130) return 'yellow';
  return 'red';
}

/** Rolls up several months' figures (e.g. a quarter, or the full year) into one — presupuestado is null if ANY constituent month is null (an incomplete total is misleading, not a partial one). */
export function aggregateFigures(figures: InsumoMonthFigure[]): InsumoMonthFigure {
  let presupuestado: number | null = 0;
  let real = 0;
  for (const f of figures) {
    real += f.real;
    if (presupuestado === null || f.presupuestado === null) {
      presupuestado = null;
    } else {
      presupuestado += f.presupuestado;
    }
  }
  const compliancePct = presupuestado !== null && presupuestado > 0 ? (real / presupuestado) * 100 : null;
  const variancePct = presupuestado !== null && presupuestado > 0 ? ((real - presupuestado) / presupuestado) * 100 : null;
  return { presupuestado, real, variancePct, compliancePct, status: complianceStatus(compliancePct) };
}

export const money = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });

export const STATUS_TEXT_CLASSES: Record<PresupuestoComplianceStatus, string> = {
  green: 'text-status-green',
  yellow: 'text-status-yellow',
  red: 'text-status-red',
  'no-data': 'text-slate-500',
};
