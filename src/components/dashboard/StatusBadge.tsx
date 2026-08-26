import type { ComplianceStatus } from './types';

const LABELS: Record<ComplianceStatus, string> = {
  green: 'En línea',
  yellow: 'Atención',
  red: 'Excedido',
  'no-budget': 'Sin presupuesto',
};

const CLASSES: Record<ComplianceStatus, string> = {
  green: 'bg-emerald-500/15 text-emerald-400 ring-1 ring-inset ring-emerald-500/30',
  yellow: 'bg-amber-500/15 text-amber-400 ring-1 ring-inset ring-amber-500/30',
  red: 'bg-red-500/15 text-red-400 ring-1 ring-inset ring-red-500/30',
  'no-budget': 'bg-slate-700/40 text-slate-400 ring-1 ring-inset ring-slate-600/50',
};

export default function StatusBadge({ status }: { status: ComplianceStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${CLASSES[status]}`}>
      {LABELS[status]}
    </span>
  );
}
