import type { PresupuestoComplianceStatus } from './types';

const MONTH_LABELS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

export function monthLabel(monthKey: string): string {
  const monthNumber = Number(monthKey.slice(5, 7));
  return MONTH_LABELS[monthNumber - 1] ?? monthKey;
}

export const money = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });

export const STATUS_TEXT_CLASSES: Record<PresupuestoComplianceStatus, string> = {
  green: 'text-status-green',
  yellow: 'text-status-yellow',
  red: 'text-status-red',
  'no-data': 'text-slate-500',
};
