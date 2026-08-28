import type { ComplianceStatus } from './types';

const LABELS: Record<ComplianceStatus, string> = {
  green: 'En línea',
  yellow: 'Atención',
  red: 'Excedido',
  'no-budget': 'Sin presupuesto',
};

const CLASSES: Record<ComplianceStatus, string> = {
  green: 'bg-status-green/15 text-status-green ring-1 ring-inset ring-status-green/30',
  yellow: 'bg-status-yellow/15 text-status-yellow ring-1 ring-inset ring-status-yellow/30',
  red: 'bg-status-red/15 text-status-red ring-1 ring-inset ring-status-red/30',
  'no-budget': 'bg-slate-700/40 text-slate-400 ring-1 ring-inset ring-slate-600/50',
};

export default function StatusBadge({ status }: { status: ComplianceStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${CLASSES[status]}`}>
      {LABELS[status]}
    </span>
  );
}
