import { formatValue } from './format';

interface Row {
  label: string;
  pct: number | null;
  real: number;
  objetivo: number;
  format?: 'currency' | 'number';
  destacado?: boolean;
}

interface Props {
  rows: Row[];
  /** Texto libre al pie — p.ej. aclarar que Reventa se mide en $ y no entra en el total equivalente. */
  nota?: string;
}

const MAX_PCT = 180;

function colorFor(pct: number | null): string {
  if (pct === null) return 'bg-slate-700';
  if (pct >= 100) return 'bg-status-green';
  if (pct >= 85) return 'bg-status-yellow';
  return 'bg-status-red';
}

function textColorFor(pct: number | null): string {
  if (pct === null) return 'text-slate-500';
  if (pct >= 100) return 'text-status-green';
  if (pct >= 85) return 'text-status-yellow';
  return 'text-status-red';
}

/**
 * Barras de "% cumplimiento" — mismo diseño que el tablero original
 * (public/data/index.html, barRow()): escala hasta 180%, línea de
 * referencia en 100%. `pct` ya viene calculado contra el objetivo
 * prorrateado a días hábiles (real / objetivo_prorrateado × 100).
 */
export default function CumplimientoBars({ rows, nota }: Props) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium text-slate-200">% cumplimiento proporcional a días hábiles</h3>
        <span className="text-[10px] text-slate-500">real / (objetivo x dt/dm)</span>
      </div>

      <div className="flex flex-col gap-2.5">
        {rows.map((row) => {
          const pctClamped = row.pct === null ? 0 : Math.min(row.pct, MAX_PCT);
          const markerLeft = (100 / MAX_PCT) * 100;
          return (
            <div
              key={row.label}
              className={`flex items-center gap-3 ${row.destacado ? 'mt-1.5 border-t border-dashed border-slate-800 pt-2.5' : ''}`}
            >
              <div className={`w-28 shrink-0 text-xs sm:w-36 ${row.destacado ? 'font-bold text-slate-100' : 'text-slate-400'}`}>{row.label}</div>
              <div className="relative h-2.5 flex-1 rounded-full bg-slate-800">
                <div className={`h-2.5 rounded-full ${colorFor(row.pct)}`} style={{ width: `${(pctClamped / MAX_PCT) * 100}%` }} />
                <div className="absolute top-1/2 h-4 w-px -translate-y-1/2 bg-slate-500/60" style={{ left: `${markerLeft}%` }} />
              </div>
              <div className={`w-12 shrink-0 text-right text-xs font-bold ${textColorFor(row.pct)}`}>{row.pct === null ? '—' : `${row.pct.toFixed(0)}%`}</div>
              <div className="hidden w-32 shrink-0 text-right text-[10px] text-slate-500 sm:block">
                {formatValue(row.real, row.format ?? 'number')} / {formatValue(row.objetivo, row.format ?? 'number')}
              </div>
            </div>
          );
        })}
      </div>

      {nota && <p className="mt-3 text-[10px] text-slate-500">{nota}</p>}
    </div>
  );
}
