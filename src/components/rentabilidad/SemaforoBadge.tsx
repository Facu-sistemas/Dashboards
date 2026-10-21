import type { EstadoSemaforo } from '@/lib/rentabilidad/types';

const ESTILOS: Record<EstadoSemaforo, { clase: string; label: string }> = {
  verde: { clase: 'border-status-green/40 bg-status-green/15 text-status-green', label: 'OK' },
  amarillo: { clase: 'border-status-yellow/40 bg-status-yellow/15 text-status-yellow', label: 'Alerta' },
  rojo: { clase: 'border-status-red/40 bg-status-red/15 text-status-red', label: 'Crítico' },
  sin_costo: { clase: 'border-slate-700 bg-slate-800/60 text-slate-400', label: 'Sin costo' },
};

export default function SemaforoBadge({ estado }: { estado: EstadoSemaforo }) {
  const e = ESTILOS[estado];
  return <span className={`inline-flex items-center whitespace-nowrap rounded border px-2 py-0.5 text-xs font-medium ${e.clase}`}>{e.label}</span>;
}
