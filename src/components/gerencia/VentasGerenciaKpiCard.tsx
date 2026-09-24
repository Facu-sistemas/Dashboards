import { useState } from 'react';
import { formatCompactCurrency, formatNumber } from './format';

interface Props {
  label: string;
  real: number;
  objetivoProrrateado: number;
  format?: 'currency' | 'number';
  unidad?: string;
  destacado?: boolean;
  /** No hay objetivo para este indicador (p.ej. desgloses $ sin meta por categoría en Odoo) — oculta la línea de objetivo, el badge y el "faltan recuperar". */
  sinObjetivo?: boolean;
}

const fullMoney = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });

function fmt(v: number, format: 'currency' | 'number') {
  return format === 'currency' ? formatCompactCurrency(v) : formatNumber(v);
}

/**
 * Same "% cumplimiento proporcional a días hábiles" semantics as the
 * original spreadsheet dashboard (public/data/tabla.gs): the objetivo
 * passed in is already prorated to days-elapsed-so-far, so 100% means "on
 * pace", not "hit the full monthly target early".
 */
export default function VentasGerenciaKpiCard({ label, real, objetivoProrrateado, format = 'number', unidad, destacado, sinObjetivo }: Props) {
  const [expanded, setExpanded] = useState(false);
  const pct = !sinObjetivo && objetivoProrrateado > 0 ? (real / objetivoProrrateado) * 100 : null;
  const badgeColor = pct === null ? 'bg-slate-800 text-slate-400' : pct >= 100 ? 'bg-status-green/15 text-status-green' : pct >= 85 ? 'bg-status-yellow/15 text-status-yellow' : 'bg-status-red/15 text-status-red';

  const gap = objetivoProrrateado - real;
  const umbral = Math.abs(objetivoProrrateado) * 0.005;
  const gapLine = sinObjetivo || objetivoProrrateado <= 0 ? null : gap > umbral ? { text: `Faltan recuperar ${fmt(gap, format)}${unidad ? ` ${unidad}` : ''}`, tone: 'text-status-red' } : gap < -umbral ? { text: `Adelantado ${fmt(-gap, format)}${unidad ? ` ${unidad}` : ''}`, tone: 'text-status-green' } : { text: 'En línea con el objetivo', tone: 'text-status-green' };

  const clickable = format === 'currency';

  const card = (
    <>
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-semibold text-slate-100">{clickable && expanded ? fullMoney.format(real) : fmt(real, format)}</p>
      {!sinObjetivo && <p className="mt-0.5 text-xs text-slate-500">objetivo {fmt(objetivoProrrateado, format)}</p>}
      {pct !== null && <span className={`mt-2 inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${badgeColor}`}>{pct >= 100 ? '▲' : '▼'} {pct.toFixed(1)}%</span>}
      {gapLine && <p className={`mt-2 border-t border-dashed border-slate-800 pt-2 text-xs font-semibold ${gapLine.tone}`}>{gapLine.text}</p>}
    </>
  );

  const baseClass = `rounded-lg border p-4 ${destacado ? 'border-brand-500/50 bg-brand-500/5' : 'border-slate-800 bg-slate-900'}`;

  if (!clickable) return <div className={baseClass}>{card}</div>;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => setExpanded((e) => !e)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          setExpanded((v) => !v);
        }
      }}
      title={expanded ? 'Ver redondeado' : 'Ver monto exacto'}
      className={`${baseClass} cursor-pointer select-none transition-colors hover:border-brand-500/60 hover:bg-slate-800/60`}
    >
      {card}
    </div>
  );
}
