export type PoliticaSemaforoStatus = 'verde' | 'amarillo' | 'rojo' | 'sin-datos';

export const SEMAFORO_LABELS: Record<PoliticaSemaforoStatus, string> = {
  verde: 'En rango',
  amarillo: 'Exceso de capital',
  rojo: 'Riesgo de quiebre',
  'sin-datos': 'Sin datos',
};

export const SEMAFORO_CLASSES: Record<PoliticaSemaforoStatus, string> = {
  verde: 'bg-status-green/15 text-status-green ring-1 ring-inset ring-status-green/30',
  amarillo: 'bg-status-yellow/15 text-status-yellow ring-1 ring-inset ring-status-yellow/30',
  rojo: 'bg-status-red/15 text-status-red ring-1 ring-inset ring-status-red/30',
  'sin-datos': 'bg-slate-700/40 text-slate-400 ring-1 ring-inset ring-slate-600/50',
};

/**
 * Umbral configurable desde la UI (default 20%): por encima de +umbral% es
 * exceso de capital inmovilizado (amarillo), por debajo de -umbral% es
 * riesgo de quiebre — por debajo del propio mínimo (rojo), en el medio está
 * en rango, alineado con la política (verde). Vive en el cliente, no en el
 * payload de Odoo, para poder recalcular al vuelo sin un nuevo request.
 */
export function getSemaforo(desviacionPct: number | null, umbralPct: number): PoliticaSemaforoStatus {
  if (desviacionPct === null) return 'sin-datos';
  const umbral = umbralPct / 100;
  if (desviacionPct > umbral) return 'amarillo';
  if (desviacionPct < -umbral) return 'rojo';
  return 'verde';
}
